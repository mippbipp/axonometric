import { pathToFileURL } from "node:url";

import {
  crossCheck,
  describeCause,
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

/**
 * The map files failed validation. Every load step fails with this, so
 * problems from both files can be merged into one report.
 */
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
        `The map in ${this.home} has ${count} ${count === 1 ? "problem" : "problems"}. build wrote nothing.`,
        ...Arr.map(this.problems, (problem) => `  ${formatProblem(problem)}`),
      ],
      "\n"
    );
  }
}

const parseOptions = { errors: "all", onExcessProperty: "error" } as const;

const decodeData = Schema.decodeUnknownResult(MapData, parseOptions);

const decodeLayout = Schema.decodeUnknownResult(LayoutFile, parseOptions);

/** A problem with a whole file, rather than one field in it. */
const fileProblem = (home: string, file: MapFile, message: string) =>
  MapInvalid.make({ home, problems: [{ file, path: "", message }] });

/**
 * Imports `data.mjs` and returns its default export, still unvalidated. The
 * URL carries a random query, so a process that imports the same map twice,
 * such as the server, gets the file's current contents.
 */
const importData = Effect.fnUntraced(function* (home: string, file: string) {
  const cacheKey = yield* Random.nextInt;
  const url = `${pathToFileURL(file).href}?load=${cacheKey}`;

  const module = yield* Effect.tryPromise({
    try: (): Promise<{ readonly default?: unknown }> => import(url),
    catch: (cause) =>
      fileProblem(
        home,
        "data.mjs",
        `could not be imported: ${describeCause(cause)}. Fix the module so Node can import it.`
      ),
  });

  if (!("default" in module)) {
    return yield* fileProblem(
      home,
      "data.mjs",
      "has no default export. Add export default { format: 1, revision: 0, structures: [], hops: [] }."
    );
  }

  return decodeData(module.default);
});

/** Returns the path of `name` in `home`, failing when it doesn't exist. */
const requireFile = Effect.fnUntraced(function* (
  home: string,
  name: MapFile,
  fix: string
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(home, name);
  const exists = yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false));

  return exists ? file : yield* fileProblem(home, name, `not found. ${fix}`);
});

const loadData = Effect.fnUntraced(function* (home: string) {
  const file = yield* requireFile(
    home,
    "data.mjs",
    "Write the map's meaning there as an ES module with a default export."
  );

  const decoded = yield* importData(home, file);

  if (Result.isFailure(decoded)) {
    return yield* MapInvalid.make({
      home,
      problems: problemsFromIssue("data.mjs", decoded.failure.issue),
    });
  }

  return decoded.success;
});

const loadLayout = Effect.fnUntraced(function* (home: string) {
  const fs = yield* FileSystem.FileSystem;

  const file = yield* requireFile(
    home,
    "layout.json",
    "Write a layout.json that places every structure."
  );

  const text = yield* fs
    .readFileString(file)
    .pipe(
      Effect.mapError((cause) =>
        fileProblem(home, "layout.json", `could not be read: ${cause.message}`)
      )
    );

  const decoded = decodeLayout(text);

  if (Result.isFailure(decoded)) {
    return yield* MapInvalid.make({
      home,
      problems: problemsFromIssue("layout.json", decoded.failure.issue),
    });
  }

  return decoded.success;
});

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
      ...(Result.isFailure(data) ? data.failure.problems : []),
      ...(Result.isFailure(layout) ? layout.failure.problems : []),
    ],
  });
});
