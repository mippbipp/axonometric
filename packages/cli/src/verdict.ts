import {
  maxReasonLength,
  recordVerdict,
  verdictKinds,
} from "@axonometric/contracts";
import type { Verdict } from "@axonometric/contracts";
import { Console, Effect, Option, Path, Result, String as Str } from "effect";
import { Argument, Command, Flag } from "effect/cli";

import { acceptedIds } from "./history.ts";
import { withLock } from "./lock.ts";
import { MapInvalid, encodeProposals, loadProposals } from "./map-files.ts";
import { ReviewRefused } from "./review-shared.ts";
import { writeAll } from "./write-files.ts";

/** The verdict for `kind`, or why its reason is missing or too long. */
const verdictOf = (
  kind: Verdict["verdict"],
  reason: Option.Option<string>,
  as: Option.Option<string>
): Result.Result<Verdict, string> => {
  const text = Option.filter(
    Option.map(reason, Str.trim),
    (trimmed) => trimmed !== ""
  );

  const tooLong = Option.filter(
    text,
    (given) => given.length > maxReasonLength
  );

  if (Option.isSome(tooLong)) {
    return Result.fail(
      `The reason is ${tooLong.value.length} characters, over the limit of ${maxReasonLength}. Say it shorter; the details can go in data.mjs.`
    );
  }

  const finalId = Option.filter(
    Option.map(as, Str.trim),
    (trimmed) => trimmed !== ""
  );

  if (Option.isSome(as) && kind !== "changed") {
    return Result.fail(
      '--as names the id a new structure, hop or flow was accepted under, so it goes with a changed verdict. Use: verdict <home> <item> changed --reason "..." --as <id>.'
    );
  }

  if (Option.isSome(as) && Option.isNone(finalId)) {
    return Result.fail("--as needs the id it has in data.mjs.");
  }

  if (kind === "accepted") {
    return Result.succeed(
      Option.match(text, {
        onNone: (): Verdict => ({ verdict: "accepted" }),
        onSome: (given): Verdict => ({ verdict: "accepted", reason: given }),
      })
    );
  }

  return Option.match(text, {
    onNone: () =>
      Result.fail(
        kind === "changed"
          ? 'A changed verdict needs --reason, saying what you changed and why. Add --reason "...".'
          : 'A rejected verdict needs --reason, saying why. Add --reason "...".'
      ),
    onSome: (given) =>
      Result.succeed(
        kind === "changed" && Option.isSome(finalId)
          ? { verdict: kind, reason: given, as: finalId.value }
          : { verdict: kind, reason: given }
      ),
  });
};

const verdict = Effect.fn("verdict")(function* ({
  home,
  item,
  kind,
  reason,
  as,
}: {
  readonly home: string;
  readonly item: string;
  readonly kind: Verdict["verdict"];
  readonly reason: Option.Option<string>;
  readonly as: Option.Option<string>;
}) {
  const path = yield* Path.Path;
  const decided = verdictOf(kind, reason, as);

  if (Result.isFailure(decided)) {
    return yield* ReviewRefused.make({
      command: "verdict",
      reason: decided.failure,
    });
  }

  yield* withLock(home, "verdict");

  const loaded = yield* loadProposals(home);

  if (Result.isFailure(loaded)) {
    return yield* MapInvalid.make({
      home,
      command: "verdict",
      problems: loaded.failure,
    });
  }

  const known = yield* acceptedIds(home);

  const recorded = recordVerdict({
    proposals: loaded.success,
    id: item,
    verdict: decided.success,
    accepted: known.structures,
    acceptedHops: known.hops,
    acceptedFlows: known.flows,
  });

  if (Result.isFailure(recorded)) {
    return yield* ReviewRefused.make({
      command: "verdict",
      reason: recorded.failure,
    });
  }

  yield* writeAll([
    {
      file: path.join(home, "proposals.json"),
      content: yield* encodeProposals(recorded.success),
    },
  ]);

  const why = Option.match(reason, {
    onNone: () => "",
    onSome: (given) => ` (${given})`,
  });

  const under = Option.match(as, {
    onNone: () => "",
    onSome: (id) => ` as ${id}`,
  });

  return yield* Console.log(
    `Recorded ${kind} on ${item}${under}${why}. Run axonometric commit ${path.resolve(home)} once every item has a verdict.`
  );
}, Effect.scoped);

export const verdictCommand = Command.make(
  "verdict",
  {
    home: Argument.Directory("home", { mustExist: true }).pipe(
      Argument.withDescription(
        "The map's home folder, holding data.mjs and proposals.json"
      )
    ),
    item: Argument.String("item").pipe(
      Argument.withDescription("The id of an item in the batch review printed")
    ),
    kind: Argument.Literals("verdict", verdictKinds).pipe(
      Argument.withDescription(
        "accepted, changed (you took it in another form) or rejected"
      )
    ),
    reason: Flag.String("reason").pipe(
      Flag.optional,
      Flag.withDescription(
        "Why. Required for changed and rejected; the engineer reads it on the page."
      )
    ),
    as: Flag.String("as").pipe(
      Flag.optional,
      Flag.withDescription(
        "For a new structure, hop or flow you accepted under another id: the id it has in data.mjs. Only with changed. The page follows it, and commit writes a structure's position under it."
      )
    ),
  },
  verdict
).pipe(
  Command.withDescription(
    "Record accepted, changed or rejected on one item of the oldest batch that has no commit, under the map's lock. A reason is required for changed and rejected."
  ),
  Command.withExamples([
    {
      command:
        'axonometric verdict docs/pipeline/map p-4f2a changed --reason "Called it the build cache." --as build-cache',
      description: "Accept a proposed structure under the id you gave it",
    },
    {
      command:
        'axonometric verdict docs/pipeline/map n-4f2a rejected --reason "The gate already does this."',
      description: "Reject a note and say why",
    },
  ])
);
