import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect } from "effect";
import type { Page } from "playwright";

import {
  boxesOf,
  cameraChangedWithin,
  cameraOf,
  inPage,
  literal,
  press,
  scaleExpression,
  scaleOf,
  waitForCameraChange,
  showView,
  waitFor,
  waitForScale,
} from "./browser.ts";
import { shapesMap } from "./fixtures.ts";
import { buildAndOpen } from "./harness.ts";

const builtPage = Effect.gen(function* () {
  const shapesMapFiles = yield* shapesMap;

  return yield* buildAndOpen(shapesMapFiles, "shapes");
});

/** The box holding every structure and name tag on screen. */
const drawingOf = Effect.fnUntraced(function* (page: Page) {
  const drawn = yield* boxesOf(
    page,
    "[data-structure], [data-name-tag], [data-zone]"
  );

  return {
    bottom: Math.max(...Arr.map(drawn, (box) => box.y + box.height)),
    left: Math.min(...Arr.map(drawn, (box) => box.x)),
    right: Math.max(...Arr.map(drawn, (box) => box.x + box.width)),
    top: Math.min(...Arr.map(drawn, (box) => box.y)),
  };
});

const canvasOf = Effect.fnUntraced(function* (page: Page) {
  const [svg] = yield* boxesOf(page, "svg[data-scale]");

  assert.isDefined(svg);

  return svg ?? { height: 0, width: 0, x: 0, y: 0 };
});

/** Asserts that every structure and name tag is inside the canvas. */
const assertFitted = Effect.fnUntraced(function* (page: Page) {
  const svg = yield* canvasOf(page);
  const drawing = yield* drawingOf(page);

  assert.isAtLeast(drawing.left, svg.x);
  assert.isAtLeast(drawing.top, svg.y);
  assert.isAtMost(drawing.right, svg.x + svg.width);
  assert.isAtMost(drawing.bottom, svg.y + svg.height);

  return { drawing, svg };
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

/** The clicks recorded so far, once there are `count` of them. */
const clickedOf = Effect.fnUntraced(function* (page: Page, count = 1) {
  yield* Effect.promise(() =>
    page.waitForFunction(`window.clicked.length >= ${count}`, undefined, {
      timeout: 5000,
    })
  );

  return yield* Effect.promise(() =>
    page.evaluate<ReadonlyArray<string | null>>("window.clicked")
  );
});

describe("the viewport", () => {
  it.live("zooms in with the wheel, around the cursor", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;
        const before = yield* scaleOf(page);
        const svg = yield* canvasOf(page);
        const [box] = yield* boxesOf(page, '[data-structure="box"]');

        assert.isDefined(box);

        // A corner of the box, away from the canvas's middle, stays under
        // the cursor while the map grows around it.
        const at = {
          x: (box?.x ?? 0) + (box?.width ?? 0) * 0.25,
          y: (box?.y ?? 0) + (box?.height ?? 0) * 0.25,
        };

        assert.isAbove(
          Math.hypot(
            at.x - (svg.x + svg.width / 2),
            at.y - (svg.y + svg.height / 2)
          ),
          50
        );

        yield* Effect.promise(() => page.mouse.move(at.x, at.y));
        yield* Effect.promise(() => page.mouse.wheel(0, -300));
        yield* waitForScale(page, `> ${before * 1.3}`);

        const after = yield* scaleOf(page);
        const [grown] = yield* boxesOf(page, '[data-structure="box"]');
        const ratio = after / before;

        assert.isAbove(ratio, 1.3);
        assert.closeTo(
          at.x - (grown?.x ?? 0),
          (at.x - (box?.x ?? 0)) * ratio,
          2
        );
        assert.closeTo(
          at.y - (grown?.y ?? 0),
          (at.y - (box?.y ?? 0)) * ratio,
          2
        );
      })
    )
  );

  it.live(
    "stops zooming at its limits",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* builtPage;
          const fitted = yield* scaleOf(page);

          /** Turns the wheel until the scale stops changing, and returns it. */
          const wheelToLimit = Effect.fnUntraced(function* (deltaY: number) {
            let previous = yield* scaleOf(page);

            for (let turn = 0; turn < 10; turn += 1) {
              const moved = yield* cameraOf(page);

              yield* wheelAtCentre(page, deltaY);

              // Each turn either moves the view or, at the limit, does not.
              yield* cameraChangedWithin(page, moved, 1000);

              const now = yield* scaleOf(page);

              if (now === previous) {
                return now;
              }

              previous = now;
            }

            return assert.fail(`the zoom never stopped at ${previous}`);
          });

          // Each step zooms by e^3, about 20 times, so a few reach either limit.
          const most = yield* wheelToLimit(-2000);
          const least = yield* wheelToLimit(2000);

          assert.isAbove(most, fitted * 2);
          assert.isBelow(most, fitted * 10);
          assert.isBelow(least, fitted);
          assert.isAbove(least, fitted / 10);
        })
      ),
    // Wheel turns through Playwright are slow on some machines.
    30_000
  );

  it.live("pans when dragged on empty space", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;
        const svg = yield* canvasOf(page);
        const before = yield* drawingOf(page);
        const camera = yield* cameraOf(page);

        // The top-right corner of the canvas is empty in the fixture.
        yield* Effect.promise(() =>
          page.mouse.move(svg.x + svg.width - 10, svg.y + 10)
        );
        yield* Effect.promise(() => page.mouse.down());
        yield* Effect.promise(() =>
          page.mouse.move(svg.x + svg.width - 110, svg.y + 60, { steps: 5 })
        );
        yield* Effect.promise(() => page.mouse.up());
        yield* waitForCameraChange(page, camera);

        const after = yield* drawingOf(page);

        assert.closeTo(after.left - before.left, -100, 1);
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

        const drawingAfterDrag = yield* drawingOf(page);
        assert.deepStrictEqual(drawingAfterDrag, before);
        const clicked = yield* clickedOf(page);
        assert.deepStrictEqual(clicked, ["box"]);
      })
    )
  );

  it.live("lets the next click land after a touch pan", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;
        const svg = yield* canvasOf(page);
        const before = yield* drawingOf(page);
        const camera = yield* cameraOf(page);

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
              touchPoints:
                type === "touchEnd" ? [] : [{ x: svg.x + x, y: svg.y + y }],
              type,
            })
          );

        yield* Effect.promise(() =>
          cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true })
        );
        const right = svg.width - 10;

        yield* touch("touchStart", right, 10);

        for (let step = 1; step <= 5; step += 1) {
          yield* touch("touchMove", right - step * 20, 10 + step * 10);
        }

        yield* touch("touchEnd", right - 100, 60);
        yield* waitForCameraChange(page, camera);

        const after = yield* drawingOf(page);
        const [box] = yield* boxesOf(page, '[data-structure="box"]');

        assert.isDefined(box);

        if (box === undefined) {
          return;
        }

        yield* Effect.promise(() =>
          page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
        );

        assert.closeTo(after.left - before.left, -100, 1);
        const clicked = yield* clickedOf(page);
        assert.deepStrictEqual(clicked, ["box"]);
      })
    )
  );

  it.live("lets a click on a structure land after a mouse pan", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;
        const svg = yield* canvasOf(page);
        const camera = yield* cameraOf(page);

        yield* recordClicks(page);
        yield* Effect.promise(() =>
          page.mouse.move(svg.x + svg.width - 10, svg.y + 10)
        );
        yield* Effect.promise(() => page.mouse.down());
        yield* Effect.promise(() =>
          page.mouse.move(svg.x + svg.width - 110, svg.y + 60, { steps: 5 })
        );
        yield* Effect.promise(() => page.mouse.up());
        yield* waitForCameraChange(page, camera);

        const [box] = yield* boxesOf(page, '[data-structure="box"]');

        assert.isDefined(box);

        if (box === undefined) {
          return;
        }

        yield* Effect.promise(() =>
          page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
        );

        const clicked = yield* clickedOf(page);
        // The drag's own click is swallowed; the real one lands.
        assert.deepStrictEqual(clicked, ["box"]);
      })
    )
  );

  it.live("fits everything back in the window with Zoom to fit", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;
        const fitted = yield* scaleOf(page);

        yield* wheelAtCentre(page, -600);
        yield* waitForScale(page, `> ${fitted * 1.3}`);
        yield* Effect.promise(() =>
          page.getByRole("button", { name: "Zoom to fit" }).click()
        );
        yield* waitForScale(page, `=== ${fitted}`);

        const scaleNow = yield* scaleOf(page);
        assert.closeTo(scaleNow, fitted, 1e-6);
        yield* assertFitted(page);
      })
    )
  );

  // Growing the window: at 1024×640 the shapes map already fits at the
  // smallest zoom its name tags allow, so a smaller window keeps it.
  it.live("fits again when the window is resized", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;
        const before = yield* scaleOf(page);

        yield* Effect.promise(() =>
          page.setViewportSize({ height: 1000, width: 1600 })
        );
        yield* Effect.promise(() =>
          page.waitForFunction(`${scaleExpression} > ${before * 1.2}`)
        );

        const { drawing, svg } = yield* assertFitted(page);

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

const views = ["iso", "plan"] as const;

interface Box {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

const zoomedIn = Effect.fnUntraced(function* (
  page: Page,
  view: (typeof views)[number]
) {
  yield* showView(page, view);
  yield* press(page, "0");

  const fitted = yield* scaleOf(page);

  for (let step = 0; step < 6; step += 1) {
    yield* press(page, "+");
  }

  yield* waitForScale(page, `> ${fitted * 3}`);
});

const offScreenStructure = Effect.fnUntraced(function* (page: Page) {
  const svg = yield* canvasOf(page);
  const ids = yield* inPage<ReadonlyArray<string>>(
    page,
    '[...document.querySelectorAll("[data-structure]")].map((el) => el.dataset.structure)'
  );

  for (const id of ids) {
    const [box] = yield* boxesOf(page, `[data-structure="${id}"]`);

    if (box !== undefined && !overlaps(box, svg)) {
      return id;
    }
  }

  return assert.fail("every structure is still on screen");
});

/**
 * Waits until the element matching `selector` is at least partly inside the
 * canvas. The canvas is measured on each check: between a scroll and the pan
 * it turns into, the svg sits where the pane scrolled it.
 */
const waitForOnScreen = (page: Page, selector: string) =>
  Effect.promise(() =>
    page.waitForFunction(
      `(() => {
        const box = document.querySelector(${literal(selector)}).getBoundingClientRect();
        const canvas = document.querySelector("svg[data-scale]").getBoundingClientRect();

        return box.left < canvas.right && box.right > canvas.left &&
          box.top < canvas.bottom && box.bottom > canvas.top;
      })()`,
      undefined,
      { timeout: 5000 }
    )
  );

const offScreenPlan = `(() => {
  const canvas = document.querySelector("svg[data-scale]").getBoundingClientRect();
  const centre = (box) => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
  const boxes = [...document.querySelectorAll("[data-structure]")].map((el) => ({ box: el.getBoundingClientRect(), id: el.dataset.structure }));
  const on = ({ box }) => box.left < canvas.right && box.right > canvas.left && box.top < canvas.bottom && box.bottom > canvas.top;
  const start = boxes.find(on);
  const off = boxes.filter((item) => !on(item));
  if (!start || off.length === 0) return { key: "ArrowRight", offScreen: [], start: null };
  const from = centre(start.box);
  const to = centre(off[0].box);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const key = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "ArrowRight" : "ArrowLeft") : (dy > 0 ? "ArrowDown" : "ArrowUp");
  return { key, offScreen: off.map(({ id }) => id), start: start.id };
})()`;

describe.each(views)("the viewport in %s", (view) => {
  it.live("pans to a structure whose name the browser scrolls into view", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;

        yield* zoomedIn(page, view);

        const id = yield* offScreenStructure(page);

        const name = `[data-name-tag="${id}"] text`;

        yield* inPage<null>(
          page,
          `document.querySelector(${literal(name)}).scrollIntoView() ?? null`
        );
        yield* waitForOnScreen(page, name);
      })
    )
  );

  it.live("brings a focused structure on screen", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;

        yield* zoomedIn(page, view);

        const id = yield* offScreenStructure(page);

        yield* Effect.promise(() =>
          page.locator(`[data-structure="${id}"]`).focus()
        );
        yield* waitForOnScreen(page, `[data-structure="${id}"]`);
      })
    )
  );

  it.live("brings a structure the arrow keys reach on screen", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;

        yield* zoomedIn(page, view);

        const plan = yield* inPage<{
          readonly key: string;
          readonly offScreen: ReadonlyArray<string>;
          readonly start: string | null;
        }>(page, offScreenPlan);

        assert.isNotNull(plan.start, "no structure on screen to start from");

        yield* Effect.promise(() =>
          page.locator(`[data-structure="${plan.start ?? ""}"]`).focus()
        );

        const offScreen = new Set(plan.offScreen);
        let reached: string | null = null;

        for (let step = 0; step < 8 && reached === null; step += 1) {
          yield* press(page, plan.key);

          const focused = yield* inPage<string | null>(
            page,
            "document.activeElement?.getAttribute('data-structure') ?? null"
          );

          reached = focused !== null && offScreen.has(focused) ? focused : null;
        }

        assert.isNotNull(
          reached,
          `${plan.key} never reached an off-screen structure`
        );
        yield* waitForOnScreen(page, `[data-structure="${reached ?? ""}"]`);
      })
    )
  );

  it.live(
    "moves focus with each arrow to an item that lies that way on screen",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* builtPage;

          yield* showView(page, view);
          yield* press(page, "0");

          const centreOfFocus = inPage<{ x: number; y: number } | null>(
            page,
            `(() => {
              const el = document.activeElement?.closest('[data-slot="canvas-items-item"]');
              if (!el) return null;
              const box = el.getBoundingClientRect();
              return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
            })()`
          );

          const [first] = yield* inPage<ReadonlyArray<string>>(
            page,
            '[...document.querySelectorAll("[data-structure]")].map((el) => el.dataset.structure)'
          );

          yield* Effect.promise(() =>
            page.locator(`[data-structure="${first ?? ""}"]`).focus()
          );

          const directions = {
            ArrowDown: [0, 1],
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1],
          } as const;

          let moves = 0;

          for (const key of [
            "ArrowRight",
            "ArrowDown",
            "ArrowLeft",
            "ArrowUp",
            "ArrowRight",
            "ArrowDown",
          ] as const) {
            const before = yield* centreOfFocus;

            yield* press(page, key);

            const after = yield* centreOfFocus;

            assert.isNotNull(after, `${key} took focus off the map`);

            if (before !== null && after !== null) {
              const [dx, dy] = directions[key];
              const ahead =
                (after.x - before.x) * dx + (after.y - before.y) * dy;

              if (after.x !== before.x || after.y !== before.y) {
                moves += 1;
                assert.isAbove(ahead, 0, `${key} moved focus the other way`);
              }
            }
          }

          assert.isAtLeast(moves, 3, "the arrows hardly moved focus");
        })
      )
  );

  it.live("keeps a pinned structure when a pan over empty space ends", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;

        yield* showView(page, view);
        yield* Effect.promise(() =>
          page.locator('[data-structure="box"]').click()
        );
        yield* waitFor(page, '[data-structure-panel="box"][data-pinned]');

        const svg = yield* canvasOf(page);
        const camera = yield* cameraOf(page);

        yield* Effect.promise(() =>
          page.mouse.move(svg.x + svg.width - 10, svg.y + 10)
        );
        yield* Effect.promise(() => page.mouse.down());
        yield* Effect.promise(() =>
          page.mouse.move(svg.x + svg.width - 70, svg.y + 40, { steps: 5 })
        );
        yield* Effect.promise(() => page.mouse.up());
        yield* waitForCameraChange(page, camera);

        const pinned = yield* inPage<number>(
          page,
          "document.querySelectorAll('[data-structure-panel=\"box\"][data-pinned]').length"
        );

        assert.strictEqual(pinned, 1);
      })
    )
  );

  it.live("zooms around the pointer with Ctrl and the wheel", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;

        yield* showView(page, view);

        const before = yield* cameraOf(page);
        const svg = yield* canvasOf(page);
        const at = {
          x: svg.x + svg.width * 0.25,
          y: svg.y + svg.height * 0.25,
        };

        yield* Effect.promise(() => page.mouse.move(at.x, at.y));
        yield* Effect.promise(() => page.keyboard.down("Control"));
        yield* Effect.promise(() => page.mouse.wheel(0, -200));
        yield* Effect.promise(() => page.keyboard.up("Control"));
        yield* waitForScale(page, `> ${before[0] * 1.1}`);

        const [scale, x, y] = yield* cameraOf(page);
        const ratio = scale / before[0];

        assert.closeTo(at.x - x, (at.x - before[1]) * ratio, 1);
        assert.closeTo(at.y - y, (at.y - before[2]) * ratio, 1);
      })
    )
  );

  it.live("zooms with + and says so", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;

        yield* showView(page, view);

        const before = yield* scaleOf(page);

        yield* press(page, "+");
        yield* waitForScale(page, `> ${before * 1.2}`);

        const after = yield* scaleOf(page);

        assert.closeTo(after / before, 1.25, 0.001);
        yield* Effect.promise(() =>
          page.waitForFunction(
            `/^Zoom \\d+%$/.test(document.querySelector('[data-ui-sdk-announcer=""]')?.textContent ?? "")`,
            undefined,
            { timeout: 5000 }
          )
        );
      })
    )
  );
});

describe("the viewport's touch and controls", () => {
  it.live("pinches to zoom even when a finger starts on a structure", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;
        const [box] = yield* boxesOf(page, "[data-structure]");

        assert.isDefined(box);

        const x = (box?.x ?? 0) + (box?.width ?? 0) / 2;
        const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;
        const before = yield* scaleOf(page);
        const session = yield* Effect.promise(() =>
          page.context().newCDPSession(page)
        );

        yield* Effect.promise(() =>
          session.send("Emulation.setTouchEmulationEnabled", { enabled: true })
        );

        const fingers = (spread: number) => [
          { id: 1, x: x - spread, y },
          { id: 2, x: x + spread, y },
        ];
        const send = (
          type: "touchEnd" | "touchMove" | "touchStart",
          touchPoints: ReadonlyArray<{ id: number; x: number; y: number }>
        ) =>
          Effect.promise(() =>
            session.send("Input.dispatchTouchEvent", {
              touchPoints: [...touchPoints],
              type,
            })
          );

        yield* send("touchStart", fingers(5));

        for (let step = 1; step <= 8; step += 1) {
          yield* send("touchMove", fingers(5 + step * 10));
        }

        yield* send("touchEnd", []);
        yield* waitForScale(page, `> ${before}`);
      })
    )
  );

  it.live("a wheel over the zoom buttons leaves the map alone", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;
        const before = yield* cameraOf(page);
        const button = page.getByRole("button", { name: "Zoom in" });
        const at = yield* Effect.promise(() => button.boundingBox());

        assert.isNotNull(at);

        yield* Effect.promise(() =>
          page.mouse.move(
            (at?.x ?? 0) + (at?.width ?? 0) / 2,
            (at?.y ?? 0) + (at?.height ?? 0) / 2
          )
        );
        yield* Effect.promise(() => page.mouse.wheel(0, -600));
        yield* Effect.promise(() => page.waitForTimeout(300));

        const after = yield* cameraOf(page);

        assert.deepStrictEqual(after, before);
      })
    )
  );
});
