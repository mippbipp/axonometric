import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  FileSystem,
  Path,
  Record as Rec,
  Schema,
  String as Str,
} from "effect";

import { minimalMap } from "./fixtures.ts";
import { commitAll, git, initRepo, noGit } from "./git.ts";
import type { HomeFiles } from "./harness.ts";
import { makeHome, runCli } from "./harness.ts";

const dataFile = "pipeline/map/data.mjs";

/**
 * The minimal map with `sources` on its first structure. `sources` is a JS
 * expression, so a test can pin the commit it just made.
 */
const mapWithSources = Effect.fnUntraced(function* (sources: string) {
  const files = yield* minimalMap;
  const original = files[dataFile] ?? "";

  return {
    ...files,
    [dataFile]: `${Str.replace("export default {", "const data = {")(original)}
data.structures[0].sources = ${sources};
export default data;
`,
  } satisfies HomeFiles;
});

/** Writes `content` to `file` in `home`, a `/`-separated path. */
const writeFile = Effect.fnUntraced(function* (
  home: string,
  file: string,
  content: string
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolute = path.join(home, ...Str.split(file, "/"));

  yield* fs.makeDirectory(path.dirname(absolute), { recursive: true });
  yield* fs.writeFileString(absolute, content);
}, Effect.provide(NodeServices.layer));

/**
 * A home folder that's a git repo on branch main, holding `src/updater.ts`
 * in one commit, whose hash it returns.
 */
const repoHome = Effect.fnUntraced(function* () {
  const home = yield* makeHome({ "src/updater.ts": "export const run = 1;\n" });

  yield* initRepo(home);

  const commit = yield* commitAll(home, "add the updater");

  return { home, commit };
});

/** Writes the minimal map into `home`, with `sources` on its first structure. */
const writeMap = Effect.fnUntraced(function* (home: string, sources: string) {
  const files = yield* mapWithSources(sources);

  yield* Effect.forEach(
    Rec.toEntries(files),
    ([file, content]) => writeFile(home, file, content),
    { discard: true }
  );
});

/** Runs `command` on the minimal map's home folder inside `home`. */
const runOnMap = Effect.fnUntraced(function* (
  home: string,
  command: "build" | "check"
) {
  const path = yield* Path.Path;

  return yield* runCli(home, [command, path.join(home, "pipeline", "map")]);
}, Effect.provide(NodeServices.layer));

/** Writes the map in `home` with `sources`, then runs `check` on it. */
const checkWith = Effect.fnUntraced(function* (home: string, sources: string) {
  yield* writeMap(home, sources);

  return yield* runOnMap(home, "check");
});

const at = "data.mjs structures[0].sources[0]";

describe.skipIf(noGit)(
  "check on a structure's sources",
  { timeout: 30_000 },
  () => {
    it.effect("passes a pinned source with no later change", () =>
      Effect.gen(function* () {
        const { home, commit } = yield* repoHome();

        const result = yield* checkWith(
          home,
          `[{ path: "src/updater.ts", commit: "${commit}" }]`
        );

        assert.strictEqual(result.exitCode, 0, result.stdout);
        assert.include(result.stdout, ": 0 errors, 0 warnings.");
      })
    );

    it.effect("warns once the file changes in a later commit", () =>
      Effect.gen(function* () {
        const { home, commit } = yield* repoHome();

        yield* writeFile(home, "src/updater.ts", "export const run = 2;\n");
        yield* commitAll(home, "change the updater");

        const result = yield* checkWith(
          home,
          `[{ path: "src/updater.ts", commit: "${commit}" }]`
        );

        assert.strictEqual(result.exitCode, 0, result.stdout);
        assert.include(
          result.stdout,
          `warning ${at}.path: "src/updater.ts" changed between commit ${commit} and HEAD. Reread structure "updater"`
        );
        assert.include(result.stdout, ": 0 errors, 1 warning.");
      })
    );

    it.effect("doesn't count changes that aren't committed", () =>
      Effect.gen(function* () {
        const { home, commit } = yield* repoHome();

        yield* writeFile(home, "src/updater.ts", "export const run = 3;\n");

        const result = yield* checkWith(
          home,
          `[{ path: "src/updater.ts", commit: "${commit}" }]`
        );

        assert.include(result.stdout, ": 0 errors, 0 warnings.");
      })
    );

    it.effect("warns when the file is deleted or renamed after the pin", () =>
      Effect.gen(function* () {
        const { home, commit } = yield* repoHome();

        yield* git(home, ["mv", "src/updater.ts", "src/update.ts"]);
        yield* commitAll(home, "rename the updater");

        const result = yield* checkWith(
          home,
          `[{ path: "src/updater.ts", commit: "${commit}" }]`
        );

        assert.strictEqual(result.exitCode, 0, result.stdout);
        assert.include(
          result.stdout,
          `warning ${at}.path: "src/updater.ts" exists at commit ${commit} but not at HEAD, so it was renamed or deleted.`
        );
      })
    );

    it.effect("errors on a typo in the path, pinned or not", () =>
      Effect.gen(function* () {
        const { home, commit } = yield* repoHome();

        const result = yield* checkWith(
          home,
          `[{ path: "src/updatr.ts", commit: "${commit}" }, { path: "src/updatr.ts" }]`
        );

        assert.strictEqual(result.exitCode, 1);
        assert.include(
          result.stdout,
          `error ${at}.path: "src/updatr.ts" doesn't exist at commit ${commit}.`
        );
        assert.include(
          result.stdout,
          `error data.mjs structures[0].sources[1].path: "src/updatr.ts" isn't a file git tracks at HEAD.`
        );
        assert.include(result.stdout, ": 2 errors, 1 warning.");
      })
    );

    it.effect("errors on a file git doesn't track", () =>
      Effect.gen(function* () {
        const { home } = yield* repoHome();

        yield* writeFile(home, "src/draft.ts", "export {};\n");

        const result = yield* checkWith(home, '[{ path: "src/draft.ts" }]');

        assert.strictEqual(result.exitCode, 1);
        assert.include(
          result.stdout,
          `error ${at}.path: "src/draft.ts" isn't a file git tracks at HEAD.`
        );
      })
    );

    it.effect("errors on a folder, pinned or not", () =>
      Effect.gen(function* () {
        const { home, commit } = yield* repoHome();

        const result = yield* checkWith(
          home,
          `[{ path: "src" }, { path: "src", commit: "${commit}" }]`
        );

        assert.strictEqual(result.exitCode, 1);
        assert.include(
          result.stdout,
          `error ${at}.path: "src" isn't a file git tracks at HEAD.`
        );
        assert.include(
          result.stdout,
          `error data.mjs structures[0].sources[1].path: "src" doesn't exist at commit ${commit}.`
        );
      })
    );

    it.effect("errors on a commit that isn't in the history", () =>
      Effect.gen(function* () {
        const { home } = yield* repoHome();

        const result = yield* checkWith(
          home,
          '[{ path: "src/updater.ts", commit: "0123456789abcdef0123456789abcdef01234567" }]'
        );

        assert.strictEqual(result.exitCode, 1);
        assert.include(
          result.stdout,
          `error ${at}.commit: commit 0123456789abcdef0123456789abcdef01234567 isn't in the local git history. Run git fetch`
        );
      })
    );

    it.effect("finds sources from the repo's root, not the home folder", () =>
      Effect.gen(function* () {
        const { home } = yield* repoHome();

        const result = yield* checkWith(home, '[{ path: "./src/updater.ts" }]');

        assert.strictEqual(result.exitCode, 0, result.stdout);
      })
    );
  }
);

describe("check outside a git repo", () => {
  it.effect("skips the source checks, says so in one line, and exits 0", () =>
    Effect.gen(function* () {
      const home = yield* makeHome({});

      const result = yield* checkWith(
        home,
        '[{ path: "src/updater.ts", commit: "3f2a9c1" }]'
      );

      assert.strictEqual(result.exitCode, 0, result.stdout);

      const lines = Str.split(result.stdout, "\n");

      const skipped = Arr.filter(
        lines,
        Str.startsWith("Skipped the source checks")
      );

      assert.lengthOf(skipped, 1);
      assert.include(result.stdout, ": 0 errors, 0 warnings.");
    })
  );

  it.effect("says why in check --json, without counting a warning", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const home = yield* makeHome({});

      yield* writeMap(home, '[{ path: "src/updater.ts" }]');

      const result = yield* runCli(home, [
        "check",
        "--json",
        path.join(home, "pipeline", "map"),
      ]);

      const report = yield* decodeReport(result.stdout);

      assert.strictEqual(result.exitCode, 0, result.stdout);
      assert.deepStrictEqual(report.warnings, []);
      assert.match(report.sourcesSkipped ?? "", /^Skipped the source checks/u);
    }).pipe(Effect.provide(NodeServices.layer))
  );
});

describe.skipIf(noGit)(
  "check --json in a git repo",
  { timeout: 30_000 },
  () => {
    it.effect("reports sourcesSkipped as null when the checks ran", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const { home } = yield* repoHome();

        yield* writeMap(home, '[{ path: "src/updater.ts" }]');

        const result = yield* runCli(home, [
          "check",
          "--json",
          path.join(home, "pipeline", "map"),
        ]);

        const report = yield* decodeReport(result.stdout);

        assert.isNull(report.sourcesSkipped);
      }).pipe(Effect.provide(NodeServices.layer))
    );
  }
);

const CheckReport = Schema.Struct({
  warnings: Schema.Array(Schema.Unknown),
  sourcesSkipped: Schema.NullOr(Schema.String),
});

const decodeReport = Schema.decodeUnknownEffect(
  Schema.fromJsonString(CheckReport)
);

/** Builds the map in a repo whose origin is `remote`, if any. */
const buildWith = Effect.fnUntraced(function* (
  remote: string | undefined,
  sources: (commit: string) => string
) {
  const { home, commit } = yield* repoHome();

  if (remote !== undefined) {
    yield* git(home, ["remote", "add", "origin", remote]);
  }

  yield* writeMap(home, sources(commit));

  const result = yield* runOnMap(home, "build");

  assert.strictEqual(result.exitCode, 0, result.stderr);

  return { commit, systemMd: result.files["pipeline/SYSTEM.md"] ?? "" };
}, Effect.provide(NodeServices.layer));

const pinnedSource = (commit: string) =>
  `[{ path: "src/updater.ts", commit: "${commit}" }]`;

const unpinnedSource = () => '[{ path: "src/updater.ts" }]';

describe.skipIf(noGit)("build's source links", { timeout: 30_000 }, () => {
  for (const remote of [
    "https://github.com/mippbipp/pipeline.git",
    "https://github.com/mippbipp/pipeline",
    "git@github.com:mippbipp/pipeline.git",
    "ssh://git@github.com/mippbipp/pipeline.git",
  ]) {
    it.effect(`links to GitHub's blob URL for ${remote}`, () =>
      Effect.gen(function* () {
        const pinned = yield* buildWith(remote, pinnedSource);
        const unpinned = yield* buildWith(remote, unpinnedSource);

        assert.include(
          pinned.systemMd,
          `- [\`src/updater.ts\`](https://github.com/mippbipp/pipeline/blob/${pinned.commit}/src/updater.ts) at \`${Str.slice(0, 7)(pinned.commit)}\``
        );
        assert.include(
          unpinned.systemMd,
          "- [`src/updater.ts`](https://github.com/mippbipp/pipeline/blob/main/src/updater.ts)\n"
        );
      })
    );
  }

  it.effect("shows plain paths with no remote", () =>
    Effect.gen(function* () {
      const { systemMd } = yield* buildWith(undefined, unpinnedSource);

      assert.include(systemMd, "- `src/updater.ts`\n");
      assert.notInclude(systemMd, "](https://");
    })
  );

  it.effect("shows plain paths for a host it doesn't know", () =>
    Effect.gen(function* () {
      const { systemMd } = yield* buildWith(
        "https://gitlab.com/mippbipp/pipeline.git",
        pinnedSource
      );

      assert.match(systemMd, /^- `src\/updater\.ts` at `[0-9a-f]{7}`$/mu);
      assert.notInclude(systemMd, "](https://");
    })
  );

  it.effect("links a detached HEAD's unpinned sources to its commit", () =>
    Effect.gen(function* () {
      const { home, commit } = yield* repoHome();

      yield* git(home, [
        "remote",
        "add",
        "origin",
        "git@github.com:mippbipp/pipeline.git",
      ]);
      yield* git(home, ["checkout", "--quiet", "--detach"]);
      yield* writeMap(home, '[{ path: "src/updater.ts" }]');

      const result = yield* runOnMap(home, "build");

      assert.include(
        result.files["pipeline/SYSTEM.md"] ?? "",
        `(https://github.com/mippbipp/pipeline/blob/${commit}/src/updater.ts)`
      );
    })
  );
});
