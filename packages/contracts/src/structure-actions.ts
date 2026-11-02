import { Array as Arr, Option } from "effect";

import type { Layout, Placement } from "./layout.ts";
import type { MapData, Structure } from "./map-data.ts";
import { quoteText } from "./quote.ts";
import type { Facts } from "./review-report.ts";
import { statusLabels } from "./map-data.ts";
import { structureOf } from "./structure-change.ts";
import type { NewStructure, StructureChange } from "./structure-change.ts";

type Action = StructureChange["action"];

/** The change for one action. */
type Of<A extends Action> = Extract<StructureChange, { action: A }>;

/** What a structure the engineer proposes says until the agent writes it. */
export const proposedOneLiner =
  "Proposed on the page. The agent writes this if it accepts the structure.";

export const proposedDetails = "Proposed on the page, with no description yet.";

const capitals = /\p{Lu}/gu;

/**
 * A short code for a new structure: one to three capital letters, taken from
 * the name's capitals and then its letters, that no structure in `taken` has.
 * The agent sets the real code when it folds the structure into data.mjs. A
 * name that gives nothing free falls back to the letters A to Z, then pairs.
 */
export const codeOfName = (name: string, taken: ReadonlySet<string>): string => {
  const letters = Arr.filter(
    [...name.toUpperCase()],
    (char) => char >= "A" && char <= "Z"
  );

  const initials = Arr.filter(
    [...(name.match(capitals) ?? [])],
    (char) => char >= "A" && char <= "Z"
  );

  const alphabet = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

  const candidates = [
    Arr.join(Arr.take(initials, 3), ""),
    Arr.join(Arr.take(letters, 1), ""),
    Arr.join(Arr.take(letters, 2), ""),
    Arr.join(Arr.take(letters, 3), ""),
    ...alphabet,
    ...Arr.flatMap(alphabet, (first) =>
      Arr.map(alphabet, (second) => `${first}${second}`)
    ),
  ];

  return (
    Arr.findFirst(
      candidates,
      (code) => code !== "" && !taken.has(code)
    ).pipe(Option.getOrUndefined) ?? "ZZZ"
  );
};

/** The structure the map draws for a proposed one. */
export const structureOfNew = (
  made: NewStructure,
  taken: ReadonlySet<string>
): Structure => ({
  id: made.id,
  code: codeOfName(made.name, taken),
  name: made.name,
  shape: made.shape,
  group: made.group,
  status: made.status,
  oneLiner: proposedOneLiner,
  whatItDoes: proposedDetails,
  howItsBuilt: proposedDetails,
});

const changeStructure = (
  data: MapData,
  id: string,
  change: (structure: Structure) => Structure
): MapData => ({
  ...data,
  structures: Arr.map(data.structures, (structure) =>
    structure.id === id ? change(structure) : structure
  ),
});

/** The names a description uses. */
export interface DescribeNames {
  readonly structure: (id: string) => string;
  readonly group: (id: string) => string;
}

/** What `review` prints for one structure of the change. */
type FactFields = Readonly<Record<string, string | number | boolean>>;

/**
 * Everything the map does with one action of a structure change. A new
 * action adds one entry here, and `StructureChange` a member, so none of the
 * code that handles an action by name has to change: the page, `review`, the
 * prompt and the checks all read this table.
 */
export interface StructureAction<A extends Action> {
  /** A word for the kind of item, as `review` lists it. */
  readonly label: string;
  /** `data` once the change is applied. A deletion leaves the structure in. */
  readonly toData: (change: Of<A>, data: MapData) => MapData;
  /** Whether `structure` already has what the change proposes. */
  readonly isCurrent: (change: Of<A>, structure: Structure) => boolean;
  /** One line for the prompt; text the engineer wrote goes through `quoteText`. */
  readonly summary: (
    change: Of<A>,
    id: string,
    names: (id: string) => string
  ) => string;
  /** What the Pending list says, in plain words. */
  readonly describe: (change: Of<A>, names: DescribeNames) => string;
  /** `review`'s before and after, for the structure the map has, if any. */
  readonly facts: (
    change: Of<A>,
    current: Option.Option<Structure>,
    layout: Layout
  ) => { readonly before: Facts; readonly after: Facts };
  /**
   * The change with its proposed fields set on `made`, for a change to a
   * structure that is only proposed. Nothing when the change removes it.
   */
  readonly onProposed: (
    change: Of<A>,
    made: NewStructure
  ) => Option.Option<NewStructure>;
}

const structureFacts = (fields: FactFields): Facts => ({ structure: fields });

const positionOf = (layout: Layout, id: string): FactFields => {
  const placement = layout.structures[id];

  return placement === undefined
    ? {}
    : { x: placement.x, y: placement.y, w: placement.w, d: placement.d };
};

/** The one field of `current` that a change sets, as `review` prints it. */
const fieldBefore = (
  current: Option.Option<Structure>,
  key: "name" | "shape" | "group" | "status"
): Facts =>
  Option.match(current, {
    onNone: () => null,
    onSome: (found) => structureFacts({ [key]: found[key] }),
  });

const placementWords = ({ x, y }: Placement) => `${x}, ${y}`;

/** The table: one entry for every action of a structure change. */
export const structureActions = {
  add: {
    label: "add structure",
    toData: ({ structure: made }, data) =>
      Arr.some(data.structures, ({ id }) => id === made.id)
        ? data
        : {
            ...data,
            structures: [
              ...data.structures,
              structureOfNew(
                made,
                new Set(Arr.map(data.structures, ({ code }) => code))
              ),
            ],
          },
    isCurrent: () => false,
    summary: ({ structure, at }, id) =>
      `add structure ${id}: ${quoteText(structure.name)}, shape ${structure.shape}, status ${structure.status}, group ${quoteText(structure.group)}, at x ${at.x}, y ${at.y}, provisional id ${structure.id}`,
    describe: ({ structure, at }, names) =>
      `Add ${structure.name} (${structure.shape}, ${statusLabels[structure.status]}) to ${names.group(structure.group)} at ${placementWords(at)}`,
    facts: ({ structure, at }) => ({
      before: null,
      after: structureFacts({
        id: structure.id,
        name: structure.name,
        shape: structure.shape,
        group: structure.group,
        status: structure.status,
        x: at.x,
        y: at.y,
        w: at.w,
        d: at.d,
      }),
    }),
    onProposed: () => Option.none(),
  },
  delete: {
    label: "delete structure",
    toData: (_change, data) => data,
    isCurrent: () => false,
    summary: ({ structure }, id, names) =>
      `delete structure ${id}: ${quoteText(names(structure))}`,
    describe: ({ structure }, names) => `Delete ${names.structure(structure)}`,
    facts: ({ structure }, current, layout) => ({
      before: Option.match(current, {
        onNone: () => null,
        onSome: (found) =>
          structureFacts({
            id: found.id,
            name: found.name,
            shape: found.shape,
            group: found.group,
            status: found.status,
            ...positionOf(layout, structure),
          }),
      }),
      after: structureFacts({ deleted: true }),
    }),
    onProposed: () => Option.none(),
  },
  rename: {
    label: "rename structure",
    toData: ({ structure, name }, data) =>
      changeStructure(data, structure, (found) => ({ ...found, name })),
    isCurrent: ({ name }, structure) => structure.name === name,
    summary: ({ structure, name }, id, names) =>
      `rename structure ${id}: ${quoteText(names(structure))} to ${quoteText(name)}`,
    describe: ({ structure, name }, names) =>
      `Rename ${names.structure(structure)} to ${name}`,
    facts: ({ name }, current) => ({
      before: fieldBefore(current, "name"),
      after: structureFacts({ name }),
    }),
    onProposed: ({ name }, made) => Option.some({ ...made, name }),
  },
  shape: {
    label: "change shape",
    toData: ({ structure, shape }, data) =>
      changeStructure(data, structure, (found) => ({ ...found, shape })),
    isCurrent: ({ shape }, structure) => structure.shape === shape,
    summary: ({ structure, shape }, id, names) =>
      `change shape ${id}: ${quoteText(names(structure))} to ${shape}`,
    describe: ({ structure, shape }, names) =>
      `Change the shape of ${names.structure(structure)} to ${shape}`,
    facts: ({ shape }, current) => ({
      before: fieldBefore(current, "shape"),
      after: structureFacts({ shape }),
    }),
    onProposed: ({ shape }, made) => Option.some({ ...made, shape }),
  },
  group: {
    label: "change group",
    toData: ({ structure, group }, data) =>
      changeStructure(data, structure, (found) => ({ ...found, group })),
    isCurrent: ({ group }, structure) => structure.group === group,
    summary: ({ structure, group }, id, names) =>
      `change group ${id}: ${quoteText(names(structure))} to ${quoteText(group)}`,
    describe: ({ structure, group }, names) =>
      `Move ${names.structure(structure)} to ${names.group(group)}`,
    facts: ({ group }, current) => ({
      before: fieldBefore(current, "group"),
      after: structureFacts({ group }),
    }),
    onProposed: ({ group }, made) => Option.some({ ...made, group }),
  },
  status: {
    label: "change status",
    toData: ({ structure, status }, data) =>
      changeStructure(data, structure, (found) => ({ ...found, status })),
    isCurrent: ({ status }, structure) => structure.status === status,
    summary: ({ structure, status }, id, names) =>
      `change status ${id}: ${quoteText(names(structure))} to ${status}`,
    describe: ({ structure, status }, names) =>
      `Change the status of ${names.structure(structure)} to ${statusLabels[status]}`,
    facts: ({ status }, current) => ({
      before: fieldBefore(current, "status"),
      after: structureFacts({ status }),
    }),
    onProposed: ({ status }, made) => Option.some({ ...made, status }),
  },
} satisfies { readonly [A in Action]: StructureAction<A> };

/**
 * The entry for `change`'s action, seen through the union. Each entry takes
 * only its own action's change, so the table's generic view loosens that.
 */
type Entry = {
  readonly [K in keyof StructureAction<Action>]: StructureAction<Action>[K];
};

const entries: Readonly<Record<Action, Entry>> =
  structureActions as unknown as Readonly<Record<Action, Entry>>;

/** The entry for `change`'s action. */
export const actionOf = (change: StructureChange): Entry =>
  entries[change.action];

/** `structureOf` of `change`, for code that has only the id. */
export const targetOf = structureOf;
