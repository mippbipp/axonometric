import { LayoutFile, shapes } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  FileSystem,
  Order,
  Path,
  Schema,
  String as Str,
} from "effect";
import type { Page } from "playwright";

import { attributesOf, openPage } from "./browser.ts";
import { drawingReport, overlap } from "./drawing-report.ts";
import type { DrawingReport } from "./drawing-report.ts";
import { crowdedMap, fullMap, pipelineMap, shapesMap } from "./fixtures.ts";
import { buildAndOpen, makeHome, runCli } from "./harness.ts";

const inPage = <A>(page: Page, expression: string) =>
  Effect.promise(() => page.evaluate<A>(expression));

const click = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).first().click());

const waitFor = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).first().waitFor());

const press = (page: Page, key: string) =>
  Effect.promise(() => page.keyboard.press(key));

const goToChapter = Effect.fnUntraced(function* (page: Page, id: string) {
  yield* click(page, `[data-chapter-rail] button[data-chapter="${id}"]`);
  yield* waitFor(page, `[data-walkthrough][data-chapter="${id}"]`);
});

const showPlan = Effect.fnUntraced(function* (page: Page) {
  yield* click(page, '[data-view-toggle] [data-view="plan"]');
  yield* waitFor(page, '[data-walkthrough][data-view="plan"]');
});

/**
 * The middle of the structure's drawing in the drawing's own units, so a
 * refit doesn't change it.
 */
const centreOf = (page: Page, id: string) =>
  inPage<{ x: number; y: number }>(
    page,
    `(() => {
      const box = document.querySelector('[data-structure="${id}"]').getBBox();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    })()`
  );

/**
 * The ground point under the middle of the map's canvas, in grid units,
 * read from where two structures' footprints are drawn.
 */
const groundAtMiddle = (page: Page) =>
  inPage<{ x: number; y: number }>(
    page,
    `(() => {
      const svg = document.querySelector("svg[data-scale]");
      const rect = svg.getBoundingClientRect();
      const world = document.querySelector("[data-viewport]");
      const matrix = world.getScreenCTM().inverse();
      const at = new DOMPoint(rect.left + rect.width / 2, rect.top + rect.height / 2).matrixTransform(matrix);
      const view = document.querySelector("[data-walkthrough]").dataset.view;

      return view === "plan"
        ? { x: at.x / 60, y: at.y / 60 }
        : { x: (at.x / 36 + at.y / 18) / 2, y: (at.y / 18 - at.x / 36) / 2 };
    })()`
  );

const reviewPage = Effect.gen(function* () {
  const opened = yield* buildAndOpen(yield* fullMap, "review");

  yield* Effect.promise(() =>
    opened.page.setViewportSize({ width: 1280, height: 800 })
  );

  return opened;
});

describe("Plan view", () => {
  it.live(
    "the toggle and v switch views, keeping the chapter, the selection and the middle",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page, errors } = yield* reviewPage;

          yield* goToChapter(page, "c-save");
          yield* click(page, '[data-structure="server"]');
          yield* waitFor(page, '[data-structure-panel="server"][data-pinned]');

          const before = yield* groundAtMiddle(page);

          yield* showPlan(page);

          const after = yield* groundAtMiddle(page);

          assert.strictEqual(
            yield* Effect.promise(() =>
              page
                .locator('[data-view-toggle] [data-view="plan"]')
                .getAttribute("aria-pressed")
            ),
            "true"
          );
          assert.closeTo(after.x, before.x, 0.05);
          assert.closeTo(after.y, before.y, 0.05);
          yield* waitFor(page, '[data-walkthrough][data-chapter="c-save"]');
          yield* waitFor(
            page,
            '[data-structure="server"][data-selected="true"]'
          );
          yield* waitFor(page, '[data-structure-panel="server"][data-pinned]');
          yield* waitFor(page, '[data-structure="server"] [data-plan-icon]');

          yield* press(page, "v");
          yield* waitFor(page, '[data-walkthrough][data-view="iso"]');

          const back = yield* groundAtMiddle(page);

          assert.closeTo(back.x, before.x, 0.05);
          assert.closeTo(back.y, before.y, 0.05);
          yield* waitFor(
            page,
            '[data-structure="server"][data-selected="true"]'
          );

          yield* press(page, "v");
          yield* waitFor(page, '[data-walkthrough][data-view="plan"]');
          yield* waitFor(page, '[data-walkthrough][data-chapter="c-save"]');
          assert.deepStrictEqual(errors, []);
        })
      ),
    30_000
  );

  it.live("pins a structure on click, and opens a packet's payload", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;

        yield* showPlan(page);
        yield* goToChapter(page, "c-save");
        yield* click(page, '[data-structure="page"]');
        yield* waitFor(page, '[data-structure-panel="page"][data-pinned]');
        yield* waitFor(page, '[data-structure="page"][data-selected="true"]');
        yield* waitFor(page, "[data-selection-marker=page]");

        yield* click(page, '[data-playback-controls] [data-control="pause"]');

        const [hop] = yield* attributesOf(page, "[data-packet]", "data-packet");

        assert.isDefined(hop);
        yield* click(page, "[data-packet]");
        yield* waitFor(page, `[data-packet-panel="${hop}"]`);
      })
    )
  );

  it.live("goes inside a structure on double-click, and comes back out", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* buildAndOpen(
          yield* pipelineMap,
          "flake-pipeline"
        );

        yield* showPlan(page);
        yield* Effect.promise(() =>
          page.locator('[data-structure="updater"]').dblclick()
        );
        yield* waitFor(page, '[data-inside-view="updater"]');

        // Neither the key nor the toggle switches views while it's open.
        yield* press(page, "v");

        const toggle = page.locator('[data-view-toggle] [data-view="iso"]');

        assert.isTrue(yield* Effect.promise(() => toggle.isDisabled()));
        assert.include(
          (yield* Effect.promise(() => toggle.getAttribute("title"))) ?? "",
          "inside view"
        );

        yield* press(page, "Escape");
        yield* waitFor(page, '[data-walkthrough][data-view="plan"]');
        yield* waitFor(page, '[data-structure="updater"] [data-plan-icon]');
      })
    )
  );

  it.live("draws an icon for each shape", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* buildAndOpen(yield* shapesMap, "shapes");

        yield* showPlan(page);

        const icons = yield* attributesOf(
          page,
          "[data-structure] [data-plan-icon]",
          "data-plan-icon"
        );

        const parts = yield* inPage<string[]>(
          page,
          `Array.from(document.querySelectorAll("[data-plan-icon]"), (icon) =>
            Array.from(icon.querySelectorAll("*"), (child) =>
              child.tagName + "." + (child.getAttribute("class") ?? "")
            ).join(" ")
          )`
        );

        assert.deepStrictEqual(
          Arr.sort(icons, Order.String),
          Arr.sort([...shapes], Order.String)
        );
        assert.lengthOf(new Set(parts), shapes.length);
      })
    )
  );

  it.live("gives live, planned and off their own look", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* buildAndOpen(yield* shapesMap, "shapes");

        yield* showPlan(page);

        const lookOf = (id: string) =>
          inPage<{ dashes: string; face: string; hatch: string; off: number }>(
            page,
            `(() => {
              const structure = document.querySelector('[data-structure="${id}"]');
              return {
                dashes: getComputedStyle(structure).strokeDasharray,
                face: getComputedStyle(structure.querySelector("[data-face]")).fill,
                hatch: getComputedStyle(structure.querySelector("[data-hatch]")).display,
                off: structure.querySelectorAll("[data-off-mark]").length,
              };
            })()`
          );

        const live = yield* lookOf("box");
        const planned = yield* lookOf("cards");
        const off = yield* lookOf("slab");

        assert.strictEqual(live.dashes, "none");
        assert.notStrictEqual(planned.dashes, "none");
        assert.strictEqual(planned.hatch, "none");
        assert.notStrictEqual(live.hatch, "none");
        assert.strictEqual(off.dashes, "none");
        assert.notStrictEqual(off.face, live.face);
        assert.notStrictEqual(off.face, planned.face);
        assert.strictEqual(off.off, 1);
        assert.strictEqual(live.off, 0);
      })
    )
  );

  it.live(
    "draws new, external and planned structures with different outlines",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* reviewPage;

          yield* showPlan(page);

          // What a structure draws around and over its box: each part's
          // tag, fill class and dash pattern.
          const outlineOf = (id: string) =>
            inPage<string>(
              page,
              `Array.from(document.querySelectorAll('[data-structure="${id}"] > rect, [data-structure="${id}"] > polygon'), (part) =>
                [part.tagName, part.getAttribute("class") ?? "", getComputedStyle(part).strokeDasharray, part.hasAttribute("data-new-marker"), part.hasAttribute("data-external-ring")].join(":")
              ).join(" ")`
            );

          yield* goToChapter(page, "c-save");

          const fresh = yield* outlineOf("server");

          yield* goToChapter(page, "c-all");

          const settled = yield* outlineOf("server");
          const external = yield* outlineOf("upstream");
          const planned = yield* outlineOf("pull-request");

          assert.notStrictEqual(fresh, settled, "new looks like settled");
          assert.lengthOf(new Set([fresh, external, planned]), 3);

          // A new box is tinted, not ringed with dashes.
          assert.include(fresh, "true:false");
          assert.notInclude(fresh, "4px, 3px");
          // The external ring is a solid second outline.
          assert.include(external, "false:true");
          assert.notInclude(external, "4px, 3px:false:true");
          assert.include(planned, "4px, 3px");
        })
      )
  );

  for (const { name, map, system } of [
    { name: "review", map: fullMap, system: "review" },
    { name: "crowded", map: crowdedMap, system: "crowded" },
    { name: "pipeline", map: pipelineMap, system: "flake-pipeline" },
  ]) {
    it.live(
      `keeps text clear of text and boxes on the ${name} map at 1280×800`,
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { page } = yield* buildAndOpen(yield* map, system);

            yield* Effect.promise(() =>
              page.setViewportSize({ width: 1280, height: 800 })
            );
            yield* showPlan(page);

            const chapters = yield* attributesOf(
              page,
              "[data-chapter-rail] button[data-chapter]",
              "data-chapter"
            );

            for (const chapter of chapters) {
              yield* goToChapter(page, chapter);
              yield* click(
                page,
                '[data-playback-controls] [data-control="pause"]'
              );

              const report = yield* inPage<DrawingReport>(page, drawingReport);

              const clashes = [
                ...Arr.flatMap(report.text, (first, index) =>
                  Arr.flatMap(report.text.slice(index + 1), (second) =>
                    overlap(first.polygon, second.polygon)
                      ? [`${first.id} × ${second.id}`]
                      : []
                  )
                ),
                ...Arr.flatMap(report.text, (text) =>
                  Arr.flatMap(report.structures, (box) =>
                    overlap(text.polygon, box.polygon)
                      ? [`${text.id} × ${box.id}`]
                      : []
                  )
                ),
              ];

              assert.isNotEmpty(
                Arr.filter(report.text, ({ id }) =>
                  Str.startsWith("label:")(id)
                ),
                `no hop labels in ${chapter}`
              );
              assert.deepStrictEqual(clashes, [], `in ${chapter}`);
            }
          })
        ),
      60_000
    );
  }
});

/** The review map's layout.json with the server moved to `x`. */
const withServerAt = Effect.fnUntraced(function* (text: string, x: number) {
  const layout = yield* Schema.decodeEffect(LayoutFile)(text);
  const { server } = layout.structures;

  assert.isDefined(server);

  return yield* Schema.encodeEffect(LayoutFile)({
    ...layout,
    structures: { ...layout.structures, server: { ...server, x } },
  });
});

describe("both views", () => {
  it.live(
    "move a structure whose position changes in layout.json",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const files = yield* fullMap;
          const home = yield* makeHome(files);
          const map = path.join(home, "review", "map");
          const html = path.join(home, "review", "review.html");

          const measure = Effect.fnUntraced(function* () {
            const built = yield* runCli(home, ["build", map]);

            assert.strictEqual(built.exitCode, 0, built.stderr);

            const { page } = yield* openPage(html);

            yield* goToChapter(page, "c-all");

            const offset = Effect.fnUntraced(function* () {
              const server = yield* centreOf(page, "server");
              const engineer = yield* centreOf(page, "engineer");

              return { x: server.x - engineer.x, y: server.y - engineer.y };
            });

            const iso = yield* offset();

            yield* showPlan(page);

            return { iso, plan: yield* offset() };
          });

          const before = yield* measure();

          const layoutPath = path.join(map, "layout.json");

          yield* fs.writeFileString(
            layoutPath,
            yield* withServerAt(yield* fs.readFileString(layoutPath), 9)
          );

          const after = yield* measure();

          // One grid unit along x moves right and down in the Iso view, and
          // straight right in Plan view.
          assert.closeTo(after.iso.x - before.iso.x, 36, 0.5);
          assert.closeTo(after.iso.y - before.iso.y, 18, 0.5);
          assert.closeTo(after.plan.x - before.plan.x, 60, 0.5);
          assert.closeTo(after.plan.y - before.plan.y, 0, 0.5);
        }).pipe(Effect.provide(NodeServices.layer))
      ),
    60_000
  );
});
