import { Proposals } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  FileSystem,
  Path,
  Schema,
  String as Str,
} from "effect";
import type { Page } from "playwright";

import { literal, openUrl } from "./browser.ts";
import { crosses, drawingReport, overlap } from "./drawing-report.ts";
import type { Drawn, DrawingReport } from "./drawing-report.ts";
import { fullMap } from "./fixtures.ts";
import { makeHome, runCli, startServe } from "./harness.ts";

// Seam 2: structure proposals in a page that a real serve serves. The review
// map's chapters reveal engineer and page, then server and proposals, then
// the rest, so a proposed structure is revealed in each of them.

const waitTimeout = { timeout: 15_000 };

const decodeProposals = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Proposals)
);

const served = Effect.gen(function* () {
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

const click = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).first().click());

const waitFor = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).first().waitFor(waitTimeout));

const count = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).count());

const chapter = Effect.fnUntraced(function* (page: Page, id: string) {
  yield* click(page, `[data-chapter-rail] button[data-chapter="${id}"]`);
  yield* waitFor(page, `[data-walkthrough][data-chapter="${id}"]`);
  yield* click(page, '[data-playback-controls] [data-control="pause"]');
});

const view = Effect.fnUntraced(function* (page: Page, which: "iso" | "plan") {
  yield* click(page, `[data-view-toggle] [data-view="${which}"]`);
  yield* waitFor(page, `[data-walkthrough][data-view="${which}"]`);
  yield* Effect.promise(() => page.keyboard.press("0"));
});

const readProposals = Effect.fnUntraced(function* (home: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  return yield* decodeProposals(
    yield* fs.readFileString(path.join(home, "proposals.json"))
  );
}, Effect.provide(NodeServices.layer));

/** Opens the form, names the structure and clicks the map at (x, y) in the page. */
const addStructure = Effect.fnUntraced(function* (
  page: Page,
  fields: { readonly name: string; readonly x: number; readonly y: number }
) {
  yield* click(page, '[data-control="add-structure"]');
  yield* waitFor(page, "[data-add-structure]");
  yield* Effect.promise(() =>
    page.locator('[data-add="name"]').fill(fields.name)
  );
  yield* Effect.promise(() =>
    page.locator('[data-add="shape"]').selectOption("store")
  );
  yield* Effect.promise(() =>
    page.locator('[data-add="status"]').selectOption("planned")
  );
  yield* Effect.promise(() =>
    page.locator('[data-add="x"]').fill(String(fields.x))
  );
  yield* Effect.promise(() =>
    page.locator('[data-add="y"]').fill(String(fields.y))
  );
  yield* click(page, '[data-add="submit"]');
});

/** The computed stroke of the element matching `selector`, read in the page. */
const strokeOf = (page: Page, selector: string) =>
  Effect.promise(() =>
    page.evaluate<string>(
      `getComputedStyle(document.querySelector(${literal(selector)})).stroke`
    )
  );

/** The pieces of the cross that run over a code chip or a name tag. */
const strikesOverText = (report: DrawingReport): readonly string[] => {
  // The chip's rendered box, with 3 pixels of air round it.
  const aired = Arr.map(report.chips, ({ id, polygon }): Drawn => {
    const xs = Arr.map(polygon, ({ x }) => x);
    const ys = Arr.map(polygon, ({ y }) => y);
    const [left, right] = [Math.min(...xs) - 3, Math.max(...xs) + 3];
    const [top, bottom] = [Math.min(...ys) - 3, Math.max(...ys) + 3];

    return {
      id,
      polygon: [
        { x: left, y: top },
        { x: right, y: top },
        { x: right, y: bottom },
        { x: left, y: bottom },
      ],
    };
  });

  const text: readonly Drawn[] = [
    ...aired,
    ...Arr.filter(report.text, ({ id }) => Str.startsWith("tag:")(id)),
  ];

  return Arr.flatMap(report.strikes, ({ id, segment }) =>
    Arr.flatMap(text, (other) =>
      crosses(segment, other.polygon) ? [`${id} × ${other.id}`] : []
    )
  );
};

const clashes = Effect.fnUntraced(function* (page: Page) {
  const report = yield* Effect.promise(() =>
    page.evaluate<DrawingReport>(drawingReport)
  );

  const tags = Arr.filter(report.text, ({ id }) => Str.startsWith("tag:")(id));

  const withText = Arr.flatMap(tags, (tag) =>
    Arr.flatMap(
      Arr.filter(report.text, ({ id }) => id !== tag.id),
      (other: DrawingReport["text"][number]) =>
        overlap(tag.polygon, other.polygon) ? [`${tag.id} × ${other.id}`] : []
    )
  );

  const withBoxes = Arr.flatMap(tags, (tag) =>
    Arr.flatMap(
      Arr.filter(
        report.structures,
        ({ id }) => id !== `box:${Str.slice(4)(tag.id)}`
      ),
      (box: DrawingReport["structures"][number]) =>
        overlap(tag.polygon, box.polygon) ? [`${tag.id} × ${box.id}`] : []
    )
  );

  return [...new Set([...withText, ...withBoxes])];
});

describe("adding a structure from the toolbar", () => {
  it.live(
    "asks for name, shape, group, status and position, and saves a proposal",
    () =>
      Effect.gen(function* () {
        const { home, page, errors } = yield* served;

        yield* chapter(page, "c-all");
        yield* click(page, '[data-control="add-structure"]');
        yield* waitFor(page, "[data-add-structure]");

        for (const field of ["name", "shape", "group", "status", "x", "y"]) {
          assert.strictEqual(
            yield* count(page, `[data-add="${field}"]`),
            1,
            field
          );
        }

        assert.isTrue(
          yield* Effect.promise(() =>
            page.locator('[data-add="submit"]').isDisabled()
          )
        );

        yield* Effect.promise(() => page.locator('[data-add="x"]').fill("12"));
        yield* Effect.promise(() => page.locator('[data-add="y"]').fill("12"));
        yield* Effect.promise(() =>
          page.locator('[data-add="name"]').fill("Build cache")
        );
        yield* Effect.promise(() =>
          page.locator('[data-add="shape"]').selectOption("store")
        );
        yield* Effect.promise(() =>
          page.locator('[data-add="group"]').selectOption("outside")
        );
        yield* Effect.promise(() =>
          page.locator('[data-add="status"]').selectOption("planned")
        );
        yield* click(page, '[data-add="submit"]');
        yield* Effect.promise(() =>
          page.waitForFunction(
            `document.querySelector('[data-structure][data-pending="true"]') !== null`,
            undefined,
            waitTimeout
          )
        );

        const proposals = yield* readProposals(home);
        const [saved] = proposals.structures ?? [];

        assert.strictEqual(saved?.change.action, "add");

        if (saved?.change.action === "add") {
          assert.deepStrictEqual(
            { ...saved.change.structure, id: "" },
            {
              id: "",
              name: "Build cache",
              shape: "store",
              group: "outside",
              status: "planned",
            }
          );
          assert.match(saved.change.structure.id, /^build-cache-[0-9a-f]{4}$/u);
          assert.deepStrictEqual(saved.change.at, { x: 12, y: 12, w: 2, d: 2 });
        }

        assert.deepStrictEqual(errors, []);
      }),
    60_000
  );

  it.live("takes its position from a click on the map", () =>
    Effect.gen(function* () {
      const { home, page } = yield* served;

      yield* chapter(page, "c-all");
      yield* click(page, '[data-control="add-structure"]');
      yield* click(page, '[data-add="pick"]');

      const box = yield* Effect.promise(() =>
        page.locator("[data-map-surface] svg[data-scale]").first().boundingBox()
      );

      // Empty ground at the right edge of the fitted map.
      yield* Effect.promise(() =>
        page.mouse.click(
          (box?.x ?? 0) + (box?.width ?? 0) * 0.9,
          (box?.y ?? 0) + (box?.height ?? 0) * 0.85
        )
      );
      yield* waitFor(page, "[data-spot-outline]");

      const x = yield* Effect.promise(() =>
        page.locator('[data-add="x"]').inputValue()
      );

      const y = yield* Effect.promise(() =>
        page.locator('[data-add="y"]').inputValue()
      );

      assert.notStrictEqual(x, "");
      assert.notStrictEqual(y, "");
      assert.strictEqual(Number(x) * 2, Math.round(Number(x) * 2));

      yield* Effect.promise(() =>
        page.locator('[data-add="name"]').fill("Dropped")
      );
      yield* click(page, '[data-add="submit"]');
      yield* Effect.promise(() =>
        page.waitForFunction(
          `document.querySelector('[data-structure][data-pending="true"]') !== null`,
          undefined,
          waitTimeout
        )
      );

      const [saved] = (yield* readProposals(home)).structures ?? [];

      assert.strictEqual(
        saved?.change.action === "add" ? saved.change.at.x : -1,
        Number(x)
      );
    })
  );
});

describe.each(["iso", "plan"] as const)(
  "a proposed structure in the %s view",
  (which) => {
    it.live(
      "is drawn in the pending look, in every chapter, and its name tag clears every box and text",
      () =>
        Effect.gen(function* () {
          const { page } = yield* served;

          yield* chapter(page, "c-all");
          yield* addStructure(page, { name: "Build cache", x: 12, y: 12 });
          yield* waitFor(page, '[data-structure][data-pending="true"]');
          yield* view(page, which);

          for (const id of ["c-page", "c-save", "c-all"]) {
            yield* chapter(page, id);
            yield* view(page, which);

            const proposed = page.locator(
              '[data-structure][data-pending="true"]'
            );

            assert.strictEqual(
              yield* Effect.promise(() => proposed.count()),
              1,
              `chapter ${id}`
            );

            const stroke = yield* strokeOf(
              page,
              '[data-structure][data-pending="true"]'
            );

            const ink = yield* strokeOf(
              page,
              '[data-structure]:not([data-pending="true"])'
            );

            assert.notStrictEqual(stroke, ink);

            // No text badge on the map: the look is outlines and tints.
            assert.strictEqual(yield* count(page, "[data-pending-badge]"), 0);

            assert.isAbove(yield* count(page, "[data-name-tag]"), 0);
            assert.deepStrictEqual(yield* clashes(page), [], `chapter ${id}`);
          }
        }),
      90_000
    );
  }
);

describe("deleting a structure", () => {
  it.live(
    "is drawn crossed out in both views until reviewed, with no text on the mark",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* served;

        yield* chapter(page, "c-all");
        yield* click(page, '[data-structure="upstream"]');
        yield* waitFor(page, '[data-structure-panel="upstream"]');
        yield* click(page, '[data-change="delete"]');
        yield* waitFor(page, '[data-removed-mark="upstream"]');

        for (const which of ["iso", "plan"] as const) {
          yield* view(page, which);

          const mark = page.locator('[data-removed-mark="upstream"]');

          assert.strictEqual(yield* Effect.promise(() => mark.count()), 1);

          // The cross keeps clear of every chip and tag, wherever it is cut.
          const report = yield* Effect.promise(() =>
            page.evaluate<DrawingReport>(drawingReport)
          );

          assert.isAtLeast(report.strikes.length, 2);
          assert.deepStrictEqual(strikesOverText(report), []);
          assert.deepStrictEqual(yield* clashes(page), []);
        }

        const [saved] = (yield* readProposals(home)).structures ?? [];

        assert.deepStrictEqual(saved?.change, {
          action: "delete",
          structure: "upstream",
        });
        assert.include(
          yield* Effect.promise(() =>
            page.locator("[data-deleting]").textContent()
          ),
          "crossed out"
        );
      }),
    90_000
  );

  it.live(
    "is not in the exported SVG, which equals the CLI's",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* served;

        yield* chapter(page, "c-all");
        yield* addStructure(page, { name: "Build cache", x: 12, y: 12 });
        yield* waitFor(page, '[data-structure][data-pending="true"]');
        yield* click(page, '[data-structure="upstream"]');
        yield* click(page, '[data-change="delete"]');
        yield* waitFor(page, '[data-removed-mark="upstream"]');
        // A pinned structure puts the spotlight on it, which the CLI has no
        // way to match. Unpin it so both draw the chapter's spotlight.
        yield* Effect.promise(() => page.keyboard.press("Escape"));
        yield* Effect.promise(() =>
          page.waitForFunction(
            `document.querySelector('[data-structure][data-selected="true"]') === null`,
            undefined,
            waitTimeout
          )
        );

        for (const which of ["iso", "plan"] as const) {
          yield* view(page, which);
          yield* click(page, '[data-control="export"]');

          const [download] = yield* Effect.promise(() =>
            Promise.all([
              page.waitForEvent("download"),
              page.locator('[data-export-item="svg"]').click(),
            ])
          );

          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;

          const fromPage = new TextDecoder().decode(
            yield* fs.readFile(yield* Effect.promise(() => download.path()))
          );

          assert.notInclude(fromPage, "BUILD CACHE");
          assert.notInclude(fromPage, "Build cache");
          assert.notInclude(fromPage, "removed");
          assert.notInclude(fromPage, "strike");

          const target = path.join(home, "..", "out", `${which}.svg`);

          const exported = yield* runCli(home, [
            "export",
            home,
            "--format",
            "svg",
            "--view",
            which,
            "--output",
            target,
          ]);

          assert.strictEqual(exported.exitCode, 0, exported.stderr);
          assert.strictEqual(
            fromPage,
            yield* fs.readFileString(target),
            `${which}: the page's SVG differs from the CLI's`
          );
        }
      }).pipe(Effect.provide(NodeServices.layer)),
    90_000
  );
});

describe("the context menu on a structure", () => {
  it.live(
    "proposes a rename, a shape, a group, a status and a deletion, in both views",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* served;

        yield* chapter(page, "c-all");

        for (const which of ["iso", "plan"] as const) {
          yield* view(page, which);
          yield* Effect.promise(() =>
            page.locator('[data-structure="server"]').click({ button: "right" })
          );
          yield* waitFor(page, '[data-structure-menu="server"]');

          for (const entry of ["shape", "group", "status"]) {
            assert.strictEqual(
              yield* count(page, `[data-menu="${entry}"]`),
              1,
              entry
            );
          }

          assert.strictEqual(yield* count(page, '[data-menu="delete"]'), 1);
          assert.strictEqual(yield* count(page, '[data-menu="rename"]'), 1);

          yield* Effect.promise(() => page.keyboard.press("Escape"));
        }

        yield* Effect.promise(() =>
          page.locator('[data-structure="server"]').click({ button: "right" })
        );
        yield* click(page, '[data-menu="status"]');
        yield* click(page, '[data-menu-status="off"]');

        yield* Effect.promise(() =>
          page.waitForFunction(
            `document.querySelector('[data-structure="server"][data-pending="true"]') !== null`,
            undefined,
            waitTimeout
          )
        );

        const [saved] = (yield* readProposals(home)).structures ?? [];

        assert.deepStrictEqual(saved?.change, {
          action: "status",
          structure: "server",
          status: "off",
        });
      }),
    90_000
  );
});
