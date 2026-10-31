import { pathToFileURL } from "node:url";

import {
  crossCheck,
  formatProblem,
  LayoutFile,
  MapData,
  MapProblem,
  problemsFromIssue,
} from "@axonometric/contracts";
import type { MapFile } from "@axonometric/contracts";
import {
  Array as Arr,
  Effect,
  FileSystem,
  Path,
  Random,
  Result,
  Schema,
} from "effect";
import { CliError } from "effect/cli";

/** The map files failed validation. */
export class MapInvalid extends Schema.TaggedError<
  MapInvalid,
  { readonly brand: unique symbol }
>()("MapInvalid", {
  home: Schema.String,
  problems: Schema.Array(MapProblem),
}) {
  public override get [CliError.userMessage]() {
    const count = this.problems.length;

    return Arr.join(
      [
        `The map in ${this.home} has ${count} ${count === 1 ? "problem" : "problems"}. Nothing was written.`,
        ...Arr.map(this.problems, (problem) => `  ${formatProblem(problem)}`),
      ],
      "\n"
    );
  }
}

const parseOptions = { errors: "all", onExcessProperty: "error" } as const;

const decodeData = Schema.decodeUnknownResult(MapData, parseOptions);

const decodeLayout = Schema.decodeUnknownResult(LayoutFile, parseOptions);

const problem = (file: MapFile, message: string): MapProblem => ({
  file,
  path: "",
  message,
});

const describeCause = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Imports `data.mjs` and returns its default export, still unvalidated. The
 * URL carries a random query, so a process that imports the same map twice,
 * such as the server, gets the file's current contents.
 */
const importData = Effect.fnUntraced(function* (file: string) {
  const cacheKey = yield* Random.nextInt;
  const url = `${pathToFileURL(file).href}?load=${cacheKey}`;

  const module = yield* Effect.tryPromise({
    try: (): Promise<{ readonly default?: unknown }> => import(url),
    catch: (cause) =>
      problem(
        "data.mjs",
        `could not be imported: ${describeCause(cause)}. Fix the module so Node can import it.`
      ),
  });

  if (!("default" in module)) {
    return yield* Effect.fail(
      problem(
        "data.mjs",
        "has no default export. Add export default { format: 1, revision: 0, structures: [], hops: [] }."
      )
    );
  }

  return decodeData(module.default);
});

const requireFile = Effect.fnUntraced(function* (
  file: string,
  name: MapFile,
  fix: string
) {
  const fs = yield* FileSystem.FileSystem;
  const exists = yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false));

  return exists
    ? yield* Effect.void
    : yield* Effect.fail(problem(name, `not found. ${fix}`));
});

const loadData = Effect.fnUntraced(function* (home: string) {
  const path = yield* Path.Path;
  const file = path.join(home, "data.mjs");

  yield* requireFile(
    file,
    "data.mjs",
    "Write the map's meaning there as an ES module with a default export."
  );

  const decoded = yield* importData(file);

  if (Result.isFailure(decoded)) {
    return yield* Effect.fail(
      problemsFromIssue("data.mjs", decoded.failure.issue)
    );
  }

  return decoded.success;
});

const loadLayout = Effect.fnUntraced(function* (home: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(home, "layout.json");

  yield* requireFile(
    file,
    "layout.json",
    "Write a layout.json that places every structure."
  );

  const text = yield* fs
    .readFileString(file)
    .pipe(
      Effect.mapError((cause) =>
        problem("layout.json", `could not be read: ${cause.message}`)
      )
    );

  const decoded = decodeLayout(text);

  if (Result.isFailure(decoded)) {
    return yield* Effect.fail(
      problemsFromIssue("layout.json", decoded.failure.issue)
    );
  }

  return decoded.success;
});

const problemsOf = (
  failure: MapProblem | readonly MapProblem[]
): readonly MapProblem[] => ("file" in failure ? [failure] : failure);

/**
 * Loads and validates the map in `home`. Fails with every problem found in
 * either file, so the agent can fix them all in one pass.
 */
export const loadMap = Effect.fnUntraced(function* (home: string) {
  const [data, layout] = yield* Effect.all([
    Effect.result(loadData(home)),
    Effect.result(loadLayout(home)),
  ]);

  if (Result.isSuccess(data) && Result.isSuccess(layout)) {
    const problems = crossCheck(data.success, layout.success);

    if (problems.length === 0) {
      return { data: data.success, layout: layout.success };
    }

    return yield* MapInvalid.make({ home, problems });
  }

  return yield* MapInvalid.make({
    home,
    problems: [
      ...(Result.isFailure(data) ? problemsOf(data.failure) : []),
      ...(Result.isFailure(layout) ? problemsOf(layout.failure) : []),
    ],
  });
});
