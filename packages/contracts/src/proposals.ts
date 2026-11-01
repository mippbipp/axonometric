import {
  Array as Arr,
  Option,
  Record as Rec,
  Schema,
  String as Str,
} from "effect";
import { dual } from "effect/Function";

import { fileVersionFields, objectMessages } from "./fields.ts";
import { footprintsOverlap } from "./layout-checks.ts";
import { GridPoint, JsonText, Placement } from "./layout.ts";
import type { Layout } from "./layout.ts";
import type { MapData } from "./map-data.ts";
import { mapWarning } from "./problems.ts";
import type { MapProblem } from "./problems.ts";

/** How much ground a footprint covers, in grid units, on half units. */
export const Footprint = Placement.mapFields(({ w, d }) => ({ w, d })).annotate(
  objectMessages("A footprint has only w and d.")
);

export type Footprint = typeof Footprint.Type;

const idMessage = "expected the id of a structure in data.mjs.";

/** A structure, named by its id in data.mjs. */
export const StructureTarget = Schema.Struct({
  kind: Schema.Literal("structure"),
  id: Schema.String.annotate({ message: idMessage }).check(
    Schema.isNonEmpty({ message: idMessage })
  ),
}).annotate(objectMessages("A structure target has only kind and id."));

export type StructureTarget = typeof StructureTarget.Type;

/**
 * What a change acts on. Only structures for now; a reroute will add
 * `{ kind: "hop", id }` here, and a group move its own kind.
 */
export const Target = Schema.Union([StructureTarget]).annotate({
  message: 'expected a target: { kind: "structure", id }.',
});

export type Target = typeof Target.Type;

const changeIdMessage =
  "expected an id of letters, digits, - and _, at most 64 long.";

/**
 * A change's id. It's made when the change is, stays the same as the
 * change is edited, and is what discards, verdicts and keys point at.
 */
export const ChangeId = Schema.String.annotate({
  message: changeIdMessage,
}).check(Schema.isPattern(/^[\w-]{1,64}$/u, { message: changeIdMessage }));

export type ChangeId = typeof ChangeId.Type;

/** One structure's new position, in a move. */
export const StructureMove = Schema.Struct({
  target: StructureTarget,
  position: GridPoint,
}).annotate(objectMessages("A moved structure has only target and position."));

export type StructureMove = typeof StructureMove.Type;

/**
 * A pending move: each structure's footprint starts at its `position`. A
 * move of one structure is a drag; a move of several is one change, such as
 * a multi-select or a whole group, so one undo takes it back.
 */
export const MoveChange = Schema.Struct({
  id: ChangeId,
  kind: Schema.Literal("move"),
  moves: Schema.NonEmptyArray(StructureMove).annotate({
    message: "expected a list of at least one structure to move.",
  }),
}).annotate(objectMessages("A move has only id, kind and moves."));

export type MoveChange = typeof MoveChange.Type;

/** A pending resize: the structure's footprint becomes `footprint`. */
export const ResizeChange = Schema.Struct({
  id: ChangeId,
  kind: Schema.Literal("resize"),
  target: StructureTarget,
  footprint: Footprint,
}).annotate(
  objectMessages("A resize has only id, kind, target and footprint.")
);

export type ResizeChange = typeof ResizeChange.Type;

/**
 * One pending layout change. Each kind names what it acts on, so a later
 * kind, such as a reroute of a hop, joins the union without touching these.
 */
export const LayoutChange = Schema.Union([MoveChange, ResizeChange]).annotate({
  message:
    'expected a layout change: { id, kind: "move", moves: [{ target, position: { x, y } }] } or { id, kind: "resize", target, footprint: { w, d } }.',
});

export type LayoutChange = typeof LayoutChange.Type;

const sameChange = Schema.toEquivalence(LayoutChange);

/** The key a change is listed by: its id. */
export const layoutChangeKey = (change: LayoutChange) => change.id;

/** The ids of the structures a change acts on. */
export const structuresOf = (change: LayoutChange): readonly string[] =>
  change.kind === "move"
    ? Arr.map(change.moves, ({ target }) => target.id)
    : [change.target.id];

const uniqueIds = (changes: readonly LayoutChange[]) =>
  new Set(Arr.map(changes, layoutChangeKey)).size === changes.length;

/**
 * An ordered list of pending layout changes. Order decides: the page shows
 * the changes applied in turn, so a later change wins over an earlier one
 * on the same structure.
 */
export const LayoutChanges = Schema.Array(LayoutChange)
  .annotate({
    message: "expected an array of layout changes, each a move or a resize.",
  })
  .check(
    Schema.makeFilter(uniqueIds, {
      message: "expected every change to have its own id.",
    })
  );

/**
 * `proposals.json`: everything pending that hasn't been accepted. Today it
 * holds the pending layout changes, in `layout`. Proposals, batches and
 * verdicts join as further optional fields beside it, so a file written now
 * still reads after they arrive. `revision` is the file revision: it goes up
 * by one on every write, and a write names the one it was based on.
 */
export const Proposals = Schema.Struct({
  ...fileVersionFields,
  layout: LayoutChanges.pipe(
    Schema.annotateKey({
      messageMissingKey:
        "missing. Add layout: [] to hold the pending layout changes.",
    })
  ),
}).annotate(
  objectMessages("A proposals file has only format, revision and layout.")
);

export type Proposals = typeof Proposals.Type;

/** The text of `proposals.json`, decoded. */
export const ProposalsFile = JsonText.pipe(Schema.decodeTo(Proposals));

/** What a map with no `proposals.json` has pending: nothing. */
export const emptyProposals: Proposals = {
  format: 1,
  revision: 0,
  layout: [],
};

/** A fresh change id: twelve random hex digits. */
export const newChangeId = (): ChangeId => {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));

  return Arr.join(
    Arr.map([...bytes], (byte) => Str.padStart(2, "0")(byte.toString(16))),
    ""
  );
};

/**
 * The layout the page shows while editing: the accepted layout with every
 * pending change applied in list order. A change for a structure the layout
 * doesn't place is skipped.
 */
export const applyLayoutChanges: {
  (changes: readonly LayoutChange[]): (layout: Layout) => Layout;
  (layout: Layout, changes: readonly LayoutChange[]): Layout;
} = dual(2, (layout: Layout, changes: readonly LayoutChange[]): Layout => {
  if (changes.length === 0) {
    return layout;
  }

  const placements = new Map(Rec.toEntries(layout.structures));

  const place = (id: string, change: Partial<Placement>) => {
    const current = placements.get(id);

    if (current !== undefined) {
      placements.set(id, { ...current, ...change });
    }
  };

  for (const change of changes) {
    if (change.kind === "move") {
      for (const { target, position } of change.moves) {
        place(target.id, position);
      }
    } else {
      place(change.target.id, change.footprint);
    }
  }

  return { ...layout, structures: Rec.fromEntries(placements) };
});

/** Where the accepted layout, with `changes`, puts structure `id`. */
const placementIn = (
  accepted: Layout,
  changes: readonly LayoutChange[],
  id: string
) => Rec.get(applyLayoutChanges(accepted, changes).structures, id);

/** What `placeStructure` takes. */
export interface Placing {
  readonly changes: readonly LayoutChange[];
  readonly accepted: Layout;
  readonly id: string;
  readonly next: Placement;
  /** Makes the id of a change that has to be added. */
  readonly newId: () => ChangeId;
}

const movesOnly = (id: string) => (change: LayoutChange) =>
  change.kind === "move" &&
  change.moves.length === 1 &&
  change.moves[0]?.target.id === id;

const resizesOnly = (id: string) => (change: LayoutChange) =>
  change.kind === "resize" && change.target.id === id;

/**
 * The changes after structure `id` is put at `next`. A structure that
 * already has a move of its own, or a resize, has that change updated and
 * keeps its id; otherwise a change is added. A change that would leave the
 * structure where the rest of the list already puts it is dropped. The
 * structure's own changes go last, so they win over earlier ones, such as a
 * group move.
 */
export const placeStructure = ({
  changes,
  accepted,
  id,
  next,
  newId,
}: Placing): readonly LayoutChange[] => {
  if (!Rec.has(accepted.structures, id)) {
    return changes;
  }

  const isMove = movesOnly(id);
  const isResize = resizesOnly(id);
  const target = { kind: "structure" as const, id };

  const without = (drop: (change: LayoutChange) => boolean) =>
    Arr.filter(changes, (change) => !drop(change));

  const movedFrom = Option.getOrUndefined(
    placementIn(accepted, without(isMove), id)
  );

  const resizedFrom = Option.getOrUndefined(
    placementIn(accepted, without(isResize), id)
  );

  const oldMove = Arr.findLast(changes, isMove);
  const oldResize = Arr.findLast(changes, isResize);

  const move: readonly LayoutChange[] =
    movedFrom?.x === next.x && movedFrom.y === next.y
      ? []
      : [
          {
            id: Option.match(oldMove, {
              onNone: newId,
              onSome: (change) => change.id,
            }),
            kind: "move",
            moves: [{ target, position: { x: next.x, y: next.y } }],
          },
        ];

  const resize: readonly LayoutChange[] =
    resizedFrom?.w === next.w && resizedFrom.d === next.d
      ? []
      : [
          {
            id: Option.match(oldResize, {
              onNone: newId,
              onSome: (change) => change.id,
            }),
            kind: "resize",
            target,
            footprint: { w: next.w, d: next.d },
          },
        ];

  return [
    ...without((change) => isMove(change) || isResize(change)),
    ...move,
    ...resize,
  ];
};

/** `changes` without the change that has `id`. */
export const discardChange: {
  (id: ChangeId): (changes: readonly LayoutChange[]) => readonly LayoutChange[];
  (changes: readonly LayoutChange[], id: ChangeId): readonly LayoutChange[];
} = dual(
  2,
  (changes: readonly LayoutChange[], id: ChangeId): readonly LayoutChange[] =>
    Arr.filter(changes, (change) => change.id !== id)
);

/** Another structure whose footprint `placement` would overlap. */
export interface Clash {
  readonly id: string;
  readonly placement: Placement;
}

/**
 * The first structure in `layout`, other than `id`, whose footprint
 * `placement` overlaps. With `among`, only those structures count.
 */
export const clashOf = ({
  layout,
  id,
  placement,
  among,
}: {
  readonly layout: Layout;
  readonly id: string;
  readonly placement: Placement;
  readonly among?: ReadonlySet<string>;
}): Option.Option<Clash> =>
  Option.map(
    Arr.findFirst(
      Rec.toEntries(layout.structures),
      ([other, at]) =>
        other !== id &&
        (among === undefined || among.has(other)) &&
        footprintsOverlap(placement, at)
    ),
    ([other, at]) => ({ id: other, placement: at })
  );

const describePlacement = ({ x, y, w, d }: Placement) =>
  `x ${x}, y ${y}, w ${w}, d ${d}`;

/** The structures that a list of changes acts on. */
const structuresIn = (changes: readonly LayoutChange[]) =>
  Arr.dedupe(Arr.flatMap(changes, structuresOf));

/**
 * Why going from the pending changes `before` to `after` is refused, or
 * nothing when it's allowed.
 *
 * - A change that's new or different must act on structures the accepted
 *   layout places, and must leave each footprint clear of every other
 *   footprint in the resulting layout.
 * - A change that's removed, a discard, is refused when it puts a structure
 *   back on top of one with a pending change of its own. The message names
 *   that change. Overlaps with structures that have no pending change were
 *   already there in the accepted layout, so they don't stop a discard.
 * - Changes kept as they were are never checked again.
 */
export const layoutRefusal = ({
  accepted,
  before,
  after,
}: {
  readonly accepted: Layout;
  readonly before: readonly LayoutChange[];
  readonly after: readonly LayoutChange[];
}): Option.Option<string> => {
  const added = Arr.filter(
    after,
    (change) => !Arr.some(before, (kept) => sameChange(kept, change))
  );

  const afterIds = new Set(Arr.map(after, layoutChangeKey));
  const removed = Arr.filter(before, (change) => !afterIds.has(change.id));
  const touched = structuresIn(added);

  const unplaced = Arr.findFirst(
    touched,
    (id) => !Rec.has(accepted.structures, id)
  );

  if (Option.isSome(unplaced)) {
    return Option.some(
      `No structure in the layout has the id "${unplaced.value}". Move or resize a structure the map draws.`
    );
  }

  const effective = applyLayoutChanges(accepted, after);

  const overlap = Arr.findFirst(touched, (id) =>
    Option.flatMap(Rec.get(effective.structures, id), (placement) =>
      Option.map(
        clashOf({ layout: effective, id, placement }),
        (clash) =>
          `${id} at ${describePlacement(placement)} would overlap "${clash.id}" at ${describePlacement(clash.placement)}. Pick a free spot.`
      )
    )
  );

  if (Option.isSome(overlap)) {
    return overlap;
  }

  const pending = new Set(structuresIn(after));

  return Arr.findFirst(removed, (gone) =>
    Arr.findFirst(
      Arr.filter(structuresOf(gone), (id) => !touched.includes(id)),
      (id) =>
        Option.flatMap(Rec.get(effective.structures, id), (placement) =>
          Option.flatMap(
            clashOf({ layout: effective, id, placement, among: pending }),
            (clash) =>
              Option.map(
                Arr.findLast(after, (change) =>
                  structuresOf(change).includes(clash.id)
                ),
                (other) =>
                  `Discarding change ${gone.id} puts ${id} back at ${describePlacement(placement)}, on top of "${clash.id}", which change ${other.id} put there. Discard or move change ${other.id} first.`
              )
          )
        )
    )
  );
};

/** Each structure a change names, with where its id sits in the change. */
const targetPaths = (change: LayoutChange) =>
  change.kind === "move"
    ? Arr.map(change.moves, ({ target }, index) => ({
        id: target.id,
        path: ["moves", index, "target", "id"],
      }))
    : [{ id: change.target.id, path: ["target", "id"] }];

/**
 * Warnings about the pending changes in `proposals.json`: changes for a
 * structure data.mjs doesn't have, and pending footprints that overlap,
 * which happens when the accepted layout changes under a pending move.
 */
export const checkProposals: {
  (
    layout: Layout,
    proposals: Proposals
  ): (data: MapData) => readonly MapProblem[];
  (data: MapData, layout: Layout, proposals: Proposals): readonly MapProblem[];
} = dual(
  3,
  (
    data: MapData,
    layout: Layout,
    proposals: Proposals
  ): readonly MapProblem[] => {
    const ids = new Set(Arr.map(data.structures, ({ id }) => id));

    const stale = Arr.flatMap(proposals.layout, (change, index) =>
      Arr.flatMap(targetPaths(change), ({ id, path }) =>
        ids.has(id)
          ? []
          : [
              mapWarning({
                file: "proposals.json",
                path: ["layout", index, ...path],
                message: `no structure in data.mjs has the id "${id}", so this ${change.kind} does nothing. Discard it from the page's Pending list.`,
              }),
            ]
      )
    );

    const effective = applyLayoutChanges(layout, proposals.layout);

    const overlaps = Arr.flatMap(structuresIn(proposals.layout), (id) =>
      Option.match(Rec.get(effective.structures, id), {
        onNone: () => [],
        onSome: (placement) =>
          Option.match(clashOf({ layout: effective, id, placement }), {
            onNone: () => [],
            onSome: (clash) => [
              mapWarning({
                file: "proposals.json",
                path: ["layout"],
                message: `the pending change to "${id}" makes its footprint overlap "${clash.id}". Move it again in the page, or discard the change.`,
              }),
            ],
          }),
      })
    );

    return [...stale, ...overlaps];
  }
);
