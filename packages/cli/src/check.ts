/* oxlint-disable perfectionist/sort-objects -- schema and table field order sets encoded JSON key order, message order and listing order, so it stays as written */
import {
  formatCount,
  formatProblem,
  MapProblem,
  splitProblems,
} from "@axonometric/contracts";
import { Console, Effect, Option, Schema } from "effect";
import { Argument, CliError, Command, Flag } from "effect/cli";

import { homePaths } from "./home-paths.ts";
import { inspectMap } from "./map-files.ts";

/** What `check --json` prints. */
const CheckReport = Schema.Struct({
  home: Schema.String,
  ok: Schema.Boolean,
  errors: Schema.Array(MapProblem),
  warnings: Schema.Array(MapProblem),
  /** Why the source checks were skipped, or null when they ran. */
  sourcesSkipped: Schema.NullOr(Schema.String),
});

const encodeReport = Schema.encodeEffect(Schema.fromJsonString(CheckReport));

/** The map has errors. `check` has already printed them. */
export class CheckFailed extends Schema.TaggedError<
  CheckFailed,
  { readonly brand: unique symbol }
>()("CheckFailed", { home: Schema.String, errors: Schema.Int }) {
  public override get [CliError.userMessage]() {
    return `The map in ${this.home} has ${formatCount(this.errors, "error")}.`;
  }
}

const check = Effect.fn("check")(function* (home: string, json: boolean) {
  const paths = yield* homePaths(home);

  const { problems, sourcesSkipped } = yield* inspectMap(paths, {
    drawingWarnings: true,
    strictProposals: true,
    strictHistory: true,
  });

  const { errors, warnings } = splitProblems(problems);

  if (json) {
    const reportText = yield* encodeReport({
      home,
      ok: errors.length === 0,
      errors,
      warnings,
      sourcesSkipped: Option.getOrNull(sourcesSkipped),
    });

    yield* Console.log(reportText);
  } else {
    yield* Option.match(sourcesSkipped, {
      onNone: () => Effect.void,
      onSome: (line) => Console.log(line),
    });

    yield* Effect.forEach(
      problems,
      (problem) => Console.log(formatProblem(problem)),
      { discard: true, concurrency: 1 }
    );

    yield* Console.log(
      `${home}: ${formatCount(errors.length, "error")}, ${formatCount(warnings.length, "warning")}.`
    );
  }

  return errors.length > 0
    ? yield* CheckFailed.make({ home, errors: errors.length })
    : undefined;
});

export const checkCommand = Command.make(
  "check",
  {
    home: Argument.Directory("home", { mustExist: true }).pipe(
      Argument.withDescription(
        "The map's home folder, holding data.mjs and layout.json"
      )
    ),
    json: Flag.Boolean("json").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "Print { home, ok, errors, warnings } as JSON instead of text"
      )
    ),
  },
  ({ home, json }) => check(home, json)
).pipe(
  Command.withDescription(
    "Report the map's errors and warnings without writing anything. Exits 1 on errors."
  )
);
