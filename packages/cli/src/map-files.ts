import { pathToFileURL } from "node:url";

import {
  checkMap,
  describeCause,
  formatCount,
  formatProblem,
  LayoutFile,
  linkTargets,
  MapData,
  mapError,
  MapProblem,
  problemsFromIssue,
  splitProblems,
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
    const { errors } = splitProblems(this.problems);

    return Arr.join(
      [
        `The map in ${this.home} has ${formatCount(errors.length, "error")}. ${this.command} wrote nothing.`,
        ...Arr.map(this.problems, (problem) => `  ${formatProblem(problem)}`),
      ],
      "\n"
    );
  }
}

const parseOptions = { errors: "all", onExcessProperty: "error" } as const;

const decodeData = Schema.decodeUnknownResult(MapData, parseOptions);

const decodeLayout = Schema.decodeUnknownResult(LayoutFile, parseOptions);

/** An error with a whole file, rather than one field in it. */
const fileProblem = (file: MapFile, message: string) =>
  mapError({ file, path: [], message });

type Loaded<A> = Result.Result<A, readonly MapProblem[]>;

const encodeLayoutFile = Schema.encodeEffect(LayoutFile);

/** The text of `layout.json` for `layout`. */
export const encodeLayout = (layout: Layout) =>
  encodeLayoutFile(layout).pipe(Effect.orDie);

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

/** The layout of a map whose `layout.json` doesn't exist yet. */
export const emptyLayout: Layout = { format: 1, revision: 0, structures: {} };

/** Reads `layout.json`. A missing file is an empty layout, which `build` fills. */
const loadLayout = Effect.fnUntraced(function* (
  home: string
): Effect.fn.Return<Loaded<Layout>, never, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(home, "layout.json");
  const exists = yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false));

  if (!exists) {
    return Result.succeed(emptyLayout);
  }

  const text = yield* fs.readFileString(file).pipe(Effect.result);

  if (Result.isFailure(text)) {
    return Result.fail([
      fileProblem("layout.json", `could not be read: ${text.failure.message}`),
    ]);
  }

  return Result.mapError(decodeLayout(text.success), (error) =>
    problemsFromIssue("layout.json", error.issue)
  );
});

/**
 * Which of the map's relative links resolve to a file next to SYSTEM.md.
 * `URL` resolves each link against `output` and drops its `#fragment`.
 */
const existingLinks = Effect.fnUntraced(function* (
  output: string,
  data: MapData
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const base = yield* path.toFileUrl(path.join(output, path.sep));

  const found = yield* Effect.filter(linkTargets(data), (link) =>
    path.fromFileUrl(new URL(link, base)).pipe(
      Effect.flatMap((file) => fs.exists(file)),
      Effect.orElseSucceed(() => false)
    )
  );

  return new Set(found);
});

/** Both map files, decoded. */
export interface LoadedMap {
  readonly data: MapData;
  /** The layout to check and use: the saved one, after `arrange`. */
  readonly layout: Layout;
  /** The layout as `layout.json` holds it, or empty when there's no file. */
  readonly saved: Layout;
}

/** A map as loaded: the problems found, and the files when both decoded. */
export interface InspectedMap {
  readonly problems: readonly MapProblem[];
  readonly map: Option.Option<LoadedMap>;
}

/** Changes the saved layout before it's checked, such as by placing structures. */
export type Arrange = (data: MapData, saved: Layout) => Layout;

/**
 * Loads the map in `home` and finds every error and warning in it. Links
 * resolve against `output`, the folder SYSTEM.md is written to. The problems
 * are those of the layout `arrange` returns, which is the saved layout by
 * default. Writes nothing.
 */
export const inspectMap = Effect.fnUntraced(function* (
  home: string,
  output: string,
  arrange: Arrange = (_data, saved) => saved
) {
  const [data, saved] = yield* Effect.all([loadData(home), loadLayout(home)]);

  if (Result.isSuccess(data) && Result.isSuccess(saved)) {
    const links = yield* existingLinks(output, data.success);
    const layout = arrange(data.success, saved.success);

    const problems = checkMap(
      { data: data.success, layout },
      {
        linkExists: (target) => links.has(target),
      }
    );

    return {
      problems,
      map: Option.some({ data: data.success, layout, saved: saved.success }),
    } satisfies InspectedMap;
  }

  return {
    problems: [
      ...(Result.isFailure(data) ? data.failure : []),
      ...(Result.isFailure(saved) ? saved.failure : []),
    ],
    map: Option.none(),
  } satisfies InspectedMap;
});

/** What `loadMap` loads, and for which command. */
export interface LoadRequest {
  readonly home: string;
  /** The folder SYSTEM.md is written to, which links resolve against. */
  readonly output: string;
  /** The command loading the map, named in the error. */
  readonly command: string;
  /** As for `inspectMap`. */
  readonly arrange?: Arrange;
}

/**
 * Loads the map in `home`, failing with every problem when it has an error.
 * Returns the map and its warnings otherwise.
 */
export const loadMap = Effect.fnUntraced(function* ({
  home,
  output,
  command,
  arrange,
}: LoadRequest) {
  const { problems, map } = yield* inspectMap(home, output, arrange);

  if (splitProblems(problems).errors.length > 0 || Option.isNone(map)) {
    return yield* MapInvalid.make({ home, command, problems });
  }

  return { ...map.value, warnings: problems };
});
