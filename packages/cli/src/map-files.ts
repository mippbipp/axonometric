import { pathToFileURL } from "node:url";

import {
  checkMap,
  checkProposals,
  describeCause,
  emptyProposals,
  formatCount,
  formatProblem,
  LayoutFile,
  linkTargets,
  MapData,
  mapError,
  MapProblem,
  problemsFromIssue,
  ProposalsFile,
  sourceKey,
  splitProblems,
} from "@axonometric/contracts";
import type { Layout, MapFile, Proposals } from "@axonometric/contracts";
import {
  Array as Arr,
  Effect,
  FileSystem,
  Option,
  Path,
  Random,
  Record as Rec,
  Result,
  Schema,
} from "effect";
import { CliError } from "effect/cli";

import { Git } from "./git.ts";
import type { NoRepo, Repo } from "./git.ts";
import { checkHistory } from "./history.ts";

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

const decodeProposals = Schema.decodeUnknownResult(ProposalsFile, parseOptions);

/** An error with a whole file, rather than one field in it. */
const fileProblem = (file: MapFile, message: string) =>
  mapError({ file, path: [], message });

type Loaded<A> = Result.Result<A, readonly MapProblem[]>;

const encodeLayoutFile = Schema.encodeEffect(LayoutFile);

/** The text of `layout.json` for `layout`. */
export const encodeLayout = (layout: Layout) =>
  encodeLayoutFile(layout).pipe(Effect.orDie);

const encodeProposalsFile = Schema.encodeEffect(ProposalsFile);

/** The text of `proposals.json` for `proposals`. */
export const encodeProposals = (proposals: Proposals) =>
  encodeProposalsFile(proposals).pipe(Effect.orDie);

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

/** A JSON map file: its name, how to decode it, and what a missing one means. */
interface JsonFile<A> {
  readonly name: MapFile;
  readonly decode: (text: string) => Result.Result<A, Schema.SchemaError>;
  readonly missing: A;
}

/** Reads the JSON file `name` in `home` with `decode`. */
const loadJson = Effect.fnUntraced(function* <A>(
  home: string,
  { name, decode, missing }: JsonFile<A>
): Effect.fn.Return<Loaded<A>, never, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(home, name);
  const exists = yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false));

  if (!exists) {
    return Result.succeed(missing);
  }

  const text = yield* fs.readFileString(file).pipe(Effect.result);

  if (Result.isFailure(text)) {
    return Result.fail([
      fileProblem(name, `could not be read: ${text.failure.message}`),
    ]);
  }

  return Result.mapError(decode(text.success), (error) =>
    problemsFromIssue(name, error.issue)
  );
});

/** Reads `layout.json`. A missing file is an empty layout, which `build` fills. */
export const loadLayout = (home: string) =>
  loadJson(home, {
    name: "layout.json",
    decode: decodeLayout,
    missing: emptyLayout,
  });

/** Reads `proposals.json`. A missing file means nothing is pending. */
export const loadProposals = (home: string) =>
  loadJson(home, {
    name: "proposals.json",
    decode: decodeProposals,
    missing: emptyProposals,
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

const skipReasons = {
  "git-missing": "git isn't installed",
  "not-a-repo": "the home folder isn't in a git repo",
} as const satisfies Record<NoRepo, string>;

/** What git says about the map's sources, gathered before `checkMap`. */
interface SourceContext {
  readonly repo: Option.Option<Repo>;
  /** The line saying why source checks were skipped, when they were. */
  readonly skipped: Option.Option<string>;
}

const noSources: SourceContext = {
  repo: Option.none(),
  skipped: Option.none(),
};

/**
 * Finds the git repo that holds `home`, when the map lists any sources. A map
 * with none never runs git.
 */
const sourceContext = Effect.fnUntraced(function* (
  home: string,
  data: MapData
) {
  const listed = Arr.some(
    data.structures,
    (structure) => (structure.sources?.length ?? 0) > 0
  );

  if (!listed) {
    return noSources;
  }

  const git = yield* Git;
  const repo = yield* git.repoOf(home);

  return Result.match(repo, {
    onSuccess: (found): SourceContext => ({
      repo: Option.some(found),
      skipped: Option.none(),
    }),
    onFailure: (reason): SourceContext => ({
      repo: Option.none(),
      skipped: Option.some(
        `Skipped the source checks: ${skipReasons[reason]}.`
      ),
    }),
  });
});

/** The web address of every source that has one, keyed by `sourceKey`. */
const linksOf = (data: MapData, repo: Option.Option<Repo>) =>
  Option.match(repo, {
    onNone: () => ({}),
    onSome: ({ linkOf }) =>
      Rec.fromEntries(
        Arr.flatMap(data.structures, (structure) =>
          Arr.flatMap(structure.sources ?? [], (source) =>
            Option.match(linkOf(source), {
              onNone: () => [],
              onSome: (url) => [[sourceKey(source), url] as const],
            })
          )
        )
      ),
  });

/** Both map files, decoded. */
export interface LoadedMap {
  readonly data: MapData;
  /** The layout to check and use: the saved one, after `arrange`. */
  readonly layout: Layout;
  /** The layout as `layout.json` holds it, or empty when there's no file. */
  readonly saved: Layout;
  /** The web address of each source that has one, keyed by `sourceKey`. */
  readonly sourceLinks: Readonly<Record<string, string>>;
  /** What `proposals.json` holds, or nothing pending when there's no file. */
  readonly proposals: Proposals;
}

/** A map as loaded: the problems found, and the files when both decoded. */
export interface InspectedMap {
  readonly problems: readonly MapProblem[];
  readonly map: Option.Option<LoadedMap>;
  /** Why the source checks were skipped, when they were. */
  readonly sourcesSkipped: Option.Option<string>;
}

/** Changes the saved layout before it's checked, such as by placing structures. */
export type Arrange = (data: MapData, saved: Layout) => Layout;

/** How `inspectMap` loads and checks a map. */
export interface InspectOptions {
  /** As for `LoadRequest.arrange`. */
  readonly arrange?: Arrange | undefined;
  /**
   * Whether a `proposals.json` that doesn't decode is an error, as `check`
   * reports it. Otherwise it's a warning, and the map loads with nothing
   * pending: `build` and `serve` only need the accepted layout.
   */
  readonly strictProposals?: boolean | undefined;
  /**
   * Whether a file in `history/` that isn't a valid revision is an error, as
   * `check` reports it. Otherwise it's a warning: a damaged old revision
   * doesn't stop `build` or `serve`.
   */
  readonly strictHistory?: boolean | undefined;
}

/** A problem as a warning, such as an error in a file that can be set aside. */
const asWarning = (problem: MapProblem): MapProblem => ({
  ...problem,
  severity: "warning",
  message: `${problem.message} Pending changes are ignored until this is fixed.`,
});

/**
 * Loads the map in `home` and finds every error and warning in it. Links
 * resolve against `output`, the folder SYSTEM.md is written to. The problems
 * are those of the layout `options.arrange` returns, which is the saved
 * layout by default. Writes nothing.
 */
export const inspectMap = Effect.fnUntraced(function* (
  home: string,
  output: string,
  options: InspectOptions = {}
) {
  const arrange = options.arrange ?? ((_data, saved: Layout) => saved);

  const [data, saved, loadedProposals] = yield* Effect.all([
    loadData(home),
    loadLayout(home),
    loadProposals(home),
  ]);

  const history = yield* checkHistory(home, options.strictHistory === true);

  const noProblems: readonly MapProblem[] = [];

  const proposals = Result.match(loadedProposals, {
    onSuccess: (found) => ({ found, problems: noProblems }),
    onFailure: (failure) => ({
      found: emptyProposals,
      problems:
        options.strictProposals === true
          ? failure
          : Arr.map(failure, asWarning),
    }),
  });

  if (Result.isSuccess(data) && Result.isSuccess(saved)) {
    const links = yield* existingLinks(output, data.success);
    const layout = arrange(data.success, saved.success);
    const sources = yield* sourceContext(home, data.success);

    const sourceFacts = Option.isSome(sources.repo)
      ? yield* sources.repo.value.factsOf(data.success)
      : undefined;

    const problems = [
      ...checkMap(
        { data: data.success, layout },
        {
          linkExists: (target) => links.has(target),
          sourceFacts,
        }
      ),
      ...proposals.problems,
      ...checkProposals(data.success, layout, proposals.found),
      ...history,
    ];

    return {
      problems,
      map: Option.some({
        data: data.success,
        layout,
        saved: saved.success,
        sourceLinks: linksOf(data.success, sources.repo),
        proposals: proposals.found,
      }),
      sourcesSkipped: sources.skipped,
    } satisfies InspectedMap;
  }

  return {
    problems: [
      ...(Result.isFailure(data) ? data.failure : []),
      ...(Result.isFailure(saved) ? saved.failure : []),
      ...proposals.problems,
      ...history,
    ],
    map: Option.none(),
    sourcesSkipped: Option.none(),
  } satisfies InspectedMap;
});

/** What `loadMap` loads, and for which command. */
export interface LoadRequest {
  readonly home: string;
  /** The folder SYSTEM.md is written to, which links resolve against. */
  readonly output: string;
  /** The command loading the map, named in the error. */
  readonly command: string;
  /** As for `InspectOptions`. */
  readonly arrange?: Arrange;
  readonly strictProposals?: boolean;
  readonly strictHistory?: boolean;
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
  strictProposals,
  strictHistory,
}: LoadRequest) {
  const { problems, map, sourcesSkipped } = yield* inspectMap(home, output, {
    arrange,
    strictProposals,
    strictHistory,
  });

  if (splitProblems(problems).errors.length > 0 || Option.isNone(map)) {
    return yield* MapInvalid.make({ home, command, problems });
  }

  return { ...map.value, warnings: problems, sourcesSkipped };
});
