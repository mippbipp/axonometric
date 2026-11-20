import { Array as Arr, Option } from "effect";
import { dual } from "effect/Function";

import type { HopChange } from "./hop-change.ts";
import type { Hop, MapData } from "./map-data.ts";
import { quoteText } from "./review-quote.ts";
import type { Facts } from "./review-report.ts";

/** The ids of the flows that list hop `hop`, in the order the map lists them. */
export const flowsOfHop: {
  (hop: string): (data: Pick<MapData, "flows">) => ReadonlyArray<string>;
  (data: Pick<MapData, "flows">, hop: string): ReadonlyArray<string>;
} = dual(
  2,
  (data: Pick<MapData, "flows">, hop: string): ReadonlyArray<string> =>
    Arr.map(
      Arr.filter(data.flows, (flow) => flow.hops.includes(hop)),
      ({ id }) => id
    )
);

type Action = HopChange["action"];

/** The change for one action. */
type Of<A extends Action> = Extract<HopChange, { action: A }>;

/** The names a hop description uses. */
export interface HopNames {
  readonly hop: (id: string) => string;
  readonly structure: (id: string) => string;
}

const hopFacts = (
  fields: Readonly<Record<string, string | boolean | ReadonlyArray<string>>>
): Facts => ({ hop: fields });

/** What `review` shows for a hop the map has. */
const whole = (hop: Hop, flows: ReadonlyArray<string>) =>
  hopFacts({
    flows,
    from: hop.from,
    id: hop.id,
    label: hop.label,
    to: hop.to,
  });

/**
 * Everything the map does with one action of a hop change. A new action adds
 * one entry here, and `HopChange` a member, so none of the code that handles
 * an action by name has to change: the page, `review`, the prompt and the
 * kind's table all read this one.
 */
export interface HopAction<A extends Action> {
  /** What the Pending list says, in plain words. */
  readonly describe: (change: Of<A>, names: HopNames) => string;
  /** `review`'s before and after. */
  readonly facts: (
    change: Of<A>,
    current: Option.Option<Hop>,
    data: Pick<MapData, "flows"> | undefined
  ) => { readonly after: Facts; readonly before: Facts };
  /** Whether the map already has the value the change proposes. */
  readonly isCurrent: (change: Of<A>, data: Pick<MapData, "hops">) => boolean;
  /** A word for the kind of change, as `review` lists it. */
  readonly label: string;
  /** The hop ids that count as touched, and the ids marked as removed. */
  readonly marks: (change: Of<A>) => {
    readonly proposed: ReadonlyArray<string>;
    readonly removed: ReadonlyArray<string>;
  };
  /** One line for the prompt; text the engineer wrote goes through `quoteText`. */
  readonly summary: (change: Of<A>, item: string, names: HopNames) => string;
  /** The structures and hops the change points at, for `review`. */
  readonly targets: (change: Of<A>) => ReadonlyArray<{
    readonly id: string;
    readonly kind: "structure" | "hop";
  }>;
  /** The text the engineer wrote in the change, if it holds any. */
  readonly text: (change: Of<A>) => Option.Option<string>;
  /** `data` once the change is applied. A deletion leaves the hop in. */
  readonly toData: (change: Of<A>, data: MapData) => MapData;
  /** The change with its text set to `text`, for an edit or a reopened item. */
  readonly withText: (change: Of<A>, text: string) => HopChange;
}

/** The table: one entry for every action of a hop change. */
export const hopActions = {
  add: {
    describe: ({ hop }, names) =>
      `Draw hop “${hop.label}” from ${names.structure(hop.from)} to ${names.structure(hop.to)}`,
    facts: ({ hop }) => ({
      after: hopFacts({
        from: hop.from,
        id: hop.id,
        label: hop.label,
        to: hop.to,
      }),
      before: null,
    }),
    isCurrent: () => false,
    label: "add hop",
    marks: ({ hop }) => ({ proposed: [hop.id], removed: [] }),
    summary: ({ hop }, item, names) =>
      `add hop ${item}: ${quoteText(hop.label)} from ${quoteText(names.structure(hop.from))} to ${quoteText(names.structure(hop.to))}, provisional id ${hop.id}`,
    targets: ({ hop }) => [
      { id: hop.from, kind: "structure" },
      { id: hop.to, kind: "structure" },
    ],
    text: ({ hop }) => Option.some(hop.label),
    toData: ({ hop }, data) =>
      Arr.some(data.hops, ({ id }) => id === hop.id)
        ? data
        : {
            ...data,
            hops: [
              ...data.hops,
              { from: hop.from, id: hop.id, label: hop.label, to: hop.to },
            ],
          },
    withText: (change, label) => ({
      ...change,
      hop: { ...change.hop, label },
    }),
  },
  delete: {
    describe: ({ hop }, names) => `Delete hop “${names.hop(hop)}”`,
    facts: (_change, current, data) => ({
      after: hopFacts({ deleted: true }),
      before: Option.match(current, {
        onNone: () => null,
        onSome: (found) =>
          whole(found, data === undefined ? [] : flowsOfHop(data, found.id)),
      }),
    }),
    isCurrent: () => false,
    label: "delete hop",
    marks: ({ hop }) => ({ proposed: [], removed: [hop] }),
    summary: ({ hop }, item, names) =>
      `delete hop ${item}: ${quoteText(names.hop(hop))}`,
    targets: ({ hop }) => [{ id: hop, kind: "hop" }],
    text: () => Option.none(),
    toData: (_change, data) => data,
    withText: (change) => change,
  },
  relabel: {
    describe: ({ hop, label }, names) =>
      `Relabel hop “${names.hop(hop)}” to “${label}”`,
    facts: ({ label }, current) => ({
      after: hopFacts({ label }),
      before: Option.match(current, {
        onNone: () => null,
        onSome: (found) => hopFacts({ label: found.label }),
      }),
    }),
    isCurrent: ({ hop, label }, data) =>
      Arr.some(data.hops, (found) => found.id === hop && found.label === label),
    label: "relabel hop",
    marks: ({ hop }) => ({ proposed: [hop], removed: [] }),
    summary: ({ hop, label }, item, names) =>
      `relabel hop ${item}: ${quoteText(names.hop(hop))} to ${quoteText(label)}`,
    targets: ({ hop }) => [{ id: hop, kind: "hop" }],
    text: ({ label }) => Option.some(label),
    toData: ({ hop, label }, data) => ({
      ...data,
      hops: Arr.map(data.hops, (found) =>
        found.id === hop ? { ...found, label } : found
      ),
    }),
    withText: (change, label) => ({ ...change, label }),
  },
} satisfies { readonly [A in Action]: HopAction<A> };

/**
 * The entry for `change`'s action, bound to `change`. The table types each
 * entry by its own action's change; this is the one place that matches the
 * two up, so no other code names an action.
 */
export const hopActionOf = (change: HopChange) => {
  // SAFETY: the table is indexed by `change.action`, so the entry only ever
  // reads the member of the union its key names.
  const entry = hopActions[change.action] as HopAction<Action>;
  // SAFETY: as above, `change` is the member that `entry` takes.
  const given = change as Of<Action>;

  return {
    describe: (names: HopNames) => entry.describe(given, names),
    facts: (
      current: Option.Option<Hop>,
      data: Pick<MapData, "flows"> | undefined
    ) => entry.facts(given, current, data),
    isCurrent: (data: Pick<MapData, "hops">) => entry.isCurrent(given, data),
    label: entry.label,
    marks: () => entry.marks(given),
    summary: (item: string, names: HopNames) =>
      entry.summary(given, item, names),
    targets: () => entry.targets(given),
    text: () => entry.text(given),
    toData: (data: MapData) => entry.toData(given, data),
    withText: (text: string) => entry.withText(given, text),
  };
};
