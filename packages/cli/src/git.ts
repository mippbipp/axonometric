import {
  normalSourcePath,
  SourceFact,
  sourceKey,
} from "@axonometric/contracts";
import type { MapData, Source, SourceFacts } from "@axonometric/contracts";
import {
  Array as Arr,
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Result,
  Stream,
  String as Str,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/** Why the source checks can't run. */
export type NoRepo = "git-missing" | "not-a-repo";

/** The git repo that holds a home folder. */
export interface Repo {
  /** The repo's root folder. */
  readonly root: string;
  /**
   * The web address of the file at `path` and `commit`, or at the current
   * branch without a commit. None when `origin` isn't a host axonometric
   * knows.
   */
  readonly linkOf: (source: Source) => Option.Option<string>;
  /** What git knows about every source in `data`. */
  readonly factsOf: (data: MapData) => Effect.Effect<SourceFacts>;
}

const githubRemote = [
  /^https:\/\/github\.com\/(?<owner>[\w.-]+)\/(?<repo>[\w.-]+?)(?:\.git)?\/?$/u,
  /^git@github\.com:(?<owner>[\w.-]+)\/(?<repo>[\w.-]+?)(?:\.git)?$/u,
  /^ssh:\/\/git@github\.com\/(?<owner>[\w.-]+)\/(?<repo>[\w.-]+?)(?:\.git)?\/?$/u,
];

/**
 * The `blob` URL prefix for a GitHub `origin`, such as
 * `https://github.com/o/r/blob`. None for any other remote.
 */
export const githubBlobBase = (remote: string): Option.Option<string> =>
  Arr.findFirst(githubRemote, (pattern) => {
    const match = pattern.exec(Str.trim(remote));

    const owner = match?.groups?.owner;
    const repo = match?.groups?.repo;

    return owner === undefined || repo === undefined
      ? Option.none()
      : Option.some(`https://github.com/${owner}/${repo}/blob`);
  });

const encodePath = (path: string) =>
  Arr.join(Arr.map(Str.split(path, "/"), encodeURIComponent), "/");

const command = (cwd: string, args: readonly string[]) =>
  ChildProcess.make("git", ["--literal-pathspecs", ...args], {
    cwd,
    stdin: "ignore",
    stderr: "ignore",
  });

/** Runs git in a repo. Arguments go to git as an array, never via a shell. */
export class Git extends Context.Service<
  Git,
  {
    /**
     * The repo that holds `folder`, or why there isn't one: git isn't
     * installed, or `folder` isn't in a repo.
     */
    readonly repoOf: (
      folder: string
    ) => Effect.Effect<Result.Result<Repo, NoRepo>>;
  }
>()("axonometric/git") {
  public static readonly layer = Layer.effect(
    Git,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      /** Whether git exits 0. False when it can't start. */
      const succeeds = (cwd: string, args: readonly string[]) =>
        spawner.exitCode(command(cwd, args)).pipe(
          Effect.map((code) => code === 0),
          Effect.orElseSucceed(() => false)
        );

      /** git's output, trimmed, when it exits 0. */
      const output = (cwd: string, args: readonly string[]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* spawner.spawn(command(cwd, args));

            const [text, code] = yield* Effect.all(
              [
                Stream.mkString(Stream.decodeText(handle.stdout)),
                handle.exitCode,
              ],
              { concurrency: 2 }
            );

            return code === 0 ? Option.some(Str.trim(text)) : Option.none();
          })
        );

      const factOf = Effect.fnUntraced(function* (
        root: string,
        source: Source
      ) {
        const file = normalSourcePath(source.path);

        if (source.commit === undefined) {
          const inWorkingTree = yield* fs
            .exists(path.join(root, ...Str.split(file, "/")))
            .pipe(Effect.orElseSucceed(() => false));

          return SourceFact.Unpinned({ inWorkingTree });
        }

        const { commit } = source;

        const known = yield* succeeds(root, [
          "cat-file",
          "-e",
          `${commit}^{commit}`,
        ]);

        if (!known) {
          return SourceFact.UnknownCommit({ commit });
        }

        const [atCommit, atHead] = yield* Effect.all(
          [
            succeeds(root, ["cat-file", "-e", `${commit}:${file}`]),
            succeeds(root, ["cat-file", "-e", `HEAD:${file}`]),
          ],
          { concurrency: 2 }
        );

        const changed =
          atCommit && atHead
            ? !(yield* succeeds(root, [
                "diff",
                "--quiet",
                commit,
                "HEAD",
                "--",
                file,
              ]))
            : false;

        return SourceFact.Pinned({ atCommit, atHead, changed });
      });

      const repoOf = Effect.fn("Git.repoOf")(function* (folder: string) {
        const top = yield* output(folder, [
          "rev-parse",
          "--show-toplevel",
        ]).pipe(Effect.result);

        if (Result.isFailure(top)) {
          return Result.fail<NoRepo>("git-missing");
        }

        if (Option.isNone(top.success)) {
          return Result.fail<NoRepo>("not-a-repo");
        }

        const root = path.resolve(top.success.value);

        const remote = yield* output(root, [
          "config",
          "--get",
          "remote.origin.url",
        ]).pipe(Effect.orElseSucceed(Option.none));

        const branch = yield* output(root, [
          "symbolic-ref",
          "--quiet",
          "--short",
          "HEAD",
        ]).pipe(Effect.orElseSucceed(Option.none));

        // A detached HEAD has no branch, so links follow the HEAD commit.
        const head = Option.isSome(branch)
          ? branch
          : yield* output(root, ["rev-parse", "HEAD"]).pipe(
              Effect.orElseSucceed(Option.none)
            );

        const base = Option.flatMap(remote, githubBlobBase);

        const linkOf = (source: Source) =>
          Option.flatMap(base, (prefix) =>
            Option.map(
              Option.orElse(Option.fromUndefinedOr(source.commit), () => head),
              (ref) =>
                `${prefix}/${encodePath(ref)}/${encodePath(normalSourcePath(source.path))}`
            )
          );

        const factsOf = Effect.fnUntraced(function* (data: MapData) {
          const listed: readonly Source[] = Arr.flatMap(
            data.structures,
            (structure) => structure.sources ?? []
          );

          const sources = Arr.dedupeWith(
            listed,
            (a, b) => sourceKey(a) === sourceKey(b)
          );

          const facts = yield* Effect.forEach(
            sources,
            (source) =>
              Effect.map(
                factOf(root, source),
                (fact) => [sourceKey(source), fact] as const
              ),
            { concurrency: 8 }
          );

          const byKey = new Map(facts);

          return (source: Source): SourceFact =>
            byKey.get(sourceKey(source)) ??
            SourceFact.Unpinned({ inWorkingTree: false });
        });

        return Result.succeed<Repo>({ root, linkOf, factsOf });
      });

      return Git.of({ repoOf });
    })
  );
}
