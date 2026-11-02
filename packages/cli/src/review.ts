import {
  breakageOf,
  changedLayoutNotice,
  engineerTextNotice,
  oldestOpenBatch,
  ReviewReport,
  specOf,
} from "@axonometric/contracts";
import type {
  Batch,
  BatchItem,
  Hop,
  Layout,
  ReportedItem,
} from "@axonometric/contracts";
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
import { loadReviewMap, structureNames } from "./review-shared.ts";

const encodeReport = Schema.encodeEffect(Schema.fromJsonString(ReviewReport));

const encodeFacts = Schema.encodeEffect(
  Schema.fromJsonString(Schema.NullOr(Schema.Json))
);

const reportItem = ({
  item,
  batch,
  replaces,
  layout,
  names,
  hops,
}: {
  readonly item: BatchItem;
  readonly batch: Batch;
  /** For items reopened after a rejection, the rejected item's id. */
  readonly replaces: Readonly<Record<string, string>> | undefined;
  readonly layout: Layout;
  readonly names: ReadonlyMap<string, string>;
  readonly hops: readonly Hop[];
}): ReportedItem => {
  const spec = specOf(item);

  // A reroute acts on a hop, which the engineer knows by its label.
  const nameOf = (id: string) =>
    item.kind === "layout" && item.change.kind === "reroute"
      ? Arr.findFirst(hops, (hop) => hop.id === id).pipe(
          Option.map(({ label }) => label),
          Option.getOrElse(() => id)
        )
      : (names.get(id) ?? id);

  const { before, after } = spec.facts(item, layout);
  const structureIds = new Set(names.keys());

  return {
    id: item.id,
    kind: spec.name(item),
    targets: Arr.map(spec.targets(item), (id) => ({
      id,
      name: nameOf(id),
    })),
    before,
    after,
    breaks: Option.getOrNull(breakageOf({ item, layout, structureIds, hops })),
    replaces: Option.getOrNull(Rec.get(replaces ?? {}, item.id)),
    verdict: Option.getOrNull(Rec.get(batch.verdicts, item.id)),
  };
};

const textOf = Effect.fnUntraced(function* (item: ReportedItem) {
  const before = yield* encodeFacts(item.before);
  const after = yield* encodeFacts(item.after);
  const why = Option.fromNullishOr(item.verdict?.reason);

  const targets = Arr.map(
    item.targets,
    ({ id, name }) => `${JSON.stringify(name)} (${id})`
  );

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

  const map = yield* loadReviewMap(home, "review");
  const names = structureNames(map.data);
  const oldest = oldestOpenBatch(map.proposals);
  const absolute = path.resolve(home);

  const items = Option.match(oldest, {
    onNone: () => [],
    onSome: (batch) =>
      Arr.map(batch.items, (item) =>
        reportItem({
          item,
          batch,
          replaces: map.proposals.replaces,
          layout: map.layout,
          names,
          hops: map.data.hops,
        })
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
        engineerTextNotice,
        changedLayoutNotice,
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
