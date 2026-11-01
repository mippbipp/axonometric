import { Array as Arr, Option, Record as Rec, Schema } from "effect";
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

const structureId = Schema.String.annotate({
  message: "expected the id of a structure in data.mjs.",
}).check(
  Schema.isNonEmpty({ message: "expected the id of a structure in data.mjs." })
);

/** A pending move: the structure's footprint starts at `position`. */
export const MoveChange = Schema.Struct({
  kind: Schema.Literal("move"),
  structureId,
  position: GridPoint,
}).annotate(objectMessages("A move has only kind, structureId and position."));

export type MoveChange = typeof MoveChange.Type;

/** A pending resize: the structure's footprint becomes `footprint`. */
export const ResizeChange = Schema.Struct({
  kind: Schema.Literal("resize"),
  structureId,
  footprint: Footprint,
}).annotate(
  objectMessages("A resize has only kind, structureId and footprint.")
);

export type ResizeChange = typeof ResizeChange.Type;

/**
 * One pending layout change. Each kind names what it changes, so a later
 * kind, such as a reroute keyed by hop id, joins the union without touching
 * these.
 */
export const LayoutChange = Schema.Union([MoveChange, ResizeChange]).annotate({
  message:
    'expected a layout change: { kind: "move", structureId, position: { x, y } } or { kind: "resize", structureId, footprint: { w, d } }.',
});

export type LayoutChange = typeof LayoutChange.Type;

/** The key a change is unique by: one move and one resize per structure. */
export const layoutChangeKey = (change: LayoutChange) =>
  `${change.kind}:${change.structureId}`;

/** Whether two changes do the same thing to the same structure. */
const sameChange = (a: LayoutChange, b: LayoutChange) => {
  if (a.structureId !== b.structureId) {
    return false;
  }

  if (a.kind === "move" && b.kind === "move") {
    return a.position.x === b.position.x && a.position.y === b.position.y;
  }

  return (
    a.kind === "resize" &&
    b.kind === "resize" &&
    a.footprint.w === b.footprint.w &&
    a.footprint.d === b.footprint.d
  );
};

const unique = (changes: readonly LayoutChange[]) =>
  new Set(Arr.map(changes, layoutChangeKey)).size === changes.length;

/** A list of pending layout changes, at most one of each kind per structure. */
export const LayoutChanges = Schema.Array(LayoutChange)
  .annotate({
    message:
      "expected an array of layout changes, each a move or a resize of one structure.",
  })
  .check(
    Schema.makeFilter(unique, {
      message:
        "expected at most one move and one resize for each structure. Merge the repeated changes into one.",
    })
  );

/**
 * `proposals.json`: everything pending that hasn't been accepted. Today it
 * holds the pending layout changes, in `layout`. Proposals, batches and
 * verdicts join as further optional fields beside it, so a file written now
 * still reads after they arrive. `revision` goes up by one on every write,
 * and a write names the revision it was based on.
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

/** Where `changes` put a structure the accepted layout places at `placement`. */
const placementWith = (
  placement: Placement,
  changes: readonly LayoutChange[]
): Placement =>
  Arr.reduce(changes, placement, (current, change) =>
    change.kind === "move"
      ? { ...current, ...change.position }
      : { ...current, ...change.footprint }
  );

const changesFor = (changes: readonly LayoutChange[], id: string) =>
  Arr.filter(changes, (change) => change.structureId === id);

/**
 * The layout the page shows while editing: the accepted layout with every
 * pending change applied. A change for a structure the layout doesn't place
 * is skipped.
 */
export const applyLayoutChanges: {
  (changes: readonly LayoutChange[]): (layout: Layout) => Layout;
  (layout: Layout, changes: readonly LayoutChange[]): Layout;
} = dual(2, (layout: Layout, changes: readonly LayoutChange[]): Layout =>
  changes.length === 0
    ? layout
    : {
        ...layout,
        structures: Rec.map(layout.structures, (placement, id) =>
          placementWith(placement, changesFor(changes, id))
        ),
      }
);

/**
 * The changes that take a structure from `accepted` to `next`: a move when
 * its position differs, a resize when its footprint does, and nothing when
 * it's where it was accepted.
 */
const changesBetween = (
  structure: string,
  accepted: Placement,
  next: Placement
): readonly LayoutChange[] => [
  ...(accepted.x === next.x && accepted.y === next.y
    ? []
    : [
        MoveChange.make({
          kind: "move",
          structureId: structure,
          position: { x: next.x, y: next.y },
        }),
      ]),
  ...(accepted.w === next.w && accepted.d === next.d
    ? []
    : [
        ResizeChange.make({
          kind: "resize",
          structureId: structure,
          footprint: { w: next.w, d: next.d },
        }),
      ]),
];

/**
 * `changes` with structure `id`'s changes replaced by those that put it at
 * `next`. The other structures' changes keep their order.
 */
export const replaceChanges = ({
  changes,
  accepted,
  id,
  next,
}: {
  readonly changes: readonly LayoutChange[];
  readonly accepted: Layout;
  readonly id: string;
  readonly next: Placement;
}): readonly LayoutChange[] => {
  const before = accepted.structures[id];

  return [
    ...Arr.filter(changes, (change) => change.structureId !== id),
    ...(before === undefined ? [] : changesBetween(id, before, next)),
  ];
};

/** Another structure whose footprint `placement` would overlap. */
export interface Clash {
  readonly id: string;
  readonly placement: Placement;
}

/**
 * The first structure in `layout`, other than `id`, whose footprint
 * `placement` overlaps.
 */
export const clashOf = ({
  layout,
  id,
  placement,
}: {
  readonly layout: Layout;
  readonly id: string;
  readonly placement: Placement;
}): Option.Option<Clash> =>
  Option.map(
    Arr.findFirst(
      Rec.toEntries(layout.structures),
      ([other, at]) => other !== id && footprintsOverlap(placement, at)
    ),
    ([other, at]) => ({ id: other, placement: at })
  );

const describePlacement = ({ x, y, w, d }: Placement) =>
  `x ${x}, y ${y}, w ${w}, d ${d}`;

/**
 * Why going from the pending changes `before` to `after` is refused, or
 * nothing when it's allowed. A change that's new or different must name a
 * structure the accepted layout places, and must leave that structure's
 * footprint clear of every other footprint in the resulting layout. Changes
 * kept as they were, and changes removed, are never refused, so a discard
 * always goes through.
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
  const touched = Arr.dedupe(
    Arr.flatMap(after, (change) =>
      Arr.some(before, (kept) => sameChange(kept, change))
        ? []
        : [change.structureId]
    )
  );

  const unplaced = Arr.findFirst(
    touched,
    (id) => accepted.structures[id] === undefined
  );

  if (Option.isSome(unplaced)) {
    return Option.some(
      `No structure in the layout has the id "${unplaced.value}". Move or resize a structure the map draws.`
    );
  }

  const effective = applyLayoutChanges(accepted, after);

  return Arr.findFirst(touched, (id) => {
    const placement = effective.structures[id];

    if (placement === undefined) {
      return Option.none();
    }

    return Option.map(
      clashOf({ layout: effective, id, placement }),
      (clash) =>
        `${id} at ${describePlacement(placement)} would overlap "${clash.id}" at ${describePlacement(clash.placement)}. Pick a free spot.`
    );
  });
};

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
      ids.has(change.structureId)
        ? []
        : [
            mapWarning({
              file: "proposals.json",
              path: ["layout", index, "structureId"],
              message: `no structure in data.mjs has the id "${change.structureId}", so this ${change.kind} does nothing. Discard it from the page's Pending list.`,
            }),
          ]
    );

    const effective = applyLayoutChanges(layout, proposals.layout);

    const pending = Arr.dedupe(
      Arr.map(proposals.layout, (change) => change.structureId)
    );

    const overlaps = Arr.flatMap(pending, (id) => {
      const placement = effective.structures[id];

      if (placement === undefined) {
        return [];
      }

      return Option.match(clashOf({ layout: effective, id, placement }), {
        onNone: () => [],
        onSome: (clash) => [
          mapWarning({
            file: "proposals.json",
            path: ["layout"],
            message: `the pending change to "${id}" makes its footprint overlap "${clash.id}". Move it again in the page, or discard the change.`,
          }),
        ],
      });
    });

    return [...stale, ...overlaps];
  }
);
