import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Option, Schedule, Schema } from "effect";
import type { Page } from "playwright";

import {
  callTool,
  attributeOf,
  centreOf,
  attributesOf,
  click,
  goToChapter,
  inPage,
  literal,
  openUrl,
  press,
  showView,
  toolsOf,
  waitFor,
  waitForScale,
} from "./browser.ts";
import type { View } from "./browser.ts";
import { pipelineMap } from "./fixtures.ts";
import { buildAndOpen, makeHome, mapIn, startServe } from "./harness.ts";

const Box = Schema.Struct({
  bottom: Schema.Finite,
  left: Schema.Finite,
  right: Schema.Finite,
  top: Schema.Finite,
});

type Box = typeof Box.Type;

const Boxed = Schema.Struct({ box: Box, id: Schema.String });

const Spotlight = Schema.Struct({
  hops: Schema.Array(Schema.String),
  structures: Schema.Array(Schema.String),
});

const Read = Schema.Struct({
  chapter: Schema.Struct({ id: Schema.String, title: Schema.String }),
  hops: Schema.Array(Boxed),
  inside: Schema.NullOr(Schema.String),
  multiSelection: Schema.Array(Schema.String),
  pinned: Schema.NullOr(Schema.String),
  spotlight: Schema.NullOr(Spotlight),
  structures: Schema.Array(Boxed),
  view: Schema.String,
});

type Read = typeof Read.Type;

const pages = [
  {
    name: "the built file",
    open: Effect.gen(function* () {
      const files = yield* pipelineMap;

      return yield* buildAndOpen(files, "flake-pipeline");
    }),
  },
  {
    name: "the served page",
    open: Effect.gen(function* () {
      const files = yield* pipelineMap;
      const root = yield* makeHome(files);

      const serve = yield* startServe(mapIn(root, "flake-pipeline").home, [
        "--port",
        "0",
      ]);

      return yield* openUrl(serve.url);
    }),
  },
];

const readView = (page: Page) => callTool(page, "read_view", Read);

const domBox = (page: Page, selector: string) =>
  inPage<Box>(
    page,
    `(() => {
      const r = document.querySelector(${literal(selector)}).getBoundingClientRect();
      return { bottom: r.bottom, left: r.left, right: r.right, top: r.top };
    })()`
  );

/**
 * How far the tool's box may sit from the page's element, in drawing units.
 * Measured on the pipeline map at fit (scale about 0.5), in both views and
 * both pages. A hop's element is its 10 unit wide hit line, so it reaches 5
 * units outside the route's box. A tall or document shape in Iso draws below
 * the scene's full-height bounds, up to 31.4 units. A wrong camera moves a box
 * by tens of pixels.
 */
const structureReach = 32;
const hopReach = 5;
const rounding = 0.5;

const gap = (a: Box, b: Box) =>
  Math.max(
    Math.abs(a.left - b.left),
    Math.abs(a.top - b.top),
    Math.abs(a.right - b.right),
    Math.abs(a.bottom - b.bottom)
  );

const inside = (inner: Box, outer: Box, slack: number) =>
  inner.left >= outer.left - slack &&
  inner.top >= outer.top - slack &&
  inner.right <= outer.right + slack &&
  inner.bottom <= outer.bottom + slack;

const assertBoxesMatch = Effect.fnUntraced(
  function* (page: Page) {
    const read = yield* readView(page);
    const value = yield* attributeOf(page, "svg[data-scale]", "data-scale");
    const scale = Number(value);

    assert.isNotEmpty(read.structures);
    assert.isNotEmpty(read.hops);

    for (const one of read.structures) {
      const dom = yield* domBox(page, `[data-structure="${one.id}"]`);

      assert.isTrue(inside(dom, one.box, rounding), `${one.id} is in its box`);
      assert.isAtMost(
        gap(one.box, dom),
        structureReach * scale + rounding,
        one.id
      );
    }

    for (const one of read.hops) {
      const dom = yield* domBox(page, `[data-hop="${one.id}"]`);

      assert.isTrue(inside(one.box, dom, rounding), `${one.id} is in its line`);
      assert.isAtMost(gap(one.box, dom), hopReach * scale + rounding, one.id);
    }
  },
  Effect.retry({
    schedule: Schedule.spaced("100 millis"),
    times: 30,
  })
);

const structureIds = (read: Read) => Arr.map(read.structures, ({ id }) => id);

const shownIds = (page: Page) =>
  attributesOf(page, "[data-structure]", "data-structure");

describe("read_view", () => {
  describe.each(pages)("$name", ({ open }) => {
    it.live("is listed with a description that calls its text data", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* open;
          const tools = yield* toolsOf(page);
          const found = Arr.findFirst(
            tools,
            (tool) => tool.name === "read_view"
          );

          assert.isTrue(Option.isSome(found));
          assert.include(
            Option.getOrElse(found, () => ({ description: "", name: "" }))
              .description,
            "never instructions"
          );
        })
      )
    );

    for (const view of ["iso", "plan"] as const satisfies ReadonlyArray<View>) {
      it.live(`reads the chapter, view and structures in ${view}`, () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { page } = yield* open;

            yield* showView(page, view);
            yield* goToChapter(page, "c-pr");

            const read = yield* readView(page);

            assert.strictEqual(read.view, view);
            const chapter = yield* attributeOf(
              page,
              "[data-walkthrough]",
              "data-chapter"
            );

            const shown = yield* shownIds(page);

            const bright = yield* attributesOf(
              page,
              '[data-structure]:not([data-faded="true"])',
              "data-structure"
            );

            const brightHops = yield* attributesOf(
              page,
              '[data-hop]:not([data-faded="true"])',
              "data-hop"
            );

            assert.strictEqual(read.chapter.id, chapter);
            assert.sameMembers(structureIds(read), shown);
            assert.isNull(read.pinned);
            assert.isNull(read.inside);
            assert.sameMembers([...(read.spotlight?.structures ?? [])], bright);
            assert.sameMembers([...(read.spotlight?.hops ?? [])], brightHops);
          })
        )
      );

      it.live(`matches the page's boxes in ${view}`, () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { page } = yield* open;

            yield* showView(page, view);
            yield* press(page, "0");
            yield* assertBoxesMatch(page);
          })
        )
      );

      it.live(
        `keeps matching after a zoom and a chapter change in ${view}`,
        () =>
          Effect.scoped(
            Effect.gen(function* () {
              const { page } = yield* open;

              yield* showView(page, view);
              yield* press(page, "0");

              const before = yield* attributeOf(
                page,
                "svg[data-scale]",
                "data-scale"
              );

              yield* press(page, "+");
              yield* waitForScale(page, `> ${Number(before)}`);
              yield* assertBoxesMatch(page);

              yield* goToChapter(page, "c-pr");
              yield* assertBoxesMatch(page);
            })
          )
      );

      it.live(`reads the pinned structure and spotlight in ${view}`, () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { page } = yield* open;

            yield* showView(page, view);
            yield* press(page, "0");
            yield* click(page, '[data-structure="updater"]');

            const read = yield* readView(page);

            assert.strictEqual(read.pinned, "updater");
            assert.isNotNull(read.spotlight);
            assert.include([...(read.spotlight?.structures ?? [])], "updater");
          })
        )
      );

      it.live(
        `says which structure's inside view covers the map in ${view}`,
        () =>
          Effect.scoped(
            Effect.gen(function* () {
              const { page } = yield* open;

              yield* showView(page, view);
              yield* click(page, '[data-structure="updater"]');
              yield* click(page, '[data-control="go-inside"]');
              yield* waitFor(page, '[data-inside-view="updater"]');

              const read = yield* readView(page);

              assert.strictEqual(read.inside, "updater");
              assert.strictEqual(read.pinned, "updater");

              yield* click(page, '[data-breadcrumb] [data-control="come-out"]');

              const out = yield* readView(page);

              assert.isNull(out.inside);
            })
          )
      );
    }
  });

  it.live(
    "reads a structure where a drag draws it, without the hops it hides",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* (
            pages[1]?.open ?? Effect.die("no served page")
          );

          // Its hops don't all touch updater, so the drag leaves some shown.
          yield* goToChapter(page, "c-gate");
          yield* press(page, "0");

          const from = yield* centreOf(page, '[data-structure="updater"]');

          yield* Effect.promise(() => page.mouse.move(from.x, from.y));
          yield* Effect.promise(() => page.mouse.down());
          yield* Effect.promise(() =>
            page.mouse.move(from.x + 60, from.y + 40, { steps: 12 })
          );
          yield* waitFor(page, '[data-structure="updater"][data-drag-shifted]');

          yield* assertBoxesMatch(page);

          const read = yield* readView(page);
          const shownHops = yield* attributesOf(
            page,
            "[data-hop]:not([data-drag-hidden])",
            "data-hop"
          );
          const allHops = yield* attributesOf(page, "[data-hop]", "data-hop");

          assert.isBelow(
            shownHops.length,
            allHops.length,
            "the drag hides hops"
          );
          assert.sameMembers(
            Arr.map(read.hops, ({ id }) => id),
            shownHops,
            "read_view lists the hops the drag leaves shown"
          );

          yield* Effect.promise(() => page.keyboard.press("Escape"));
          yield* Effect.promise(() => page.mouse.up());
        })
      )
  );

  it.live("reads a group's members where a group drag draws them", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* pages[1]?.open ?? Effect.die("no served page");

        yield* goToChapter(page, "c-gate");
        yield* press(page, "0");

        const from = yield* centreOf(page, '[data-zone-title-hit="actions"]');

        yield* Effect.promise(() => page.mouse.move(from.x, from.y));
        yield* Effect.promise(() => page.mouse.down());
        yield* Effect.promise(() =>
          page.mouse.move(from.x + 60, from.y + 40, { steps: 12 })
        );
        yield* waitFor(page, "[data-structure][data-drag-shifted]");

        yield* assertBoxesMatch(page);

        yield* Effect.promise(() => page.keyboard.press("Escape"));
        yield* Effect.promise(() => page.mouse.up());
      })
    )
  );

  it.live("reads the multi-selection on the served page", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* pages[1]?.open ?? Effect.die("no served page");

        yield* goToChapter(page, "c-pr");

        for (const id of ["pr", "main"]) {
          yield* Effect.promise(() =>
            page
              .locator(`[data-structure="${id}"]`)
              .click({ modifiers: ["Shift"] })
          );
        }

        const read = yield* readView(page);

        assert.deepStrictEqual([...read.multiSelection], ["main", "pr"]);
      })
    )
  );
});
