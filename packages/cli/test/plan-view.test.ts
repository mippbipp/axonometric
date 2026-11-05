import { LayoutFile, shapes } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, FileSystem, Order, Path, Schema } from "effect";
import type { Page } from "playwright";

import { attributesOf, openPage } from "./browser.ts";
import { fullMap, pipelineMap, shapesMap } from "./fixtures.ts";
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

/** How one part of a drawing is painted. */
interface Paint {
  readonly fill: string;
  readonly fillOpacity: number;
  readonly stroke: string;
  readonly dashes: string;
}

/** Whether any part is dashed. */
const dashed = (look: readonly Paint[]) =>
  Arr.some(look, ({ dashes }) => dashes !== "none");

/** How many parts draw a solid outline. */
const solidOutlines = (look: readonly Paint[]) =>
  Arr.filter(
    look,
    ({ stroke, dashes }) => stroke !== "none" && dashes === "none"
  ).length;

/** Whether a part with no outline lays a see-through tint over the box. */
const tinted = (look: readonly Paint[]) =>
  Arr.some(
    look,
    ({ stroke, fillOpacity }) =>
      stroke === "none" && fillOpacity > 0 && fillOpacity < 1
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
        yield* click(page, "[data-packet]");
        yield* waitFor(page, "[data-packet-panel]");

        // h-save is the chapter's hop with a payload.
        for (let steps = 0; steps < 3; steps += 1) {
          if (
            (yield* Effect.promise(() =>
              page.locator('[data-packet-panel="h-save"]').count()
            )) > 0
          ) {
            break;
          }

          yield* click(page, '[data-playback-controls] [data-control="step"]');
        }

        yield* waitFor(page, '[data-packet-panel="h-save"]');
        assert.strictEqual(
          yield* Effect.promise(() =>
            page.locator("[data-packet-payload]").textContent()
          ),
          `{
  "kind": "note",
  "target": "server"
}`
        );
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
              [child.tagName, child.getAttribute("fill") ?? "", child.getAttribute("stroke-width") ?? "", child.getAttribute("opacity") ?? ""].join(".")
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

  it.live(
    "draws new, external and planned structures with different outlines",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* reviewPage;

          yield* showPlan(page);

          // How each part a structure draws around and over its box is
          // painted, as the browser computes it.
          const lookOf = (id: string) =>
            inPage<readonly Paint[]>(
              page,
              `Array.from(document.querySelectorAll('[data-structure="${id}"] > rect, [data-structure="${id}"] > polygon'), (part) => {
                const style = getComputedStyle(part);

                return { fill: style.fill, fillOpacity: Number(style.fillOpacity), stroke: style.stroke, dashes: style.strokeDasharray };
              })`
            );

          yield* goToChapter(page, "c-save");

          const fresh = yield* lookOf("server");

          yield* goToChapter(page, "c-all");

          const settled = yield* lookOf("server");
          const external = yield* lookOf("upstream");
          const planned = yield* lookOf("pull-request");

          // A new box is tinted, not ringed with dashes.
          assert.isTrue(tinted(fresh), "new isn't tinted");
          assert.isFalse(tinted(settled), "settled is tinted");
          assert.isFalse(dashed(fresh), "new is dashed");
          // The external ring is a solid second outline.
          assert.isAtLeast(solidOutlines(external), 2);
          assert.strictEqual(solidOutlines(settled), 1);
          assert.isFalse(dashed(external), "external is dashed");
          assert.isTrue(dashed(planned), "planned isn't dashed");
        })
      )
  );
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
