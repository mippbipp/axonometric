import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, FileSystem, Path, String as Str } from "effect";

import { attributesOf, openPage } from "./browser.ts";
import { fullMap } from "./fixtures.ts";
import { commitAll, git, initRepo, noGit } from "./git.ts";
import { makeHome, runCli } from "./harness.ts";

const dataFile = "review/map/data.mjs";

/**
 * Builds the full map inside a git repo whose origin is on GitHub, with two
 * sources on the map page: one pinned to the repo's only commit and one that
 * follows the branch. Returns the commit, SYSTEM.md and the opened page.
 */
const builtInRepo = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const files = yield* fullMap;

  const home = yield* makeHome({
    ...files,
    "packages/editor/src/app.tsx": "export {};\n",
    "packages/editor/index.html": "<!doctype html>\n",
  });

  yield* initRepo(home);
  yield* git(home, [
    "remote",
    "add",
    "origin",
    "git@github.com:mippbipp/axonometric.git",
  ]);

  const commit = yield* commitAll(home, "add the editor");
  const original = files[dataFile] ?? "";

  const data = `${Str.replace("export default {", "const data = {")(original)}
data.structures[1].sources = [
  { path: "packages/editor/src/app.tsx", commit: "${commit}" },
  { path: "packages/editor/index.html" },
];
export default data;
`;

  yield* fs.writeFileString(path.join(home, ...Str.split(dataFile, "/")), data);

  const result = yield* runCli(home, [
    "build",
    path.join(home, "review", "map"),
  ]);

  assert.strictEqual(result.exitCode, 0, result.stderr);

  const opened = yield* openPage(path.join(home, "review", "review.html"));

  return {
    commit,
    systemMd: result.files["review/SYSTEM.md"] ?? "",
    ...opened,
  };
}).pipe(Effect.provide(NodeServices.layer));

describe.skipIf(noGit)("a structure's sources", () => {
  it.live("show in the pinned panel as links to GitHub, as in SYSTEM.md", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { commit, systemMd, page, errors } = yield* builtInRepo;

        const pinnedUrl = `https://github.com/mippbipp/axonometric/blob/${commit}/packages/editor/src/app.tsx`;

        const branchUrl =
          "https://github.com/mippbipp/axonometric/blob/main/packages/editor/index.html";

        yield* Effect.promise(() =>
          page.locator('[data-structure="page"]').click()
        );
        yield* Effect.promise(() =>
          page
            .locator('[data-structure-panel="page"] [data-source]')
            .first()
            .waitFor()
        );

        const links = '[data-structure-panel="page"] [data-source] a';

        assert.deepStrictEqual(yield* attributesOf(page, links, "href"), [
          pinnedUrl,
          branchUrl,
        ]);

        const text = yield* Effect.promise(() =>
          page.locator('[data-structure-panel="page"]').textContent()
        );

        assert.include(text ?? "", "Sources");
        assert.include(
          text ?? "",
          `packages/editor/src/app.tsx at ${Str.slice(0, 7)(commit)}`
        );

        assert.isTrue(
          Arr.every([pinnedUrl, branchUrl], (url) =>
            Str.includes(`](${url})`)(systemMd)
          )
        );
        assert.deepStrictEqual(errors, []);
      })
    )
  );
});
