import {
  formatCount,
  formatProblem,
  MapProblem,
  splitProblems,
} from "@axonometric/contracts";
import { Console, Effect, Option, Path, Schema } from "effect";
import { Argument, CliError, Command, Flag } from "effect/cli";

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
  const path = yield* Path.Path;

  const { problems, sourcesSkipped } = yield* inspectMap(
    home,
    path.dirname(home)
  );

  const { errors, warnings } = splitProblems(problems);

  if (json) {
    yield* Console.log(
      yield* encodeReport({
        home,
        ok: errors.length === 0,
        errors,
        warnings,
        sourcesSkipped: Option.getOrNull(sourcesSkipped),
      })
    );
  } else {
    yield* Option.match(sourcesSkipped, {
      onNone: () => Effect.void,
      onSome: (line) => Console.log(line),
    });

    yield* Effect.forEach(
      problems,
      (problem) => Console.log(formatProblem(problem)),
      { discard: true }
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
