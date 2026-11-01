import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect } from "effect";
import type { Page } from "playwright";

import { boxesOf } from "./browser.ts";
import { shapesMap } from "./fixtures.ts";
import { buildAndOpen } from "./harness.ts";

const builtPage = Effect.gen(function* () {
  return yield* buildAndOpen(yield* shapesMap, "shapes");
});

/** The viewport's current zoom, as the `data-scale` on the canvas. */
const scaleOf = (page: Page) =>
  Effect.promise(() =>
    page.evaluate<number>(
      'Number(document.querySelector("svg[data-scale]").dataset.scale)'
    )
  );

/** The box holding every structure and name tag on screen. */
const drawingOf = Effect.fnUntraced(function* (page: Page) {
  const drawn = yield* boxesOf(page, "[data-structure], [data-name-tag]");

  return {
    left: Math.min(...Arr.map(drawn, (box) => box.x)),
    top: Math.min(...Arr.map(drawn, (box) => box.y)),
    right: Math.max(...Arr.map(drawn, (box) => box.x + box.width)),
    bottom: Math.max(...Arr.map(drawn, (box) => box.y + box.height)),
  };
});

const canvasOf = Effect.fnUntraced(function* (page: Page) {
  const [svg] = yield* boxesOf(page, "svg[data-scale]");

  assert.isDefined(svg);

  return svg ?? { x: 0, y: 0, width: 0, height: 0 };
});

/** Asserts that every structure and name tag is inside the canvas. */
const assertFitted = Effect.fnUntraced(function* (page: Page) {
  const svg = yield* canvasOf(page);
  const drawing = yield* drawingOf(page);

  assert.isAtLeast(drawing.left, svg.x);
  assert.isAtLeast(drawing.top, svg.y);
  assert.isAtMost(drawing.right, svg.x + svg.width);
  assert.isAtMost(drawing.bottom, svg.y + svg.height);

  return { svg, drawing };
});

/** Moves the mouse to the middle of the canvas and turns the wheel. */
const wheelAtCentre = Effect.fnUntraced(function* (page: Page, deltaY: number) {
  const svg = yield* canvasOf(page);

  yield* Effect.promise(() =>
    page.mouse.move(svg.x + svg.width / 2, svg.y + svg.height / 2)
  );
  yield* Effect.promise(() => page.mouse.wheel(0, deltaY));
});

/**
 * Records every click that reaches the document, as the id of the structure
 * it landed on, or null.
 */
const recordClicks = (page: Page) =>
  Effect.promise(() =>
    page.evaluate(`
      window.clicked = [];
      document.addEventListener("click", (event) => {
        const structure = event.target.closest("[data-structure]");
        window.clicked.push(structure?.dataset.structure ?? null);
      });
    `)
  );

const clickedOf = (page: Page) =>
  Effect.promise(() =>
    page.evaluate<readonly (string | null)[]>("window.clicked")
  );

describe("the viewport", () => {
  it.live("zooms in with the wheel, around the cursor", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;
        const before = yield* scaleOf(page);

        yield* wheelAtCentre(page, -300);

        const after = yield* scaleOf(page);

        assert.isAbove(after, before * 1.3);
      })
    )
  );

  it.live("stops zooming at its limits", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;
        const fitted = yield* scaleOf(page);

        for (let turn = 0; turn < 20; turn += 1) {
          yield* wheelAtCentre(page, -1000);
        }

        const most = yield* scaleOf(page);

        for (let turn = 0; turn < 40; turn += 1) {
          yield* wheelAtCentre(page, 1000);
        }

        const least = yield* scaleOf(page);

        assert.isBelow(most, fitted * 10);
        assert.isAbove(least, fitted / 10);
        assert.isBelow(least, fitted);
      })
    )
  );

  it.live("pans when dragged on empty space", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;
        const svg = yield* canvasOf(page);
        const before = yield* drawingOf(page);

        // The top-left corner of the canvas is empty in the fixture.
        yield* Effect.promise(() => page.mouse.move(svg.x + 10, svg.y + 10));
        yield* Effect.promise(() => page.mouse.down());
        yield* Effect.promise(() =>
          page.mouse.move(svg.x + 110, svg.y + 60, { steps: 5 })
        );
        yield* Effect.promise(() => page.mouse.up());

        const after = yield* drawingOf(page);

        assert.closeTo(after.left - before.left, 100, 1);
        assert.closeTo(after.top - before.top, 50, 1);
      })
    )
  );

  it.live("lets a click on a structure land, without panning", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;
        const before = yield* drawingOf(page);

        yield* recordClicks(page);

        const [box] = yield* boxesOf(page, '[data-structure="box"]');

        assert.isDefined(box);

        if (box === undefined) {
          return;
        }

        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;

        yield* Effect.promise(() => page.mouse.move(x, y));
        yield* Effect.promise(() => page.mouse.down());
        yield* Effect.promise(() =>
          page.mouse.move(x + 40, y + 20, { steps: 4 })
        );
        yield* Effect.promise(() => page.mouse.move(x, y, { steps: 4 }));
        yield* Effect.promise(() => page.mouse.up());

        assert.deepStrictEqual(yield* drawingOf(page), before);
        assert.deepStrictEqual(yield* clickedOf(page), ["box"]);
      })
    )
  );

  it.live("lets the next click land after a touch pan", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;
        const svg = yield* canvasOf(page);
        const before = yield* drawingOf(page);

        yield* recordClicks(page);

        // A touch pan fires pointer events but no click afterwards.
        const cdp = yield* Effect.promise(() =>
          page.context().newCDPSession(page)
        );

        const touch = (
          type: "touchStart" | "touchMove" | "touchEnd",
          x: number,
          y: number
        ) =>
          Effect.promise(() =>
            cdp.send("Input.dispatchTouchEvent", {
              type,
              touchPoints:
                type === "touchEnd" ? [] : [{ x: svg.x + x, y: svg.y + y }],
            })
          );

        yield* Effect.promise(() =>
          cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true })
        );
        yield* touch("touchStart", 10, 10);

        for (let step = 1; step <= 5; step += 1) {
          yield* touch("touchMove", 10 + step * 20, 10 + step * 10);
        }

        yield* touch("touchEnd", 110, 60);

        const after = yield* drawingOf(page);
        const [box] = yield* boxesOf(page, '[data-structure="box"]');

        assert.isDefined(box);

        if (box === undefined) {
          return;
        }

        yield* Effect.promise(() =>
          page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
        );

        assert.closeTo(after.left - before.left, 100, 1);
        assert.deepStrictEqual(yield* clickedOf(page), ["box"]);
      })
    )
  );

  it.live("lets a click on a structure land after a mouse pan", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;
        const svg = yield* canvasOf(page);

        yield* recordClicks(page);
        yield* Effect.promise(() => page.mouse.move(svg.x + 10, svg.y + 10));
        yield* Effect.promise(() => page.mouse.down());
        yield* Effect.promise(() =>
          page.mouse.move(svg.x + 110, svg.y + 60, { steps: 5 })
        );
        yield* Effect.promise(() => page.mouse.up());

        const [box] = yield* boxesOf(page, '[data-structure="box"]');

        assert.isDefined(box);

        if (box === undefined) {
          return;
        }

        yield* Effect.promise(() =>
          page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
        );

        // The drag's own click is swallowed; the real one lands.
        assert.deepStrictEqual(yield* clickedOf(page), ["box"]);
      })
    )
  );

  it.live("fits everything back in the window with Zoom to fit", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;
        const fitted = yield* scaleOf(page);

        yield* wheelAtCentre(page, -600);
        yield* Effect.promise(() =>
          page.getByRole("button", { name: "Zoom to fit" }).click()
        );

        assert.closeTo(yield* scaleOf(page), fitted, 1e-6);
        yield* assertFitted(page);
      })
    )
  );

  it.live("fits again when the window is resized", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;
        const before = yield* scaleOf(page);

        yield* Effect.promise(() =>
          page.setViewportSize({ width: 600, height: 420 })
        );
        yield* Effect.promise(() =>
          page.waitForFunction(
            `Number(document.querySelector("svg[data-scale]").dataset.scale) < ${before * 0.8}`
          )
        );

        const { svg, drawing } = yield* assertFitted(page);

        // Fitted, not just shrunk: the drawing fills most of one dimension.
        const share = Math.max(
          (drawing.right - drawing.left) / svg.width,
          (drawing.bottom - drawing.top) / svg.height
        );

        assert.isAbove(share, 0.7);
      })
    )
  );
});
