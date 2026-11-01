import { pathToFileURL } from "node:url";

import {
  checkMap,
  describeCause,
  formatProblem,
  hasErrors,
  LayoutFile,
  linkTargets,
  MapData,
  MapProblem,
  problemsFromIssue,
} from "@axonometric/contracts";
import type { Layout, MapFile } from "@axonometric/contracts";
import {
  Array as Arr,
  Effect,
  FileSystem,
  Option,
  Path,
  Random,
  Result,
  Schema,
} from "effect";
import { CliError } from "effect/cli";

/**
 * The map has at least one error. `problems` holds every error and warning
 * found, so the agent can fix them all in one pass.
 */
export class MapInvalid extends Schema.TaggedError<
  MapInvalid,
  { readonly brand: unique symbol }
>()("MapInvalid", {
  home: Schema.String,
  command: Schema.String,
  problems: Schema.Array(MapProblem),
}) {
  public override get [CliError.userMessage]() {
    const errors = Arr.filter(
      this.problems,
      (problem) => problem.severity === "error"
    );

    const count = errors.length;

    return Arr.join(
      [
        `The map in ${this.home} has ${count} ${count === 1 ? "error" : "errors"}. ${this.command} wrote nothing.`,
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
const fileProblem = (file: MapFile, message: string): MapProblem => ({
  severity: "error",
  file,
  path: "",
  message,
});

type Loaded<A> = Result.Result<A, readonly MapProblem[]>;

/** Returns the path of `name` in `home`, or a problem when it's missing. */
const findFile = Effect.fnUntraced(function* (
  home: string,
  name: MapFile,
  fix: string
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(home, name);
  const exists = yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false));

  return exists
    ? Result.succeed(file)
    : Result.fail([fileProblem(name, `not found. ${fix}`)]);
});

/**
 * Imports `data.mjs` and validates its default export. The URL carries a
 * random query, so a process that imports the same map twice, such as the
 * server, gets the file's current contents.
 */
const loadData = Effect.fnUntraced(function* (
  home: string
): Effect.fn.Return<Loaded<MapData>, never, FileSystem.FileSystem | Path.Path> {
  const found = yield* findFile(
    home,
    "data.mjs",
    "Write the map's meaning there as an ES module with a default export."
  );

  if (Result.isFailure(found)) {
    return Result.fail(found.failure);
  }

  const cacheKey = yield* Random.nextInt;
  const url = `${pathToFileURL(found.success).href}?load=${cacheKey}`;

  const module = yield* Effect.tryPromise({
    try: (): Promise<{ readonly default?: unknown }> => import(url),
    catch: (cause) =>
      fileProblem(
        "data.mjs",
        `could not be imported: ${describeCause(cause)}. Fix the module so Node can import it.`
      ),
  }).pipe(Effect.result);

  if (Result.isFailure(module)) {
    return Result.fail([module.failure]);
  }

  if (!("default" in module.success)) {
    return Result.fail([
      fileProblem(
        "data.mjs",
        "has no default export. Add export default { format: 1, revision: 0, overview, groups, structures, hops, flows, chapters }."
      ),
    ]);
  }

  return Result.mapError(decodeData(module.success.default), (error) =>
    problemsFromIssue("data.mjs", error.issue)
  );
});

const loadLayout = Effect.fnUntraced(function* (
  home: string
): Effect.fn.Return<Loaded<Layout>, never, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;

  const found = yield* findFile(
    home,
    "layout.json",
    "Write a layout.json that places every structure."
  );

  if (Result.isFailure(found)) {
    return Result.fail(found.failure);
  }

  const text = yield* fs.readFileString(found.success).pipe(Effect.result);

  if (Result.isFailure(text)) {
    return Result.fail([
      fileProblem("layout.json", `could not be read: ${text.failure.message}`),
    ]);
  }

  return Result.mapError(decodeLayout(text.success), (error) =>
    problemsFromIssue("layout.json", error.issue)
  );
});

/** Which of the map's relative links resolve to a file next to SYSTEM.md. */
const existingLinks = Effect.fnUntraced(function* (
  output: string,
  data: MapData
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const found = yield* Effect.filter(linkTargets(data), (target) =>
    fs
      .exists(path.resolve(output, target))
      .pipe(Effect.orElseSucceed(() => false))
  );

  return new Set(found);
});

/** A map as loaded: the problems found, and the files when both decoded. */
export interface InspectedMap {
  readonly problems: readonly MapProblem[];
  readonly map: Option.Option<{
    readonly data: MapData;
    readonly layout: Layout;
  }>;
}

/**
 * Loads the map in `home` and finds every error and warning in it. Links
 * resolve against `output`, the folder SYSTEM.md is written to. Writes
 * nothing.
 */
export const inspectMap = Effect.fnUntraced(function* (
  home: string,
  output: string
) {
  const [data, layout] = yield* Effect.all([loadData(home), loadLayout(home)]);

  if (Result.isSuccess(data) && Result.isSuccess(layout)) {
    const links = yield* existingLinks(output, data.success);

    const problems = checkMap(
      { data: data.success, layout: layout.success },
      {
        linkExists: (target) => links.has(target),
      }
    );

    return {
      problems,
      map: Option.some({ data: data.success, layout: layout.success }),
    } satisfies InspectedMap;
  }

  return {
    problems: [
      ...(Result.isFailure(data) ? data.failure : []),
      ...(Result.isFailure(layout) ? layout.failure : []),
    ],
    map: Option.none(),
  } satisfies InspectedMap;
});

/**
 * Loads the map in `home`, failing with every problem when it has an error.
 * Returns the map and its warnings otherwise.
 */
export const loadMap = Effect.fnUntraced(function* (
  home: string,
  output: string,
  command: string
) {
  const { problems, map } = yield* inspectMap(home, output);

  if (hasErrors(problems) || Option.isNone(map)) {
    return yield* MapInvalid.make({ home, command, problems });
  }

  return { ...map.value, warnings: problems };
});
