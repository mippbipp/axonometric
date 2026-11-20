import { Array as Arr, Match, Option, String as Str } from "effect";
import { dual } from "effect/Function";

import type { Layout, Placement } from "./layout.ts";
import type { MapData, Structure } from "./map-data.ts";
import { statusLabels } from "./map-data.ts";
import { quoteText } from "./review-quote.ts";
import type { Facts } from "./review-report.ts";
import type { NewStructure, StructureChange } from "./structure-change.ts";

type Action = StructureChange["action"];

/** The change for one action. */
type Of<A extends Action> = Extract<StructureChange, { action: A }>;

/** What a structure the engineer proposes says until the agent writes it. */
export const proposedOneLiner =
  "Proposed on the page. The agent writes this if it accepts the structure.";

export const proposedDetails = "Proposed on the page, with no description yet.";

const alphabet: ReadonlyArray<string> = Arr.map(Arr.range(65, 90), (code) =>
  String.fromCodePoint(code)
);

/** The Latin capitals in `text`, in order, as single letters. */
const capitalsIn = (text: string): ReadonlyArray<string> =>
  Arr.filter(Arr.fromIterable(Str.toUpperCase(text)), (char) =>
    Arr.contains(alphabet, char)
  );

/** The capitals `text` itself writes as capitals, such as the B and C of "Build Cache". */
const writtenCapitals = (text: string): ReadonlyArray<string> =>
  Arr.filter(Arr.fromIterable(text), (char) => Arr.contains(alphabet, char));

/**
 * A short code for a new structure: one to three capital letters that no
 * structure in `taken` has. It tries the capitals the name is written with,
 * then its first one, two and three letters, then each letter of the alphabet
 * and each pair, and takes the first that is free. A name with no Latin
 * letters starts from the alphabet. The agent sets the real code when it
 * folds the structure into data.mjs.
 */
const codeOfName: {
  (taken: ReadonlySet<string>): (name: string) => string;
  (name: string, taken: ReadonlySet<string>): string;
} = dual(2, (name: string, taken: ReadonlySet<string>): string => {
  const letters = capitalsIn(name);

  const candidates = [
    Arr.join(Arr.take(writtenCapitals(name), 3), ""),
    Arr.join(Arr.take(letters, 1), ""),
    Arr.join(Arr.take(letters, 2), ""),
    Arr.join(Arr.take(letters, 3), ""),
    ...alphabet,
    ...Arr.flatMap(alphabet, (first) =>
      Arr.map(alphabet, (second) => `${first}${second}`)
    ),
  ];

  return Option.getOrElse(
    Arr.findFirst(candidates, (code) => code !== "" && !taken.has(code)),
    () => "ZZZ"
  );
});

/** The structure the map draws for a proposed one. */
export const structureOfNew: {
  (taken: ReadonlySet<string>): (made: NewStructure) => Structure;
  (made: NewStructure, taken: ReadonlySet<string>): Structure;
} = dual(2, (made: NewStructure, taken: ReadonlySet<string>): Structure => ({
  code: codeOfName(made.name, taken),
  group: made.group,
  howItsBuilt: proposedDetails,
  id: made.id,
  name: made.name,
  oneLiner: proposedOneLiner,
  shape: made.shape,
  status: made.status,
  whatItDoes: proposedDetails,
}));

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
  readonly group: (id: string) => string;
  readonly structure: (id: string) => string;
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
  /** What the Pending list says, in plain words. */
  readonly describe: (change: Of<A>, names: DescribeNames) => string;
  /** `review`'s before and after, for the structure the map has, if any. */
  readonly facts: (
    change: Of<A>,
    current: Option.Option<Structure>,
    layout: Layout
  ) => { readonly after: Facts; readonly before: Facts };
  /** Whether `structure` already has what the change proposes. */
  readonly isCurrent: (change: Of<A>, structure: Structure) => boolean;
  /** A word for the kind of item, as `review` lists it. */
  readonly label: string;
  /**
   * The change with its proposed fields set on `made`, for a change to a
   * structure that is only proposed. Nothing when the change removes it.
   */
  readonly onProposed: (
    change: Of<A>,
    made: NewStructure
  ) => Option.Option<NewStructure>;
  /** One line for the prompt; text the engineer wrote goes through `quoteText`. */
  readonly summary: (
    change: Of<A>,
    id: string,
    names: (id: string) => string
  ) => string;
  /** `data` once the change is applied. A deletion leaves the structure in. */
  readonly toData: (change: Of<A>, data: MapData) => MapData;
}

const structureFacts = (fields: FactFields): Facts => ({ structure: fields });

const positionOf = (layout: Layout, id: string): FactFields => {
  const placement = layout.structures[id];

  return placement === undefined
    ? {}
    : { d: placement.d, w: placement.w, x: placement.x, y: placement.y };
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
const structureActions = {
  add: {
    describe: ({ at, structure }, names) =>
      `Add ${structure.name} (${structure.shape}, ${statusLabels[structure.status]}) to ${names.group(structure.group)} at ${placementWords(at)}`,
    facts: ({ at, structure }, _current, _layout) => ({
      after: structureFacts({
        d: at.d,
        group: structure.group,
        id: structure.id,
        name: structure.name,
        shape: structure.shape,
        status: structure.status,
        w: at.w,
        x: at.x,
        y: at.y,
      }),
      before: null,
    }),
    isCurrent: (_change, _structure) => false,
    label: "add structure",
    onProposed: (_change, _made) => Option.none(),
    summary: ({ at, structure }, id, _names) =>
      `add structure ${id}: ${quoteText(structure.name)}, shape ${structure.shape}, status ${structure.status}, group ${quoteText(structure.group)}, at x ${at.x}, y ${at.y}, provisional id ${structure.id}`,
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
  },
  delete: {
    describe: ({ structure }, names) => `Delete ${names.structure(structure)}`,
    facts: ({ structure }, current, layout) => ({
      after: structureFacts({ deleted: true }),
      before: Option.match(current, {
        onNone: () => null,
        onSome: (found) =>
          structureFacts({
            group: found.group,
            id: found.id,
            name: found.name,
            shape: found.shape,
            status: found.status,
            ...positionOf(layout, structure),
          }),
      }),
    }),
    isCurrent: (_change, _structure) => false,
    label: "delete structure",
    onProposed: (_change, _made) => Option.none(),
    summary: ({ structure }, id, names) =>
      `delete structure ${id}: ${quoteText(names(structure))}`,
    toData: (_change, data) => data,
  },
  group: {
    describe: ({ group, structure }, names) =>
      `Move ${names.structure(structure)} to ${names.group(group)}`,
    facts: ({ group }, current, _layout) => ({
      after: structureFacts({ group }),
      before: fieldBefore(current, "group"),
    }),
    isCurrent: ({ group }, structure) => structure.group === group,
    label: "change group",
    onProposed: ({ group }, made) => Option.some({ ...made, group }),
    summary: ({ group, structure }, id, names) =>
      `change group ${id}: ${quoteText(names(structure))} to ${quoteText(group)}`,
    toData: ({ group, structure }, data) =>
      changeStructure(data, structure, (found) => ({ ...found, group })),
  },
  rename: {
    describe: ({ name, structure }, names) =>
      `Rename ${names.structure(structure)} to ${name}`,
    facts: ({ name }, current, _layout) => ({
      after: structureFacts({ name }),
      before: fieldBefore(current, "name"),
    }),
    isCurrent: ({ name }, structure) => structure.name === name,
    label: "rename structure",
    onProposed: ({ name }, made) => Option.some({ ...made, name }),
    summary: ({ name, structure }, id, names) =>
      `rename structure ${id}: ${quoteText(names(structure))} to ${quoteText(name)}`,
    toData: ({ name, structure }, data) =>
      changeStructure(data, structure, (found) => ({ ...found, name })),
  },
  shape: {
    describe: ({ shape, structure }, names) =>
      `Change the shape of ${names.structure(structure)} to ${shape}`,
    facts: ({ shape }, current, _layout) => ({
      after: structureFacts({ shape }),
      before: fieldBefore(current, "shape"),
    }),
    isCurrent: ({ shape }, structure) => structure.shape === shape,
    label: "change shape",
    onProposed: ({ shape }, made) => Option.some({ ...made, shape }),
    summary: ({ shape, structure }, id, names) =>
      `change shape ${id}: ${quoteText(names(structure))} to ${shape}`,
    toData: ({ shape, structure }, data) =>
      changeStructure(data, structure, (found) => ({ ...found, shape })),
  },
  status: {
    describe: ({ status, structure }, names) =>
      `Change the status of ${names.structure(structure)} to ${statusLabels[status]}`,
    facts: ({ status }, current, _layout) => ({
      after: structureFacts({ status }),
      before: fieldBefore(current, "status"),
    }),
    isCurrent: ({ status }, structure) => structure.status === status,
    label: "change status",
    onProposed: ({ status }, made) => Option.some({ ...made, status }),
    summary: ({ status, structure }, id, names) =>
      `change status ${id}: ${quoteText(names(structure))} to ${status}`,
    toData: ({ status, structure }, data) =>
      changeStructure(data, structure, (found) => ({ ...found, status })),
  },
} satisfies { readonly [A in Action]: StructureAction<A> };

/**
 * Applies the entry for `change`'s action to `change`. The table types each
 * entry by its own action's change; this is the one place that matches the
 * two up, so no other code names an action.
 */
export const actionOf = (change: StructureChange): Entry => ({
  describe: (names) => describeBy(change, names),
  facts: (current, layout) => factsBy(change, current, layout),
  isCurrent: (structure) => isCurrentBy(change, structure),
  label: structureActions[change.action].label,
  onProposed: (made) => onProposedBy(change, made),
  summary: (id, names) => summaryBy(change, id, names),
  toData: (data) => toDataBy(change, data),
});

/** The table's entry for one change, bound to it. */
export interface Entry {
  readonly describe: (names: DescribeNames) => string;
  readonly facts: (
    current: Option.Option<Structure>,
    layout: Layout
  ) => { readonly after: Facts; readonly before: Facts };
  readonly isCurrent: (structure: Structure) => boolean;
  readonly label: string;
  readonly onProposed: (made: NewStructure) => Option.Option<NewStructure>;
  readonly summary: (id: string, names: (id: string) => string) => string;
  readonly toData: (data: MapData) => MapData;
}

const toDataBy = (change: StructureChange, data: MapData): MapData =>
  Match.value(change).pipe(
    Match.discriminatorsExhaustive("action")({
      add: (found) => structureActions.add.toData(found, data),
      delete: (found) => structureActions.delete.toData(found, data),
      group: (found) => structureActions.group.toData(found, data),
      rename: (found) => structureActions.rename.toData(found, data),
      shape: (found) => structureActions.shape.toData(found, data),
      status: (found) => structureActions.status.toData(found, data),
    })
  );

const isCurrentBy = (change: StructureChange, structure: Structure): boolean =>
  Match.value(change).pipe(
    Match.discriminatorsExhaustive("action")({
      add: (found) => structureActions.add.isCurrent(found, structure),
      delete: (found) => structureActions.delete.isCurrent(found, structure),
      group: (found) => structureActions.group.isCurrent(found, structure),
      rename: (found) => structureActions.rename.isCurrent(found, structure),
      shape: (found) => structureActions.shape.isCurrent(found, structure),
      status: (found) => structureActions.status.isCurrent(found, structure),
    })
  );

const summaryBy = (
  change: StructureChange,
  id: string,
  names: (id: string) => string
): string =>
  Match.value(change).pipe(
    Match.discriminatorsExhaustive("action")({
      add: (found) => structureActions.add.summary(found, id, names),
      delete: (found) => structureActions.delete.summary(found, id, names),
      group: (found) => structureActions.group.summary(found, id, names),
      rename: (found) => structureActions.rename.summary(found, id, names),
      shape: (found) => structureActions.shape.summary(found, id, names),
      status: (found) => structureActions.status.summary(found, id, names),
    })
  );

const describeBy = (change: StructureChange, names: DescribeNames): string =>
  Match.value(change).pipe(
    Match.discriminatorsExhaustive("action")({
      add: (found) => structureActions.add.describe(found, names),
      delete: (found) => structureActions.delete.describe(found, names),
      group: (found) => structureActions.group.describe(found, names),
      rename: (found) => structureActions.rename.describe(found, names),
      shape: (found) => structureActions.shape.describe(found, names),
      status: (found) => structureActions.status.describe(found, names),
    })
  );

const factsBy = (
  change: StructureChange,
  current: Option.Option<Structure>,
  layout: Layout
) =>
  Match.value(change).pipe(
    Match.discriminatorsExhaustive("action")({
      add: (found) => structureActions.add.facts(found, current, layout),
      delete: (found) => structureActions.delete.facts(found, current, layout),
      group: (found) => structureActions.group.facts(found, current, layout),
      rename: (found) => structureActions.rename.facts(found, current, layout),
      shape: (found) => structureActions.shape.facts(found, current, layout),
      status: (found) => structureActions.status.facts(found, current, layout),
    })
  );

const onProposedBy = (
  change: StructureChange,
  made: NewStructure
): Option.Option<NewStructure> =>
  Match.value(change).pipe(
    Match.discriminatorsExhaustive("action")({
      add: (found) => structureActions.add.onProposed(found, made),
      delete: (found) => structureActions.delete.onProposed(found, made),
      group: (found) => structureActions.group.onProposed(found, made),
      rename: (found) => structureActions.rename.onProposed(found, made),
      shape: (found) => structureActions.shape.onProposed(found, made),
      status: (found) => structureActions.status.onProposed(found, made),
    })
  );
