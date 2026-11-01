import { formatProblem, hasErrors, MapProblem } from "@axonometric/contracts";
import { Array as Arr, Console, Effect, Path, Schema } from "effect";
import { Argument, CliError, Command, Flag } from "effect/cli";

import { inspectMap } from "./map-files.ts";

/** What `check --json` prints. */
const CheckReport = Schema.Struct({
  home: Schema.String,
  ok: Schema.Boolean,
  errors: Schema.Array(MapProblem),
  warnings: Schema.Array(MapProblem),
});

const encodeReport = Schema.encodeEffect(Schema.fromJsonString(CheckReport));

/** The map has errors. `check` has already printed them. */
export class CheckFailed extends Schema.TaggedError<
  CheckFailed,
  { readonly brand: unique symbol }
>()("CheckFailed", { home: Schema.String, errors: Schema.Int }) {
  public override get [CliError.userMessage]() {
    return `The map in ${this.home} has ${this.errors} ${this.errors === 1 ? "error" : "errors"}.`;
  }
}

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

const check = Effect.fn("check")(function* (home: string, json: boolean) {
  const path = yield* Path.Path;
  const { problems } = yield* inspectMap(home, path.dirname(home));

  const errors = Arr.filter(problems, ({ severity }) => severity === "error");

  const warnings = Arr.filter(
    problems,
    ({ severity }) => severity === "warning"
  );

  if (json) {
    yield* Console.log(
      yield* encodeReport({ home, ok: errors.length === 0, errors, warnings })
    );
  } else {
    yield* Effect.forEach(
      problems,
      (problem) => Console.log(formatProblem(problem)),
      { discard: true }
    );

    yield* Console.log(
      `${home}: ${plural(errors.length, "error")}, ${plural(warnings.length, "warning")}.`
    );
  }

  return hasErrors(problems)
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
