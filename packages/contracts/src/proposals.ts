import {
  Array as Arr,
  Match,
  Option,
  Record as Rec,
  Schema,
  String as Str,
} from "effect";
import { dual } from "effect/Function";

import { fileVersionFields, objectMessages } from "./fields.ts";
import { footprintsOverlap, offEndFindings } from "./layout-checks.ts";
import type { HopEnds } from "./layout-checks.ts";
import { GridPoint, JsonText, Placement, RouteOverride } from "./layout.ts";
import type { Layout } from "./layout.ts";
import type { MapData } from "./map-data.ts";
import { mapWarning } from "./problems.ts";
import type { MapProblem } from "./problems.ts";
import { StructureChange, StructureId } from "./structure-change.ts";

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

const hopIdMessage = "expected the id of a hop in data.mjs.";

/** A hop, named by its id in data.mjs. */
export const HopTarget = Schema.Struct({
  kind: Schema.Literal("hop"),
  id: Schema.String.annotate({ message: hopIdMessage }).check(
    Schema.isNonEmpty({ message: hopIdMessage })
  ),
}).annotate(objectMessages("A hop target has only kind and id."));

export type HopTarget = typeof HopTarget.Type;

/**
 * What a change acts on: a structure, or a hop. A group move has no target
 * of its own. It is a move that lists every member of the group.
 */
export const Target = Schema.Union([StructureTarget, HopTarget]).annotate({
  message:
    'expected a target: { kind: "structure", id } or { kind: "hop", id }.',
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
 * A pending reroute: hop `target`'s route override becomes `points`, from the
 * edge of one footprint to the edge of the other. `null` puts the hop back on
 * automatic routing, which is "Reset route".
 */
export const RerouteChange = Schema.Struct({
  id: ChangeId,
  kind: Schema.Literal("reroute"),
  target: HopTarget,
  points: Schema.NullOr(RouteOverride),
}).annotate(objectMessages("A reroute has only id, kind, target and points."));

export type RerouteChange = typeof RerouteChange.Type;

/**
 * One pending layout change. Each kind names what it acts on, so a later
 * kind joins the union without touching these. Moving a whole group is a
 * `move` that lists every member.
 */
export const LayoutChange = Schema.Union([
  MoveChange,
  ResizeChange,
  RerouteChange,
]).annotate({
  message:
    'expected a layout change: { id, kind: "move", moves: [{ target, position: { x, y } }] }, { id, kind: "resize", target, footprint: { w, d } } or { id, kind: "reroute", target: { kind: "hop", id }, points: [{ x, y }, ...] or null }.',
});

export type LayoutChange = typeof LayoutChange.Type;

const sameChange = Schema.toEquivalence(LayoutChange);

/** The key a change is listed by: its id. */
export const layoutChangeKey = (change: LayoutChange) => change.id;

/** The ids of the structures a change acts on. A reroute acts on none. */
export const structuresOf = (change: LayoutChange): readonly string[] =>
  Match.value(change).pipe(
    Match.discriminatorsExhaustive("kind")({
      move: ({ moves }) => Arr.map(moves, ({ target }) => target.id),
      resize: ({ target }) => [target.id],
      reroute: () => [],
    })
  );

/** The ids of the hops a change acts on. Only a reroute acts on one. */
export const hopsOf = (change: LayoutChange): readonly string[] =>
  Match.value(change).pipe(
    Match.discriminatorsExhaustive("kind")({
      move: () => [],
      resize: () => [],
      reroute: ({ target }) => [target.id],
    })
  );

/**
 * The ids of everything a change acts on, structures first and then hops.
 * They may repeat across kinds; `targetKeysOf` tells those apart.
 */
export const targetIdsOf = (change: LayoutChange): readonly string[] => [
  ...structuresOf(change),
  ...hopsOf(change),
];

/**
 * What a change acts on, keyed by what it is: `structure:engineer` and
 * `hop:engineer` are different targets, so a structure and a hop that share
 * an id never collide.
 */
export const targetKeysOf = (change: LayoutChange): readonly string[] => [
  ...Arr.map(structuresOf(change), (id) => `structure:${id}`),
  ...Arr.map(hopsOf(change), (id) => `hop:${id}`),
];

/** The id inside a key from `targetKeysOf`, for a message. */
export const idOfTargetKey = (key: string): string =>
  Str.slice(Str.indexOf(":")(key).pipe(Option.getOrElse(() => -1)) + 1)(key);

/**
 * The first target that a change in `candidates` shares with a change in
 * `held`, or nothing. Structures and hops are told apart by kind.
 */
export const sharedTarget: {
  (
    held: readonly LayoutChange[]
  ): (candidates: readonly LayoutChange[]) => Option.Option<string>;
  (
    candidates: readonly LayoutChange[],
    held: readonly LayoutChange[]
  ): Option.Option<string>;
} = dual(
  2,
  (
    candidates: readonly LayoutChange[],
    held: readonly LayoutChange[]
  ): Option.Option<string> => {
    const taken = new Set(Arr.flatMap(held, targetKeysOf));

    return Arr.findFirst(Arr.flatMap(candidates, targetKeysOf), (key) =>
      taken.has(key)
    );
  }
);

/** Whether two lists make the same changes in the same order. */
export const sameLayoutChanges: {
  (b: readonly LayoutChange[]): (a: readonly LayoutChange[]) => boolean;
  (a: readonly LayoutChange[], b: readonly LayoutChange[]): boolean;
} = dual(
  2,
  (a: readonly LayoutChange[], b: readonly LayoutChange[]) =>
    a.length === b.length &&
    Arr.every(a, (change, index) => {
      const other = b[index];

      return other !== undefined && sameChange(change, other);
    })
);

const uniqueIds = (changes: readonly LayoutChange[]) =>
  new Set(Arr.map(changes, layoutChangeKey)).size === changes.length;

/**
 * An ordered list of pending layout changes. Order decides: the page shows
 * the changes applied in turn, so a later change wins over an earlier one
 * on the same structure.
 */
export const LayoutChanges = Schema.Array(LayoutChange)
  .annotate({
    message:
      "expected an array of layout changes, each a move, a resize or a reroute.",
  })
  .check(
    Schema.makeFilter(uniqueIds, {
      message: "expected every change to have its own id.",
    })
  );

/** The most characters a note holds. */
export const maxNoteLength = 2000;

const noteFix = `expected a note of 1 to ${maxNoteLength} characters.`;

/** A note's text: non-empty, and not longer than `maxNoteLength`. */
export const NoteText = Schema.String.annotate({ message: noteFix }).check(
  Schema.isNonEmpty({ message: noteFix }),
  Schema.isMaxLength(maxNoteLength, { message: noteFix })
);

/** A note pinned to a target, for the agent to read. */
export const Note = Schema.Struct({
  id: ChangeId,
  target: StructureTarget,
  text: NoteText,
}).annotate(objectMessages("A note has only id, target and text."));

export type Note = typeof Note.Type;

/** An open proposal to add, delete or change a structure. */
export const StructureProposal = Schema.Struct({
  id: ChangeId,
  change: StructureChange,
}).annotate(objectMessages("A structure proposal has only id and change."));

export type StructureProposal = typeof StructureProposal.Type;

/** The most characters a verdict's reason holds. */
export const maxReasonLength = 1000;

const reasonMessage = `expected a reason of 1 to ${maxReasonLength} characters.`;

/** Why the agent decided as it did. */
export const Reason = Schema.String.annotate({
  message: reasonMessage,
}).check(
  Schema.isNonEmpty({ message: reasonMessage }),
  Schema.isMaxLength(maxReasonLength, { message: reasonMessage })
);

export type Reason = typeof Reason.Type;

/** A reason that must be there: for a verdict that changes or turns down an item, and for a revision's rejected items. */
export const RequiredReason = Reason.pipe(
  Schema.annotateKey({
    messageMissingKey:
      "missing. Say why: what you changed and why, or why you rejected the item.",
  })
);

/**
 * The agent's decision on one item. A reason is optional for `accepted` and
 * required for `changed` and `rejected`.
 */
export const Verdict = Schema.Union([
  Schema.Struct({
    verdict: Schema.Literal("accepted"),
    reason: Schema.optionalKey(Reason),
  }).annotate(
    objectMessages("An accepted verdict has only verdict and reason.")
  ),
  Schema.Struct({
    verdict: Schema.Literal("changed"),
    reason: RequiredReason,
    /** For a new structure the agent took under another id: the final id. */
    as: Schema.optionalKey(StructureId),
  }).annotate(
    objectMessages("A changed verdict has only verdict, reason and as.")
  ),
  Schema.Struct({
    verdict: Schema.Literal("rejected"),
    reason: RequiredReason,
  }).annotate(
    objectMessages("A rejected verdict has only verdict and reason.")
  ),
]).annotate({
  message:
    'expected a verdict: { verdict: "accepted", reason? }, { verdict: "changed", reason, as? } or { verdict: "rejected", reason }.',
});

export type Verdict = typeof Verdict.Type;

/** The three things a verdict can say. */
export const verdictKinds = ["accepted", "changed", "rejected"] as const;

/**
 * One item frozen into a batch. It keeps the id it had when open, and `kind`
 * says what it is, so a later kind of proposal joins this union and a file
 * written before it still reads.
 */
export const BatchItem = Schema.Union([
  Schema.Struct({
    id: ChangeId,
    kind: Schema.Literal("layout"),
    change: LayoutChange,
  }).annotate(objectMessages("A layout item has only id, kind and change.")),
  Schema.Struct({
    id: ChangeId,
    kind: Schema.Literal("note"),
    target: StructureTarget,
    text: NoteText,
  }).annotate(
    objectMessages("A note item has only id, kind, target and text.")
  ),
  Schema.Struct({
    id: ChangeId,
    kind: Schema.Literal("structure"),
    change: StructureChange,
  }).annotate(
    objectMessages("A structure item has only id, kind and change.")
  ),
]).annotate({
  message:
    'expected a batch item: { id, kind: "layout", change }, { id, kind: "note", target, text } or { id, kind: "structure", change }.',
});

export type BatchItem = typeof BatchItem.Type;

const isoMessage =
  "expected the date and time as ISO 8601 in UTC, such as 2026-11-01T09:00:00.000Z.";

const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;

const Iso = Schema.String.annotate({ message: isoMessage }).check(
  Schema.isPattern(isoPattern, { message: isoMessage })
);

/** When a batch was committed, and the revision that holds its outcome. */
export const Committed = Schema.Struct({
  revision: Schema.Int,
  at: Iso,
}).annotate(objectMessages("A commit has only revision and at."));

export type Committed = typeof Committed.Type;

/**
 * The proposals frozen by one press of "Ready for review". Its items can't
 * be edited or discarded while it waits for the agent. `verdicts` is keyed by
 * item id. `committed` is set when the agent commits the batch. `dismissed`
 * lists the items the engineer has taken off the page since.
 */
export const Batch = Schema.Struct({
  number: Schema.Int.annotate({
    message: "expected a whole number. Batches start at 1.",
  }).check(
    Schema.isGreaterThanOrEqualTo(1, {
      message: "expected 1 or more. Batches start at 1.",
    })
  ),
  frozenAt: Iso,
  items: Schema.Array(BatchItem),
  verdicts: Schema.Record(ChangeId, Verdict),
  committed: Schema.optionalKey(Committed),
  dismissed: Schema.optionalKey(Schema.Array(ChangeId)),
}).annotate(
  objectMessages(
    "A batch has only number, frozenAt, items, verdicts, committed and dismissed."
  )
);

export type Batch = typeof Batch.Type;

const allIds = (proposals: {
  readonly layout: readonly LayoutChange[];
  readonly notes?: readonly Note[] | undefined;
  readonly structures?: readonly StructureProposal[] | undefined;
  readonly batches?: readonly Batch[] | undefined;
}) => [
  ...Arr.map(proposals.layout, layoutChangeKey),
  ...Arr.map(proposals.notes ?? [], ({ id }) => id),
  ...Arr.map(proposals.structures ?? [], ({ id }) => id),
  ...Arr.flatMap(proposals.batches ?? [], ({ items }) =>
    Arr.map(items, ({ id }) => id)
  ),
];

const hasUniqueIds = (proposals: Parameters<typeof allIds>[0]) => {
  const ids = allIds(proposals);

  return new Set(ids).size === ids.length;
};

/**
 * `proposals.json`: everything pending that hasn't been accepted.
 *
 * - `layout`: the open layout changes, not yet in a batch.
 * - `notes`: the open notes.
 * - `structures`: the open proposals to add, delete or change a structure.
 * - `batches`: the numbered batches, each with its verdicts once given.
 * - `replaces`: for an item the engineer reopened after a rejection, the id
 *   of the rejected item it takes up again, keyed by the new item's id. It
 *   works for every kind of item, so a new kind needs nothing here.
 *
 * Each kind of proposal adds its own optional list, and `BatchItem` gains
 * a member, so a file written before a kind existed still reads. `revision`
 * is the file revision: it goes up by one on every write, and a write names
 * the one it was based on.
 */
export const Proposals = Schema.Struct({
  ...fileVersionFields,
  layout: LayoutChanges.pipe(
    Schema.annotateKey({
      messageMissingKey:
        "missing. Add layout: [] to hold the pending layout changes.",
    })
  ),
  notes: Schema.optionalKey(Schema.Array(Note)),
  structures: Schema.optionalKey(Schema.Array(StructureProposal)),
  batches: Schema.optionalKey(Schema.Array(Batch)),
  replaces: Schema.optionalKey(Schema.Record(ChangeId, ChangeId)),
})
  .annotate(
    objectMessages(
      "A proposals file has only format, revision, layout, notes, structures, batches and replaces."
    )
  )
  .check(
    Schema.makeFilter(hasUniqueIds, {
      message: "expected every change, note and batch item to have its own id.",
    })
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

/** One thing a change sets on the layout. */
type Setting =
  | {
      readonly what: "place";
      readonly id: string;
      readonly placement: Partial<Placement>;
    }
  | {
      readonly what: "route";
      readonly id: string;
      readonly points: readonly GridPoint[] | null;
    };

/**
 * The layout the page shows while editing: the accepted layout with every
 * pending change applied in list order. A change for a structure the layout
 * doesn't place is skipped. A reroute sets the hop's route override, or
 * removes it when its points are `null`.
 */
export const applyLayoutChanges: {
  (changes: readonly LayoutChange[]): (layout: Layout) => Layout;
  (layout: Layout, changes: readonly LayoutChange[]): Layout;
} = dual(2, (layout: Layout, changes: readonly LayoutChange[]): Layout => {
  if (changes.length === 0) {
    return layout;
  }

  const placements = new Map(Rec.toEntries(layout.structures));
  const routes = new Map(Rec.toEntries(layout.routes ?? {}));

  const place = (id: string, change: Partial<Placement>) => {
    const current = placements.get(id);

    if (current !== undefined) {
      placements.set(id, { ...current, ...change });
    }
  };

  const setRoute = (hop: string, points: readonly GridPoint[] | null) => {
    if (points === null) {
      routes.delete(hop);
    } else {
      routes.set(hop, points);
    }
  };

  // Each kind says what it sets; the setting happens here, in list order.
  const settings = Arr.flatMap(changes, (change) =>
    Match.value(change).pipe(
      Match.discriminatorsExhaustive("kind")({
        move: ({ moves }): readonly Setting[] =>
          Arr.map(moves, ({ target, position }) => ({
            what: "place",
            id: target.id,
            placement: position,
          })),
        resize: ({ target, footprint }): readonly Setting[] => [
          { what: "place", id: target.id, placement: footprint },
        ],
        reroute: ({ target, points }): readonly Setting[] => [
          { what: "route", id: target.id, points },
        ],
      })
    )
  );

  for (const setting of settings) {
    if (setting.what === "place") {
      place(setting.id, setting.placement);
    } else {
      setRoute(setting.id, setting.points);
    }
  }

  const { routes: _saved, ...rest } = layout;
  const shown: Layout = { ...rest, structures: Rec.fromEntries(placements) };

  return routes.size === 0
    ? shown
    : { ...shown, routes: Rec.fromEntries(routes) };
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

const routeOf = (layout: Layout, hop: string): readonly GridPoint[] | null =>
  layout.routes?.[hop] ?? null;

const samePoints = (
  a: readonly GridPoint[] | null,
  b: readonly GridPoint[] | null
) =>
  a === null || b === null
    ? a === b
    : a.length === b.length &&
      Arr.every(a, (point, index) => {
        const other = b[index];

        return (
          other !== undefined && other.x === point.x && other.y === point.y
        );
      });

/** What `placeRoute` takes. */
export interface PlacingRoute {
  readonly changes: readonly LayoutChange[];
  readonly accepted: Layout;
  readonly hop: string;
  /** The route override to set, or `null` to go back to automatic routing. */
  readonly points: readonly GridPoint[] | null;
  /** Makes the id of a change that has to be added. */
  readonly newId: () => ChangeId;
}

/**
 * The changes after hop `hop` is given the route override `points`, or none
 * with `null`. A hop that already has a reroute keeps its id as the route
 * changes. A route that leaves the hop as the rest of the list already has it,
 * such as a reset of a hop with no override, drops the change instead.
 */
export const placeRoute = ({
  changes,
  accepted,
  hop,
  points,
  newId,
}: PlacingRoute): readonly LayoutChange[] => {
  const own = (change: LayoutChange) =>
    change.kind === "reroute" && change.target.id === hop;

  const others = Arr.filter(changes, (change) => !own(change));
  const before = routeOf(applyLayoutChanges(accepted, others), hop);

  if (samePoints(before, points)) {
    return others;
  }

  const old = Arr.findLast(changes, own);

  return [
    ...others,
    {
      id: Option.match(old, { onNone: newId, onSome: (change) => change.id }),
      kind: "reroute",
      target: { kind: "hop", id: hop },
      points,
    },
  ];
};

/**
 * The reroutes that carry route overrides along with moved structures. An
 * override whose two ends both move by the same distance is shifted by it,
 * so it still starts and ends on its footprints. Overrides with one end
 * moved, or the ends moved apart, are left alone: the move is refused if
 * that leaves one off its footprint. `layout` is the layout the moves start
 * from, and `id` makes the id of each reroute from its hop's id.
 */
export const shiftedRoutes = ({
  layout,
  hops,
  moves,
  id,
}: {
  readonly layout: Layout;
  readonly hops: readonly HopEnds[];
  readonly moves: readonly StructureMove[];
  readonly id: (hop: string) => ChangeId;
}): readonly LayoutChange[] => {
  const deltas = new Map(
    Arr.flatMap(moves, ({ target, position }) => {
      const at = layout.structures[target.id];

      return at === undefined
        ? []
        : [
            [
              target.id,
              { x: position.x - at.x, y: position.y - at.y },
            ] as const,
          ];
    })
  );

  return Arr.flatMap(hops, ({ id: hop, from, to }): readonly LayoutChange[] => {
    const points = layout.routes?.[hop];
    const start = deltas.get(from);
    const end = deltas.get(to);

    if (
      points === undefined ||
      start === undefined ||
      end === undefined ||
      start.x !== end.x ||
      start.y !== end.y ||
      (start.x === 0 && start.y === 0)
    ) {
      return [];
    }

    return [
      {
        id: id(hop),
        kind: "reroute",
        target: { kind: "hop", id: hop },
        points: Arr.map(points, ({ x, y }) => ({
          x: x + start.x,
          y: y + start.y,
        })),
      },
    ];
  });
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

/** The hops that a list of changes acts on. */
const hopsIn = (changes: readonly LayoutChange[]) =>
  Arr.dedupe(Arr.flatMap(changes, hopsOf));

/**
 * The ends of route overrides in `layout` that aren't on their hops'
 * footprints, such as `h-save first`.
 */
const offEndKeys = (hops: readonly HopEnds[], layout: Layout) =>
  new Set(
    Arr.map(offEndFindings(hops, layout), ({ hop, end }) => `${hop.id} ${end}`)
  );

/**
 * Why going from the pending changes `before` to `after` is refused, or
 * nothing when it's allowed. `hops` are the map's hops, which say where a
 * reroute's ends belong.
 *
 * - A change that's new or different must act on structures the accepted
 *   layout places and hops the map has, and must leave each footprint clear
 *   of every other footprint in the resulting layout. That holds for a
 *   group move too: a move that lists a group's members is refused when any
 *   of them would land on a structure outside the group.
 * - A change that's removed, a discard, is refused when it puts a structure
 *   back on top of one with a pending change of its own. The message names
 *   that change. Overlaps with structures that have no pending change were
 *   already there in the accepted layout, so they don't stop a discard.
 * - No list may leave a route override that doesn't start and end on its
 *   hop's footprints, which `check` reports as an error, when the list
 *   before it didn't. So a move of a structure whose hop has an override is
 *   refused until the route is reset or moved with it.
 * - Changes kept as they were are never checked again.
 */
export const layoutRefusal = ({
  accepted,
  before,
  after,
  hops,
}: {
  readonly accepted: Layout;
  readonly before: readonly LayoutChange[];
  readonly after: readonly LayoutChange[];
  readonly hops: readonly HopEnds[];
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

  const known = new Map(Arr.map(hops, (hop) => [hop.id, hop]));
  const unknownHop = Arr.findFirst(hopsIn(added), (id) => !known.has(id));

  if (Option.isSome(unknownHop)) {
    return Option.some(
      `No hop in the map has the id "${unknownHop.value}". Reroute a hop the map draws.`
    );
  }

  const unroutable = Arr.findFirst(hopsIn(added), (id) => {
    const hop = known.get(id);

    return (
      hop === undefined ||
      !Rec.has(accepted.structures, hop.from) ||
      !Rec.has(accepted.structures, hop.to)
    );
  });

  if (Option.isSome(unroutable)) {
    return Option.some(
      `Hop "${unroutable.value}" has an end the layout doesn't place, so it can't be rerouted.`
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

  const wasOff = offEndKeys(hops, applyLayoutChanges(accepted, before));

  const nowOff = Arr.findFirst(
    offEndFindings(hops, effective),
    ({ hop, end }) => !wasOff.has(`${hop.id} ${end}`)
  );

  if (Option.isSome(nowOff)) {
    const { hop, end } = nowOff.value;

    return Option.some(
      `This would leave the route of hop "${hop.id}" ${end === "first" ? "starting" : "ending"} off the edge of "${end === "first" ? hop.from : hop.to}", which check reports as an error. Reset the route of hop "${hop.id}" first, then move the structure.`
    );
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

/** One thing a change names, and where its id sits in the change. */
interface NamedTarget {
  readonly what: "structure" | "hop";
  readonly id: string;
  readonly path: readonly (string | number)[];
}

/** Each thing a change names, with where its id sits in the change. */
const targetPaths = (change: LayoutChange): readonly NamedTarget[] =>
  Match.value(change).pipe(
    Match.discriminatorsExhaustive("kind")({
      move: ({ moves }): readonly NamedTarget[] =>
        Arr.map(moves, ({ target }, index) => ({
          what: "structure",
          id: target.id,
          path: ["moves", index, "target", "id"],
        })),
      resize: ({ target }): readonly NamedTarget[] => [
        { what: "structure", id: target.id, path: ["target", "id"] },
      ],
      reroute: ({ target }): readonly NamedTarget[] => [
        { what: "hop", id: target.id, path: ["target", "id"] },
      ],
    })
  );

/**
 * Warnings about the pending changes in `proposals.json`: changes and notes
 * for a structure or hop data.mjs doesn't have, pending footprints that
 * overlap, and pending route overrides that don't start and end on their
 * hops' footprints. The last two happen when the accepted layout changes
 * under a pending change.
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
    const known = {
      structure: new Set(Arr.map(data.structures, ({ id }) => id)),
      hop: new Set(Arr.map(data.hops, ({ id }) => id)),
    };

    const stale = Arr.flatMap(proposals.layout, (change, index) =>
      Arr.flatMap(targetPaths(change), ({ what, id, path }) =>
        known[what].has(id)
          ? []
          : [
              mapWarning({
                file: "proposals.json",
                path: ["layout", index, ...path],
                message: `no ${what} in data.mjs has the id "${id}", so this ${change.kind} does nothing. Discard it from the page's Pending list.`,
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

    const wasOff = offEndKeys(data.hops, layout);
    const pendingHops = new Set(hopsIn(proposals.layout));
    const pendingStructures = new Set(structuresIn(proposals.layout));

    const offEnds = Arr.flatMap(
      offEndFindings(data.hops, effective),
      ({ hop, end, problem }) =>
        (pendingHops.has(hop.id) ||
          pendingStructures.has(hop.from) ||
          pendingStructures.has(hop.to)) &&
        !wasOff.has(`${hop.id} ${end}`)
          ? [
              mapWarning({
                file: "proposals.json",
                path: ["layout"],
                message: `${problem.message} Reset the route in the page, or discard the pending change.`,
              }),
            ]
          : []
    );

    const orphaned = Arr.flatMap(proposals.notes ?? [], (note, index) =>
      known.structure.has(note.target.id)
        ? []
        : [
            mapWarning({
              file: "proposals.json",
              path: ["notes", index, "target", "id"],
              message: `no structure in data.mjs has the id "${note.target.id}", so this note points at nothing. Discard it from the page's Pending list.`,
            }),
          ]
    );

    return [...stale, ...overlaps, ...offEnds, ...orphaned];
  }
);
