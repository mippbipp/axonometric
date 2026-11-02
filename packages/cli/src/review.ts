import {
  applyLayoutChanges,
  breakageOf,
  oldestOpenBatch,
  placeStructures,
  structuresOf,
} from "@axonometric/contracts";
import type { Batch, BatchItem, Layout } from "@axonometric/contracts";
import {
  Array as Arr,
  Console,
  Effect,
  Option,
  Path,
  Record as Rec,
  Schema,
} from "effect";
import { Argument, Command, Flag } from "effect/cli";

import { withLock } from "./lock.ts";
import { loadMap } from "./map-files.ts";

const Spot = Schema.Struct({ x: Schema.Finite, y: Schema.Finite });

const Size = Schema.Struct({ w: Schema.Finite, d: Schema.Finite });

/** What an item changes or leaves: positions, a size, or a note's text. */
const Facts = Schema.NullOr(
  Schema.Union([
    Schema.Record(Schema.String, Spot),
    Size,
    Schema.Struct({ text: Schema.String }),
  ])
);

type Facts = typeof Facts.Type;

const Decision = Schema.Struct({
  verdict: Schema.Literals(["accepted", "changed", "rejected"]),
  reason: Schema.optionalKey(Schema.String),
});

const ReportedItem = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  /** The structures the item acts on or is pinned to. */
  targets: Schema.Array(
    Schema.Struct({ id: Schema.String, name: Schema.String })
  ),
  /** What the map has now, or null for an item that adds something. */
  before: Facts,
  /** What accepting the item makes. */
  after: Facts,
  /** Why accepting the item would break the map, or null when it wouldn't. */
  breaks: Schema.NullOr(Schema.String),
  /** The note this one takes up again, or null. */
  replaces: Schema.NullOr(Schema.String),
  verdict: Schema.NullOr(Decision),
});

type Reported = typeof ReportedItem.Type;

/** What `review --json` prints. */
const ReviewedBatch = Schema.Struct({
  number: Schema.Int,
  frozenAt: Schema.String,
  items: Schema.Array(ReportedItem),
});

export const ReviewReport = Schema.Struct({
  home: Schema.String,
  /** The oldest batch with no commit, or null when none is waiting. */
  batch: Schema.NullOr(ReviewedBatch),
});

const encodeReport = Schema.encodeEffect(Schema.fromJsonString(ReviewReport));

const encodeFacts = Schema.encodeEffect(Schema.fromJsonString(Facts));

const positionsOf = (layout: Layout, ids: readonly string[]): Facts =>
  Rec.fromEntries(
    Arr.flatMap(ids, (id) =>
      Option.match(Rec.get(layout.structures, id), {
        onNone: () => [],
        onSome: ({ x, y }) => [[id, { x, y }] as const],
      })
    )
  );

const sizeOf = (layout: Layout, id: string): Facts =>
  Option.match(Rec.get(layout.structures, id), {
    onNone: () => null,
    onSome: ({ w, d }) => ({ w, d }),
  });

/** What the item changes, before and after, from the accepted `layout`. */
const beforeAndAfter = (item: BatchItem, layout: Layout) => {
  if (item.kind === "note") {
    return { before: null, after: { text: item.text } };
  }

  const { change } = item;
  const next = applyLayoutChanges(layout, [change]);

  if (change.kind === "move") {
    const ids = structuresOf(change);

    return {
      before: positionsOf(layout, ids),
      after: positionsOf(next, ids),
    };
  }

  return {
    before: sizeOf(layout, change.target.id),
    after: sizeOf(next, change.target.id),
  };
};

const targetsOf = (item: BatchItem) =>
  item.kind === "note" ? [item.target.id] : structuresOf(item.change);

const reportItem = ({
  item,
  batch,
  layout,
  names,
}: {
  readonly item: BatchItem;
  readonly batch: Batch;
  readonly layout: Layout;
  readonly names: ReadonlyMap<string, string>;
}): Reported => {
  const { before, after } = beforeAndAfter(item, layout);
  const structureIds = new Set(names.keys());

  return {
    id: item.id,
    kind: item.kind === "note" ? "note" : item.change.kind,
    targets: Arr.map(targetsOf(item), (id) => ({
      id,
      name: names.get(id) ?? id,
    })),
    before,
    after,
    breaks: Option.getOrNull(breakageOf({ item, layout, structureIds })),
    replaces: item.kind === "note" ? (item.replaces ?? null) : null,
    verdict: Option.getOrNull(Rec.get(batch.verdicts, item.id)),
  };
};

const textOf = Effect.fnUntraced(function* (item: Reported) {
  const before = yield* encodeFacts(item.before);
  const after = yield* encodeFacts(item.after);
  const targets = Arr.map(item.targets, ({ id, name }) => `${name} (${id})`);
  const why = Option.fromNullishOr(item.verdict?.reason);

  const verdict =
    item.verdict === null
      ? "none yet"
      : Arr.join([item.verdict.verdict, ...Option.toArray(why)], ", ");

  const lines = [
    `${item.id}  ${item.kind}  ${Arr.join(targets, ", ")}`,
    ...(item.replaces === null ? [] : [`    replaces: ${item.replaces}`]),
    `    before: ${item.before === null ? "-" : before}`,
    `    after:  ${after}`,
    ...(item.breaks === null
      ? []
      : [`    BREAKS THE MAP if accepted: ${item.breaks}`]),
    `    verdict: ${verdict}`,
  ];

  return Arr.join(lines, "\n");
});

const review = Effect.fn("review")(function* (home: string, json: boolean) {
  const path = yield* Path.Path;

  yield* withLock(home, "review");

  const map = yield* loadMap({
    home,
    output: path.dirname(home),
    command: "review",
    arrange: (data, saved) => placeStructures(data, saved).layout,
    strictProposals: true,
  });

  const names = new Map(
    Arr.map(map.data.structures, ({ id, name }) => [id, name])
  );

  const oldest = oldestOpenBatch(map.proposals);
  const absolute = path.resolve(home);

  const items = Option.match(oldest, {
    onNone: () => [],
    onSome: (batch) =>
      Arr.map(batch.items, (item) =>
        reportItem({ item, batch, layout: map.layout, names })
      ),
  });

  if (json) {
    const batch = Option.match(oldest, {
      onNone: () => null,
      onSome: ({ number, frozenAt }) => ({ number, frozenAt, items }),
    });

    return yield* Console.log(yield* encodeReport({ home: absolute, batch }));
  }

  if (Option.isNone(oldest)) {
    return yield* Console.log(
      `No batch is waiting for review in ${absolute}. The engineer presses Ready for review to send one.`
    );
  }

  const { number, frozenAt } = oldest.value;
  const undecided = Arr.filter(items, ({ verdict }) => verdict === null);
  const described = yield* Effect.forEach(items, textOf);
  const noun = items.length === 1 ? "item" : "items";

  return yield* Console.log(
    Arr.join(
      [
        `Batch ${number}, frozen ${frozenAt}: ${items.length} ${noun}, ${undecided.length} without a verdict.`,
        `Full details are in ${path.join(absolute, "proposals.json")}.`,
        "",
        Arr.join(described, "\n\n"),
        "",
        `Give each item a verdict with: axonometric verdict ${absolute} <item> accepted|changed|rejected --reason "..."`,
        `Then run: axonometric commit ${absolute}`,
      ],
      "\n"
    )
  );
}, Effect.scoped);

export const reviewCommand = Command.make(
  "review",
  {
    home: Argument.Directory("home", { mustExist: true }).pipe(
      Argument.withDescription(
        "The map's home folder, holding data.mjs and proposals.json"
      )
    ),
    json: Flag.Boolean("json").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Print { home, batch } as JSON instead of text")
    ),
  },
  ({ home, json }) => review(home, json)
).pipe(
  Command.withDescription(
    "Print the oldest batch that has no commit: each item's id, kind, target, before and after, and whether accepting it would break the map. Writes nothing."
  )
);
