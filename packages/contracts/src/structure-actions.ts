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

const alphabet: readonly string[] = Arr.map(Arr.range(65, 90), (code) =>
  String.fromCodePoint(code)
);

/** The Latin capitals in `text`, in order, as single letters. */
const capitalsIn = (text: string): readonly string[] =>
  Arr.filter(Arr.fromIterable(Str.toUpperCase(text)), (char) =>
    Arr.contains(alphabet, char)
  );

/** The capitals `text` itself writes as capitals, such as the B and C of "Build Cache". */
const writtenCapitals = (text: string): readonly string[] =>
  Arr.filter(Arr.fromIterable(text), (char) => Arr.contains(alphabet, char));

/**
 * A short code for a new structure: one to three capital letters that no
 * structure in `taken` has. It tries the capitals the name is written with,
 * then its first one, two and three letters, then each letter of the alphabet
 * and each pair, and takes the first that is free. A name with no Latin
 * letters starts from the alphabet. The agent sets the real code when it
 * folds the structure into data.mjs.
 */
export const codeOfName: {
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
  id: made.id,
  code: codeOfName(made.name, taken),
  name: made.name,
  shape: made.shape,
  group: made.group,
  status: made.status,
  oneLiner: proposedOneLiner,
  whatItDoes: proposedDetails,
  howItsBuilt: proposedDetails,
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
    isCurrent: (_change, _structure) => false,
    summary: ({ structure, at }, id, _names) =>
      `add structure ${id}: ${quoteText(structure.name)}, shape ${structure.shape}, status ${structure.status}, group ${quoteText(structure.group)}, at x ${at.x}, y ${at.y}, provisional id ${structure.id}`,
    describe: ({ structure, at }, names) =>
      `Add ${structure.name} (${structure.shape}, ${statusLabels[structure.status]}) to ${names.group(structure.group)} at ${placementWords(at)}`,
    facts: ({ structure, at }, _current, _layout) => ({
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
    onProposed: (_change, _made) => Option.none(),
  },
  delete: {
    label: "delete structure",
    toData: (_change, data) => data,
    isCurrent: (_change, _structure) => false,
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
    onProposed: (_change, _made) => Option.none(),
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
    facts: ({ name }, current, _layout) => ({
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
    facts: ({ shape }, current, _layout) => ({
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
    facts: ({ group }, current, _layout) => ({
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
    facts: ({ status }, current, _layout) => ({
      before: fieldBefore(current, "status"),
      after: structureFacts({ status }),
    }),
    onProposed: ({ status }, made) => Option.some({ ...made, status }),
  },
} satisfies { readonly [A in Action]: StructureAction<A> };

/**
 * Applies the entry for `change`'s action to `change`. The table types each
 * entry by its own action's change; this is the one place that matches the
 * two up, so no other code names an action.
 */
export const actionOf = (change: StructureChange): Entry => ({
  label: structureActions[change.action].label,
  toData: (data) => toDataBy(change, data),
  isCurrent: (structure) => isCurrentBy(change, structure),
  summary: (id, names) => summaryBy(change, id, names),
  describe: (names) => describeBy(change, names),
  facts: (current, layout) => factsBy(change, current, layout),
  onProposed: (made) => onProposedBy(change, made),
});

/** The table's entry for one change, bound to it. */
export interface Entry {
  readonly label: string;
  readonly toData: (data: MapData) => MapData;
  readonly isCurrent: (structure: Structure) => boolean;
  readonly summary: (id: string, names: (id: string) => string) => string;
  readonly describe: (names: DescribeNames) => string;
  readonly facts: (
    current: Option.Option<Structure>,
    layout: Layout
  ) => { readonly before: Facts; readonly after: Facts };
  readonly onProposed: (made: NewStructure) => Option.Option<NewStructure>;
}

const toDataBy = (change: StructureChange, data: MapData): MapData =>
  Match.value(change).pipe(
    Match.discriminatorsExhaustive("action")({
      add: (found) => structureActions.add.toData(found, data),
      delete: (found) => structureActions.delete.toData(found, data),
      rename: (found) => structureActions.rename.toData(found, data),
      shape: (found) => structureActions.shape.toData(found, data),
      group: (found) => structureActions.group.toData(found, data),
      status: (found) => structureActions.status.toData(found, data),
    })
  );

const isCurrentBy = (change: StructureChange, structure: Structure): boolean =>
  Match.value(change).pipe(
    Match.discriminatorsExhaustive("action")({
      add: (found) => structureActions.add.isCurrent(found, structure),
      delete: (found) => structureActions.delete.isCurrent(found, structure),
      rename: (found) => structureActions.rename.isCurrent(found, structure),
      shape: (found) => structureActions.shape.isCurrent(found, structure),
      group: (found) => structureActions.group.isCurrent(found, structure),
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
      rename: (found) => structureActions.rename.summary(found, id, names),
      shape: (found) => structureActions.shape.summary(found, id, names),
      group: (found) => structureActions.group.summary(found, id, names),
      status: (found) => structureActions.status.summary(found, id, names),
    })
  );

const describeBy = (change: StructureChange, names: DescribeNames): string =>
  Match.value(change).pipe(
    Match.discriminatorsExhaustive("action")({
      add: (found) => structureActions.add.describe(found, names),
      delete: (found) => structureActions.delete.describe(found, names),
      rename: (found) => structureActions.rename.describe(found, names),
      shape: (found) => structureActions.shape.describe(found, names),
      group: (found) => structureActions.group.describe(found, names),
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
      rename: (found) => structureActions.rename.facts(found, current, layout),
      shape: (found) => structureActions.shape.facts(found, current, layout),
      group: (found) => structureActions.group.facts(found, current, layout),
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
      rename: (found) => structureActions.rename.onProposed(found, made),
      shape: (found) => structureActions.shape.onProposed(found, made),
      group: (found) => structureActions.group.onProposed(found, made),
      status: (found) => structureActions.status.onProposed(found, made),
    })
  );
