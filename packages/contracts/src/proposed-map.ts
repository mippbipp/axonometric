import { Array as Arr, Order, Record as Rec } from "effect";

import type { MapState } from "./map-state.ts";
import { emptyProposals } from "./proposals.ts";
import type { Batch, BatchItem, Proposals } from "./proposals.ts";
import { applyOrder, specOf } from "./review-kinds.ts";
import type { Touches } from "./review-kinds.ts";
import { batchesOf, openItems } from "./review.ts";

/** The map as proposed: the accepted map with the proposals applied. */
export interface ProposedMap {
  /**
   * The accepted state with every proposal's effect on `data` and `layout`.
   * The page lays this out, routes it and checks its text like any other map.
   */
  readonly state: MapState;
  /** What each proposal touches, by the proposal's item id. */
  readonly touches: ReadonlyMap<string, Touches>;
  /** Every structure some proposal adds, changes, moves or removes. */
  readonly structures: ReadonlySet<string>;
  /** Every hop some proposal touches. */
  readonly hops: ReadonlySet<string>;
  /**
   * What kinds mark besides structures and hops, by the name of the mark and
   * the ids it marks; see `Touches.marks`. Read one with `marked`.
   */
  readonly marks: ReadonlyMap<string, ReadonlySet<string>>;
}

const byKind = Order.mapInput(Order.Number, (item: BatchItem) =>
  applyOrder.indexOf(item.kind)
);

const inKindOrder = (items: readonly BatchItem[]): readonly BatchItem[] =>
  Arr.sort(items, byKind);

/** The items in batches that no commit has closed, in kind order. */
export const frozenItems = (proposals: Proposals): readonly BatchItem[] => {
  const waiting = Arr.filter(
    batchesOf(proposals),
    (batch: Batch) => batch.committed === undefined
  );

  return inKindOrder(Arr.flatMap(waiting, (batch: Batch) => batch.items));
};

const marksOf = (
  touched: readonly Touches[]
): ReadonlyMap<string, ReadonlySet<string>> => {
  const named = Arr.flatMap(touched, ({ marks }) => Rec.toEntries(marks));
  const names = Arr.dedupe(Arr.map(named, ([name]) => name));

  return new Map(
    Arr.map(names, (name) => [
      name,
      new Set(
        Arr.flatMap(
          Arr.filter(named, ([other]) => other === name),
          ([, ids]) => ids
        )
      ),
    ])
  );
};

const noIds: ReadonlySet<string> = new Set();

/** The ids that proposals mark under `name`; none when no proposal does. */
export const marked = (
  shown: Pick<ProposedMap, "marks">,
  name: string
): ReadonlySet<string> => shown.marks.get(name) ?? noIds;

/**
 * The map as proposed: `state`, the accepted map, with the open and frozen
 * proposals applied, and which structures and hops each one touches.
 *
 * Each kind of proposal changes the data and the layout through its own entry
 * in the kind table (`appliesToData`), so a kind added there shows up here
 * with no change to this function. A proposed structure is a structure of the
 * result, with a footprint, so the page lays it out, routes to it and checks
 * its text like any other. A structure proposed for deletion stays, and is
 * listed in `removes` for the page to cross out.
 *
 * Frozen proposals apply first and open ones after them. Within each group
 * the kind table's order decides, so a structure a proposal adds is on the map
 * before a layout change moves it. With `open: false`, only the frozen
 * proposals apply: the map an open proposal lands on.
 */
export const proposedMap = ({
  state,
  proposals = state.proposals ?? emptyProposals,
  open = true,
}: {
  readonly state: MapState;
  readonly proposals?: Proposals;
  readonly open?: boolean;
}): ProposedMap => {
  const items = [
    ...frozenItems(proposals),
    ...(open ? inKindOrder(openItems(proposals)) : []),
  ];

  const applied = Arr.reduce(
    items,
    { data: state.data, layout: state.layout },
    (map, item) => specOf(item).appliesToData(item, map)
  );

  const touches = new Map(
    Arr.map(items, (item): readonly [string, Touches] => [
      item.id,
      specOf(item).touches(item),
    ])
  );

  const all = [...touches.values()];

  return {
    state: { ...state, data: applied.data, layout: applied.layout },
    touches,
    structures: new Set(Arr.flatMap(all, ({ structures }) => structures)),
    hops: new Set(Arr.flatMap(all, ({ hops }) => hops)),
    marks: marksOf(all),
  };
};

/**
 * `layout` with the ground that proposed structures take, and the frozen
 * items applied. Layout writes and accepts are checked against this, so a
 * move can't land on a structure the engineer has proposed.
 */
export const layoutUnderProposals = ({
  data,
  layout,
  proposals,
}: {
  readonly data: MapState["data"];
  readonly layout: MapState["layout"];
  readonly proposals: Proposals;
}) =>
  proposedMap({
    state: { system: "", data, layout },
    // The open layout changes are what the caller checks, so they stay out.
    proposals: { ...proposals, layout: [] },
  }).state.layout;
