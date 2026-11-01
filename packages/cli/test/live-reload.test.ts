import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path, String as Str } from "effect";
import type { Page } from "playwright";

import { openUrl } from "./browser.ts";
import { fullMap } from "./fixtures.ts";
import { commitAll, git, initRepo, noGit } from "./git.ts";
import { makeHome, startServe } from "./harness.ts";

// These tests run a real serve in-process on a free port, open its page in
// Chromium, change the map files on disk and check what the page shows.

const waitTimeout = { timeout: 15_000 };

const waitFor = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).first().waitFor(waitTimeout));

const waitGone = (page: Page, selector: string) =>
  Effect.promise(() =>
    page
      .locator(selector)
      .first()
      .waitFor({ state: "detached", ...waitTimeout })
  );

const textOf = (page: Page, selector: string) =>
  Effect.promise(() =>
    page
      .locator(selector)
      .first()
      .textContent()
      .then((text) => text ?? "")
  );

const attributeOf = (page: Page, selector: string, name: string) =>
  Effect.promise(() =>
    page
      .locator(selector)
      .first()
      .getAttribute(name)
      .then((value) => value ?? "")
  );

const count = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).count());

const panelTitle = '[data-structure-panel="server"] h2';

/** The review map served on a free port, open in Chromium at 1280 × 800. */
const servedReview = Effect.gen(function* () {
  const path = yield* Path.Path;
  const root = yield* makeHome(yield* fullMap);
  const home = path.join(root, "review", "map");
  const serve = yield* startServe(home, ["--port", "0"]);
  const opened = yield* openUrl(serve.url);

  yield* Effect.promise(() =>
    opened.page.setViewportSize({ width: 1280, height: 800 })
  );

  return { root, home, serve, ...opened };
}).pipe(Effect.provide(NodeServices.layer));

/** Rewrites `data.mjs` in `home` with `edit` applied to its text. */
const editData = Effect.fnUntraced(function* (
  home: string,
  edit: (text: string) => string
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(home, "data.mjs");

  yield* fs.writeFileString(file, edit(yield* fs.readFileString(file)));
}, Effect.provide(NodeServices.layer));

const rename = (from: string, to: string) => Str.replaceAll(from, to);

/** Goes to the saving chapter, pins the server, and zooms in twice. */
const settle = Effect.fnUntraced(function* (page: Page) {
  yield* Effect.promise(() =>
    page.locator('[data-chapter-rail] button[data-chapter="c-save"]').click()
  );
  yield* waitFor(page, '[data-walkthrough][data-chapter="c-save"]');
  yield* Effect.promise(() =>
    page.locator('[data-structure="server"]').click()
  );
  yield* waitFor(page, '[data-structure-panel="server"][data-pinned]');
  yield* Effect.promise(() =>
    page.getByRole("button", { name: "Zoom in" }).click()
  );
  yield* Effect.promise(() =>
    page.getByRole("button", { name: "Zoom in" }).click()
  );

  return yield* attributeOf(page, "svg[data-scale]", "data-scale");
});

describe("live reload", () => {
  it.live(
    "applies a change to data.mjs, keeping the chapter, the selection and the zoom",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { root, home, page, errors } = yield* servedReview;
        const scale = yield* settle(page);

        yield* editData(home, rename('"Save server"', '"Write server"'));

        yield* Effect.promise(() =>
          page.waitForFunction(
            `document.querySelector('${panelTitle}')?.textContent === "Write server"`,
            undefined,
            waitTimeout
          )
        );

        const systemMd = yield* fs.readFileString(
          path.join(root, "review", "SYSTEM.md")
        );

        const html = yield* fs.readFileString(
          path.join(root, "review", "review.html")
        );

        assert.strictEqual(
          yield* attributeOf(page, "[data-walkthrough]", "data-chapter"),
          "c-save"
        );
        assert.strictEqual(
          yield* attributeOf(page, '[data-selected="true"]', "data-structure"),
          "server"
        );
        assert.strictEqual(
          yield* attributeOf(page, "svg[data-scale]", "data-scale"),
          scale
        );
        assert.include(systemMd, "Write server");
        assert.include(html, "Write server");
        assert.notInclude(html, `id="axonometric-served-page"`);
        assert.deepStrictEqual(errors, []);
      }).pipe(Effect.provide(NodeServices.layer)),
    60_000
  );

  it.live(
    "shows a validation error over the last good map, and clears it once fixed",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* servedReview;

        yield* settle(page);
        yield* editData(home, rename('"Save server"', '""'));
        yield* waitFor(page, "[data-map-error]");

        const banner = yield* textOf(page, "[data-map-error]");

        assert.include(banner, "The last good map is still showing.");
        assert.include(banner, "structures[2].name");
        assert.strictEqual(yield* textOf(page, panelTitle), "Save server");

        yield* editData(home, rename('name: ""', 'name: "Fixed server"'));
        yield* waitGone(page, "[data-map-error]");

        assert.strictEqual(yield* textOf(page, panelTitle), "Fixed server");
      }),
    60_000
  );

  it.live(
    "says the server stopped, and recovers when it starts again",
    () =>
      Effect.gen(function* () {
        const { home, serve, page } = yield* servedReview;
        const { port } = new URL(serve.url);

        yield* serve.stop;
        yield* waitFor(page, "[data-server-stopped]");

        assert.include(
          yield* textOf(page, "[data-server-stopped]"),
          "Server stopped"
        );

        yield* startServe(home, ["--port", port]);
        yield* waitGone(page, "[data-server-stopped]");

        assert.strictEqual(yield* count(page, "[data-structure]"), 2);
      }),
    60_000
  );

  it.live.skipIf(noGit)(
    "links a source added while serving to GitHub, in the panel and SYSTEM.md",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { root, home, page } = yield* servedReview;

        yield* fs.makeDirectory(path.join(root, "src"));
        yield* fs.writeFileString(
          path.join(root, "src", "server.ts"),
          "export {};\n"
        );
        yield* initRepo(root);
        yield* git(root, [
          "remote",
          "add",
          "origin",
          "git@github.com:mippbipp/review.git",
        ]);

        const commit = yield* commitAll(root, "add the server");

        yield* settle(page);
        yield* editData(
          home,
          (text) => `${Str.replace("export default {", "const data = {")(text)}
data.structures[2].sources = [{ path: "src/server.ts", commit: "${commit}" }];
export default data;
`
        );

        const url = `https://github.com/mippbipp/review/blob/${commit}/src/server.ts`;
        const link = `[data-structure-panel="server"] [data-source="src/server.ts"] a`;

        yield* waitFor(page, link);

        const systemMd = yield* fs.readFileString(
          path.join(root, "review", "SYSTEM.md")
        );

        assert.strictEqual(yield* attributeOf(page, link, "href"), url);
        assert.include(systemMd, `(${url})`);
      }).pipe(Effect.provide(NodeServices.layer)),
    60_000
  );
});
