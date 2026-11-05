import { NoteAdd, ReviewReport } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  FileSystem,
  Option,
  Path,
  pipe,
  Schema,
  String as Str,
} from "effect";
import type { Page } from "playwright";

import {
  attributeOf,
  centreOf,
  click,
  count,
  goToChapterPaused,
  inPage,
  literal,
  pointOnHop,
  showViewFitted,
  waitFor,
  waitTimeout,
} from "./browser.ts";
import {
  crosses,
  drawingReport,
  nameTagClashes,
  overlap,
} from "./drawing-report.ts";
import type { Drawn, DrawingReport } from "./drawing-report.ts";
import { openReviewMap, proposalsOrEmpty, runCli } from "./harness.ts";
import { post } from "./revisions.ts";

// Seam 2: hop and flow proposals in a page that a real serve serves. The
// review map's chapters reveal engineer and page, then server and proposals,
// then the rest. Its hops are h-note, h-save, h-store and h-pr, and its one
// flow is f-note.

const decodeReview = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ReviewReport)
);

const served = openReviewMap({});

/** Waits for an element to be in the page. A line along one axis has no box to be "visible". */
const waitAttached = (page: Page, selector: string) =>
  Effect.promise(() =>
    page
      .locator(selector)
      .first()
      .waitFor({ ...waitTimeout, state: "attached" })
  );

/**
 * Waits until proposals.json holds a flow proposal for f-note whose hops
 * pass `wanted`, and returns them. Fails the test after 15 s.
 */
const waitForFlowProposal = Effect.fnUntraced(function* (
  home: string,
  wanted: (hops: readonly string[]) => boolean
) {
  for (let tries = 0; tries < 150; tries += 1) {
    const found = Arr.findFirst(
      (yield* proposalsOrEmpty(home)).flows ?? [],
      ({ change }) =>
        change.action === "hops" &&
        change.flow === "f-note" &&
        wanted(change.hops)
    );

    if (Option.isSome(found) && found.value.change.action === "hops") {
      return found.value.change.hops;
    }

    yield* Effect.sleep("100 millis");
  }

  return assert.fail("proposals.json never held the flow change");
});

/** Opens the Flows tab. */
const openFlows = Effect.fnUntraced(function* (page: Page) {
  yield* click(page, '[data-tab="flows"]');
  yield* waitFor(page, "[data-flows-tab]");
});

/** Waits until flow `flow` lists exactly `hops`, in that order. */
const waitForFlowHops = (page: Page, flow: string, hops: readonly string[]) =>
  Effect.promise(() =>
    page.waitForFunction(
      `[...document.querySelectorAll(${literal(`[data-sortable="hops:${flow}"] [data-sort-content]`)})].map((e) => e.getAttribute("data-sort-content")).join(",") === ${literal(Arr.join(hops, ","))}`,
      undefined,
      waitTimeout
    )
  );

/** Selects a structure by clicking it, which gives it the edge handles. */
const select = Effect.fnUntraced(function* (page: Page, id: string) {
  yield* click(page, `[data-structure="${id}"]`);
  yield* waitFor(page, `[data-edge-owner="${id}"]`);
});

/** Presses on one of a structure's edge handles and drags to `to`, stopping short of the drop. */
const dragFromHandle = Effect.fnUntraced(function* (
  page: Page,
  drag: {
    readonly from: string;
    readonly to: { readonly x: number; readonly y: number };
    readonly drop: boolean;
  }
) {
  const { from, to, drop } = drag;

  yield* select(page, from);

  const handle = yield* centreOf(page, `[data-edge-owner="${from}"]`);

  yield* Effect.promise(() => page.mouse.move(handle.x, handle.y));
  yield* Effect.promise(() => page.mouse.down());
  yield* Effect.promise(() => page.mouse.move(to.x, to.y, { steps: 8 }));

  if (drop) {
    yield* Effect.promise(() => page.mouse.up());
  }
});

/** Every name tag drawn now over other text or a box other than its own. */
const clashes = (page: Page) =>
  inPage<DrawingReport>(page, drawingReport).pipe(Effect.map(nameTagClashes));

/**
 * What the label `label` is drawn over: a box or other text. A label the
 * scene placed nowhere is reported too, so the check can't pass empty.
 */
const labelClashes = (
  report: DrawingReport,
  label: string
): readonly string[] => {
  const own = Arr.filter(report.text, ({ id }) => id === label);

  if (own.length === 0) {
    return [`${label} is not drawn`];
  }

  return Arr.flatMap(own, (drawn) =>
    Arr.flatMap(
      [
        ...report.structures,
        ...report.chips,
        ...Arr.filter(report.text, ({ id }) => id !== label),
      ],
      (other: Drawn) =>
        overlap(drawn.polygon, other.polygon) ? [`${label} × ${other.id}`] : []
    )
  );
};

/** The fewest screen pixels an editing mark keeps from text: `minScreenGap`. */
const clearance = 3;

/** A polygon's box, grown by `by` on every side. */
const grown = (polygon: Drawn["polygon"], by: number): Drawn["polygon"] => {
  const xs = Arr.map(polygon, ({ x }) => x);
  const ys = Arr.map(polygon, ({ y }) => y);
  const [left, right] = [Math.min(...xs) - by, Math.max(...xs) + by];
  const [top, bottom] = [Math.min(...ys) - by, Math.max(...ys) + by];

  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
};

/** The text every mark must keep clear of: tags, hop labels and chips, not zone titles. */
const textOf = (report: DrawingReport): readonly Drawn[] => [
  ...Arr.filter(report.text, ({ id }) => !Str.startsWith("title:")(id)),
  ...report.chips,
];

/** The handles that come within `clearance` screen pixels of text. */
const handlesNearText = (report: DrawingReport): readonly string[] =>
  Arr.flatMap(report.handles, (handle) =>
    Arr.flatMap(textOf(report), (other: Drawn) =>
      overlap(grown(handle.polygon, clearance), other.polygon)
        ? [`${handle.id} × ${other.id}`]
        : []
    )
  );

/** The legs of the line being drawn that run through text. */
const previewsOverText = (report: DrawingReport): readonly string[] =>
  Arr.flatMap(report.previews, ({ id, segment }) =>
    Arr.flatMap(textOf(report), (other: Drawn) =>
      crosses(segment, other.polygon) ? [`${id} × ${other.id}`] : []
    )
  );

/**
 * The ends of the line's pieces that lie off the line through the first
 * piece, by more than a pixel: none when the line is straight.
 */
const bends = (previews: DrawingReport["previews"]): readonly string[] => {
  const [a, b] = previews[0]?.segment ?? [];

  if (a === undefined || b === undefined) {
    return ["no line"];
  }

  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;

  return Arr.flatMap(previews, ({ id, segment }) =>
    Arr.flatMap(segment, (point) => {
      const off =
        Math.abs(
          (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)
        ) / length;

      return off > 1
        ? [`${id} at ${point.x}, ${point.y} is ${off} px off`]
        : [];
    })
  );
};

/** The pieces of a hop's strike that run through a structure's box. */
const strikesOverBoxes = (report: DrawingReport): readonly string[] =>
  Arr.flatMap(report.hopStrikes, ({ id, segment }) =>
    Arr.flatMap(report.structures, (box: Drawn) =>
      crosses(segment, box.polygon) ? [`${id} × ${box.id}`] : []
    )
  );

/** The pieces of a hop's strike that run over text. */
const strikesOverText = (report: DrawingReport): readonly string[] =>
  Arr.flatMap(report.hopStrikes, ({ id, segment }) =>
    Arr.flatMap(report.text, (other: Drawn) =>
      crosses(segment, other.polygon) ? [`${id} × ${other.id}`] : []
    )
  );

/**
 * The point on hop `id` once it has stopped moving: the view refits after a
 * proposal changes the map, so a point is only used when two reads 150 ms
 * apart agree.
 */
const settledPointOnHop = Effect.fnUntraced(function* (page: Page, id: string) {
  let last = yield* pointOnHop(page, id);

  for (let tries = 0; tries < 40; tries += 1) {
    yield* Effect.sleep("150 millis");

    const next = yield* pointOnHop(page, id);

    if (
      last !== null &&
      next !== null &&
      Math.abs(last.x - next.x) < 0.5 &&
      Math.abs(last.y - next.y) < 0.5
    ) {
      return next;
    }

    last = next;
  }

  return yield* Effect.die(new Error(`hop ${id} never held still`));
});

/** Presses a point on hop `id`, which pins it and opens its panel. */
const selectHop = Effect.fnUntraced(function* (page: Page, id: string) {
  const at = yield* settledPointOnHop(page, id);

  yield* Effect.promise(() => page.mouse.click(at.x, at.y));
  yield* waitFor(page, `[data-hop-panel="${id}"]`);
});

/** Draws engineer → server by dragging from the engineer's handle onto the server. */
const drawHop = Effect.fnUntraced(function* (page: Page, label: string) {
  const target = yield* centreOf(page, '[data-structure="server"]');

  yield* dragFromHandle(page, { from: "engineer", to: target, drop: true });
  yield* waitFor(page, "[data-draw-hop]");
  yield* Effect.promise(() => page.locator('[data-draw="label"]').fill(label));
  yield* click(page, '[data-draw="submit"]');
  yield* Effect.promise(() =>
    page.waitForFunction(
      `document.querySelector('[data-hop-state="proposed"]') !== null`,
      undefined,
      waitTimeout
    )
  );
});

describe.each(["iso", "plan"] as const)(
  "drawing a hop by dragging an edge handle in the %s view",
  (which) => {
    it.live(
      "draws a dashed preview mid-drag, then opens the label field on a drop on a structure",
      () =>
        Effect.gen(function* () {
          const { page, home } = yield* served;

          yield* goToChapterPaused(page, "c-all");
          yield* showViewFitted(page, which);

          const target = yield* centreOf(page, '[data-structure="server"]');

          yield* dragFromHandle(page, {
            from: "engineer",
            to: target,
            drop: false,
          });
          yield* waitAttached(page, "[data-hop-preview]");

          const dash = yield* Effect.promise(() =>
            page.evaluate<string>(
              `getComputedStyle(document.querySelector("[data-hop-preview]")).strokeDasharray`
            )
          );

          assert.notStrictEqual(dash, "none", "the preview is dashed");
          assert.strictEqual(
            yield* attributeOf(page, "[data-hop-preview]", "data-over"),
            "server"
          );

          // Once a target is under the pointer the line is routed like the hop.
          assert.strictEqual(
            yield* attributeOf(page, "[data-hop-preview]", "data-routed"),
            "true"
          );

          yield* Effect.promise(() => page.mouse.up());
          yield* waitFor(page, "[data-draw-hop]");

          assert.strictEqual(
            yield* Effect.promise(() =>
              page.locator("[data-draw-to]").textContent()
            ),
            "Save server"
          );
          // The form is in the side panel, never over the drawing.
          assert.strictEqual(
            yield* count(page, "[data-side-panel] [data-draw-hop]"),
            1
          );
          // Nothing is saved until a label is sent.
          assert.deepStrictEqual(
            (yield* proposalsOrEmpty(home)).hops ?? [],
            []
          );
        }),
      60_000
    );

    it.live(
      "creates the proposal with its label and draws the hop pending",
      () =>
        Effect.gen(function* () {
          const { page, home, errors } = yield* served;

          yield* goToChapterPaused(page, "c-all");
          yield* showViewFitted(page, which);
          yield* drawHop(page, "asks for a map");

          const [saved] = (yield* proposalsOrEmpty(home)).hops ?? [];

          assert.strictEqual(saved?.change.action, "add");
          assert.deepStrictEqual(
            saved?.change.action === "add"
              ? { ...saved.change.hop, id: "" }
              : undefined,
            { id: "", from: "engineer", to: "server", label: "asks for a map" }
          );

          const proposed = page.locator(
            '[data-hop][data-hop-state="proposed"]'
          );

          assert.strictEqual(yield* Effect.promise(() => proposed.count()), 1);
          assert.deepStrictEqual(errors, []);
        }),
      60_000
    );

    it.live(
      "draws a proposed hop pending, and its label clears every box and text",
      () =>
        Effect.gen(function* () {
          const { page } = yield* served;

          yield* goToChapterPaused(page, "c-all");
          yield* showViewFitted(page, which);
          yield* drawHop(page, "asks");

          // Move off the structure so its handles do not count.
          yield* Effect.promise(() => page.keyboard.press("Escape"));
          yield* showViewFitted(page, which);

          assert.deepStrictEqual(yield* clashes(page), []);

          const hop = yield* attributeOf(
            page,
            '[data-hop][data-hop-state="proposed"]',
            "data-hop"
          );

          assert.deepStrictEqual(
            labelClashes(
              yield* Effect.promise(() =>
                page.evaluate<DrawingReport>(drawingReport)
              ),
              `label:${hop}`
            ),
            []
          );

          const stroke = yield* Effect.promise(() =>
            page.evaluate<string>(
              `getComputedStyle(document.querySelector('[data-hop][data-hop-state="proposed"]')).stroke`
            )
          );

          const ink = yield* Effect.promise(() =>
            page.evaluate<string>(
              `getComputedStyle(document.querySelector('[data-hop]:not([data-hop-state])')).stroke`
            )
          );

          assert.notStrictEqual(stroke, ink);
        }),
      60_000
    );
  }
);

describe("ending a drag without a target", () => {
  it.live(
    "creates nothing when the drop is on empty space, or when Escape ends the drag",
    () =>
      Effect.gen(function* () {
        const { page, home } = yield* served;

        yield* goToChapterPaused(page, "c-all");

        const surface = yield* Effect.promise(() =>
          page
            .locator("[data-map-surface] svg[data-scale]")
            .first()
            .boundingBox()
        );

        // Empty ground at the right edge of the fitted map.
        yield* dragFromHandle(page, {
          from: "engineer",
          to: {
            x: (surface?.x ?? 0) + (surface?.width ?? 0) * 0.92,
            y: (surface?.y ?? 0) + (surface?.height ?? 0) * 0.9,
          },
          drop: true,
        });
        yield* Effect.sleep("400 millis");

        assert.strictEqual(yield* count(page, "[data-draw-hop]"), 0, "drop");
        assert.strictEqual(yield* count(page, "[data-hop-preview]"), 0, "drop");
        assert.deepStrictEqual((yield* proposalsOrEmpty(home)).hops ?? [], []);

        const target = yield* centreOf(page, '[data-structure="server"]');

        yield* dragFromHandle(page, {
          from: "engineer",
          to: target,
          drop: false,
        });
        yield* waitAttached(page, "[data-hop-preview]");
        yield* Effect.promise(() => page.keyboard.press("Escape"));
        yield* Effect.promise(() => page.mouse.up());
        yield* Effect.sleep("400 millis");

        assert.strictEqual(
          yield* count(page, "[data-hop-preview]"),
          0,
          "Escape"
        );
        assert.strictEqual(yield* count(page, "[data-draw-hop]"), 0, "Escape");
        assert.deepStrictEqual((yield* proposalsOrEmpty(home)).hops ?? [], []);
      }),
    60_000
  );
});

describe.each(["iso", "plan"] as const)("mid-drag in the %s view", (which) => {
  it.live(
    "no handle comes within 3 screen px of text, and no leg of the line runs through text",
    () =>
      Effect.gen(function* () {
        const { page } = yield* served;

        yield* goToChapterPaused(page, "c-all");
        yield* showViewFitted(page, which);

        // Over each structure in turn, so the line is routed to each.
        for (const over of ["server", "proposals", "pull-request", "page"]) {
          const target = yield* centreOf(page, `[data-structure="${over}"]`);

          yield* dragFromHandle(page, {
            from: "engineer",
            to: target,
            drop: false,
          });
          yield* waitAttached(page, "[data-hop-preview]");
          // Let the camera settle, so the report is read at rest.
          yield* Effect.sleep("200 millis");

          const report = yield* Effect.promise(() =>
            page.evaluate<DrawingReport>(drawingReport)
          );

          assert.isAbove(report.handles.length, 0, over);
          assert.deepStrictEqual(handlesNearText(report), [], `to ${over}`);
          assert.isAbove(report.previews.length, 0, over);
          assert.deepStrictEqual(previewsOverText(report), [], `to ${over}`);

          yield* Effect.promise(() => page.keyboard.press("Escape"));
          yield* Effect.promise(() => page.mouse.up());
        }
      }),
    90_000
  );

  it.live(
    "is straight over empty space",
    () =>
      Effect.gen(function* () {
        const { page } = yield* served;

        yield* goToChapterPaused(page, "c-all");
        yield* showViewFitted(page, which);

        const surface = yield* Effect.promise(() =>
          page
            .locator("[data-map-surface] svg[data-scale]")
            .first()
            .boundingBox()
        );

        yield* dragFromHandle(page, {
          from: "engineer",
          to: {
            x: (surface?.x ?? 0) + (surface?.width ?? 0) * 0.92,
            y: (surface?.y ?? 0) + (surface?.height ?? 0) * 0.9,
          },
          drop: false,
        });
        yield* waitAttached(page, "[data-hop-preview]");

        yield* Effect.sleep("200 millis");

        // The line may be cut where it passes text, but every piece lies on
        // the one straight line from the handle to the pointer.
        const { previews } = yield* Effect.promise(() =>
          page.evaluate<DrawingReport>(drawingReport)
        );

        assert.isAbove(previews.length, 0);
        assert.deepStrictEqual(bends(previews), []);
      }),
    60_000
  );

  it.live(
    "lights the drop target while it is targeted, and fades it again after",
    () =>
      Effect.gen(function* () {
        const { page } = yield* served;

        // The "A note" flow plays the first three hops, so Pull request is
        // faded until the drag is over it.
        yield* goToChapterPaused(page, "c-all");
        yield* click(page, '[data-flow="f-note"]');

        const faded = (id: string) =>
          attributeOf(page, `[data-structure="${id}"]`, "data-faded");

        assert.strictEqual(yield* faded("pull-request"), "true");

        const target = yield* centreOf(page, '[data-structure="pull-request"]');

        yield* dragFromHandle(page, {
          from: "engineer",
          to: target,
          drop: false,
        });
        yield* waitAttached(page, "[data-hop-preview]");
        yield* Effect.sleep("200 millis");

        assert.strictEqual(yield* faded("pull-request"), "false");
        assert.strictEqual(yield* faded("engineer"), "false");
        // Only the two ends are lit while a hop is drawn.
        assert.strictEqual(yield* faded("upstream"), "true");

        yield* Effect.promise(() => page.keyboard.press("Escape"));
        yield* Effect.promise(() => page.mouse.up());
        // Off every structure, so only the chapter's spotlight is left.
        yield* Effect.promise(() => page.mouse.move(700, 120));
        yield* Effect.sleep("300 millis");

        assert.strictEqual(yield* faded("pull-request"), "true");
      }),
    60_000
  );
});

describe("the keyboard path to drawing a hop", () => {
  it.live(
    "starts from the structure's panel, picks the target from a list and proposes",
    () =>
      Effect.gen(function* () {
        const { page, home } = yield* served;

        yield* goToChapterPaused(page, "c-all");
        yield* select(page, "engineer");
        yield* click(page, '[data-change="draw-hop"]');
        yield* waitFor(page, "[data-draw-hop]");

        assert.isTrue(
          yield* Effect.promise(() =>
            page.locator('[data-draw="submit"]').isDisabled()
          )
        );

        yield* Effect.promise(() =>
          page.locator('[data-draw="to"]').selectOption("proposals")
        );
        yield* Effect.promise(() =>
          page.locator('[data-draw="label"]').fill("looks at")
        );
        yield* Effect.promise(() => page.keyboard.press("Enter"));
        yield* Effect.promise(() =>
          page.waitForFunction(
            `document.querySelector('[data-hop-state="proposed"]') !== null`,
            undefined,
            waitTimeout
          )
        );

        const [saved] = (yield* proposalsOrEmpty(home)).hops ?? [];

        assert.deepStrictEqual(
          saved?.change.action === "add"
            ? { ...saved.change.hop, id: "" }
            : undefined,
          { id: "", from: "engineer", to: "proposals", label: "looks at" }
        );
      }),
    60_000
  );

  it.live(
    "starts from the structure's context menu, and Escape cancels",
    () =>
      Effect.gen(function* () {
        const { page, home } = yield* served;

        yield* goToChapterPaused(page, "c-all");
        yield* Effect.promise(() =>
          page.locator('[data-structure="engineer"]').click({ button: "right" })
        );
        yield* click(page, '[data-menu="draw-hop"]');
        yield* waitFor(page, "[data-draw-hop]");
        yield* Effect.promise(() =>
          page.locator('[data-draw="label"]').focus()
        );
        yield* Effect.promise(() => page.keyboard.press("Escape"));
        yield* Effect.sleep("300 millis");

        assert.strictEqual(yield* count(page, "[data-draw-hop]"), 0);
        assert.deepStrictEqual((yield* proposalsOrEmpty(home)).hops ?? [], []);
      }),
    60_000
  );
});

describe("the hop panel and menu", () => {
  it.live(
    "relabels a hop from its panel",
    () =>
      Effect.gen(function* () {
        const { page, home } = yield* served;

        yield* goToChapterPaused(page, "c-all");
        yield* selectHop(page, "h-save");
        yield* Effect.promise(() =>
          page.locator("[data-hop-label-field]").fill("saves a note")
        );
        yield* click(page, '[data-hop-relabel="h-save"]');
        yield* Effect.promise(() =>
          page.waitForFunction(
            `document.querySelector('[data-hop="h-save"][data-hop-state="proposed"]') !== null`,
            undefined,
            waitTimeout
          )
        );

        const [saved] = (yield* proposalsOrEmpty(home)).hops ?? [];

        assert.deepStrictEqual(saved?.change, {
          action: "relabel",
          hop: "h-save",
          label: "saves a note",
        });
      }),
    60_000
  );

  it.live(
    "puts a hop in one more flow, and takes it out of another, from its panel",
    () =>
      Effect.gen(function* () {
        const { page, home } = yield* served;

        yield* goToChapterPaused(page, "c-all");
        yield* selectHop(page, "h-pr");

        assert.isFalse(
          yield* Effect.promise(() =>
            page.locator('[data-hop-flow="f-note"]').isChecked()
          )
        );

        yield* Effect.promise(() =>
          page.locator('[data-hop-flow="f-note"]').click()
        );
        yield* Effect.promise(() =>
          page.waitForFunction(
            `document.querySelector('[data-hop-flow="f-note"]').checked === true`,
            undefined,
            waitTimeout
          )
        );

        const [added] = (yield* proposalsOrEmpty(home)).flows ?? [];

        assert.deepStrictEqual(added?.change, {
          action: "hops",
          flow: "f-note",
          hops: ["h-note", "h-save", "h-store", "h-pr"],
        });

        // Take another hop out of the same flow, from its own panel.
        yield* Effect.promise(() => page.keyboard.press("Escape"));
        yield* selectHop(page, "h-save");
        yield* Effect.promise(() =>
          page.locator('[data-hop-flow="f-note"]').click()
        );
        yield* Effect.promise(() =>
          page.waitForFunction(
            `document.querySelector('[data-hop-flow="f-note"]').checked === false`,
            undefined,
            waitTimeout
          )
        );

        const flows = yield* waitForFlowProposal(
          home,
          (hops) => !hops.includes("h-save")
        );

        assert.deepStrictEqual(flows, ["h-note", "h-store", "h-pr"]);
      }),
    60_000
  );

  it.live(
    "deletes a hop from its panel: dashed, with a strike that holds no text",
    () =>
      Effect.gen(function* () {
        const { page, home, errors } = yield* served;

        yield* goToChapterPaused(page, "c-all");
        yield* selectHop(page, "h-pr");
        yield* click(page, '[data-hop-delete="h-pr"]');
        yield* waitFor(page, '[data-removed-hop-mark="h-pr"]');

        const [saved] = (yield* proposalsOrEmpty(home)).hops ?? [];

        assert.deepStrictEqual(saved?.change, {
          action: "delete",
          hop: "h-pr",
        });

        const dash = yield* Effect.promise(() =>
          page.evaluate<string>(
            `getComputedStyle(document.querySelector('[data-hop="h-pr"] polyline:not([stroke="transparent"])')).strokeDasharray`
          )
        );

        assert.notStrictEqual(dash, "none");

        // The strike holds no text of its own.
        assert.strictEqual(
          yield* Effect.promise(() =>
            page.locator('[data-removed-hop-mark="h-pr"]').textContent()
          ),
          ""
        );
        assert.deepStrictEqual(errors, []);
      }),
    60_000
  );

  it.live(
    "opens a context menu on a hop with its flows and a delete",
    () =>
      Effect.gen(function* () {
        const { page, home } = yield* served;

        yield* goToChapterPaused(page, "c-all");
        const at = yield* settledPointOnHop(page, "h-pr");

        yield* Effect.promise(() =>
          page.mouse.click(at.x, at.y, { button: "right" })
        );
        yield* waitFor(page, '[data-hop-menu="h-pr"]');

        assert.strictEqual(yield* count(page, '[data-menu="relabel"]'), 1);
        assert.strictEqual(yield* count(page, '[data-menu="delete-hop"]'), 1);

        yield* click(page, '[data-menu="flows"]');
        yield* click(page, '[data-menu-flow="f-note"]');

        assert.deepStrictEqual(
          yield* waitForFlowProposal(home, (hops) => hops.includes("h-pr")),
          ["h-note", "h-save", "h-store", "h-pr"]
        );
      }),
    60_000
  );
});

describe("the flows editor", () => {
  it.live(
    "reorders the hops in a flow with the move buttons",
    () =>
      Effect.gen(function* () {
        const { page, home } = yield* served;

        yield* goToChapterPaused(page, "c-all");
        yield* openFlows(page);
        yield* click(page, '[data-sort-down="h-note"]');
        yield* waitForFlowHops(page, "f-note", ["h-save", "h-note", "h-store"]);

        const [saved] = (yield* proposalsOrEmpty(home)).flows ?? [];

        assert.deepStrictEqual(saved?.change, {
          action: "hops",
          flow: "f-note",
          hops: ["h-save", "h-note", "h-store"],
        });
      }),
    60_000
  );

  it.live(
    "reorders the hops in a flow from the keyboard with Alt and the arrow keys",
    () =>
      Effect.gen(function* () {
        const { page, home } = yield* served;

        yield* goToChapterPaused(page, "c-all");
        yield* openFlows(page);
        yield* Effect.promise(() =>
          page
            .locator('[data-sortable="hops:f-note"] [data-sort-grip="h-store"]')
            .focus()
        );
        yield* Effect.promise(() => page.keyboard.press("Alt+ArrowUp"));
        yield* waitForFlowHops(page, "f-note", ["h-note", "h-store", "h-save"]);

        const [saved] = (yield* proposalsOrEmpty(home)).flows ?? [];

        assert.deepStrictEqual(
          saved?.change.action === "hops" ? saved.change.hops : [],
          ["h-note", "h-store", "h-save"]
        );
      }),
    60_000
  );

  it.live(
    "reorders the hops in a flow by dragging a grip",
    () =>
      Effect.gen(function* () {
        const { page, home } = yield* served;

        yield* goToChapterPaused(page, "c-all");
        yield* openFlows(page);

        const grip = '[data-sortable="hops:f-note"] [data-sort-grip="h-note"]';
        const last = '[data-sortable="hops:f-note"] [data-sort-row="h-store"]';
        const from = yield* centreOf(page, grip);
        const to = yield* centreOf(page, last);

        yield* Effect.promise(() => page.mouse.move(from.x, from.y));
        yield* Effect.promise(() => page.mouse.down());
        yield* Effect.promise(() =>
          page.mouse.move(to.x, to.y + 12, { steps: 8 })
        );
        yield* Effect.promise(() => page.mouse.up());

        yield* waitForFlowHops(page, "f-note", ["h-save", "h-store", "h-note"]);

        const [saved] = (yield* proposalsOrEmpty(home)).flows ?? [];

        assert.deepStrictEqual(
          saved?.change.action === "hops" ? saved.change.hops : [],
          ["h-save", "h-store", "h-note"]
        );
      }),
    60_000
  );

  it.live(
    "creates a flow, renames it, and the proposal follows both",
    () =>
      Effect.gen(function* () {
        const { page, home } = yield* served;

        yield* goToChapterPaused(page, "c-all");
        yield* openFlows(page);
        yield* Effect.promise(() =>
          page.locator("[data-new-flow-name]").fill("Storage")
        );
        yield* Effect.promise(() =>
          page.locator('[data-new-flow-hop="h-store"]').check()
        );
        yield* Effect.promise(() =>
          page.locator('[data-new-flow-hop="h-pr"]').check()
        );
        yield* click(page, "[data-new-flow-submit]");
        yield* Effect.promise(() =>
          page.waitForFunction(
            `document.querySelectorAll('[data-flow-editor]').length === 2`,
            undefined,
            waitTimeout
          )
        );

        const made = Arr.findFirst(
          (yield* proposalsOrEmpty(home)).flows ?? [],
          ({ change }) => change.action === "add"
        ).pipe(Option.getOrThrow);

        const id = made.change.action === "add" ? made.change.flow.id : "";

        assert.match(id, /^storage-[0-9a-f]{4}$/u);

        yield* Effect.promise(() =>
          page.locator(`[data-flow-name="${id}"]`).fill("Storage trail")
        );
        yield* click(page, `[data-flow-rename="${id}"]`);
        yield* Effect.promise(() =>
          page.waitForFunction(
            `document.querySelector('[data-flow-name="${id}"]').value === 'Storage trail'`,
            undefined,
            waitTimeout
          )
        );
        yield* Effect.sleep("500 millis");

        const flows = (yield* proposalsOrEmpty(home)).flows ?? [];

        // The rename edited the new flow's own proposal.
        assert.strictEqual(flows.length, 1);
        assert.deepStrictEqual(
          flows[0]?.change.action === "add"
            ? [flows[0].change.flow.name, flows[0].change.hops]
            : [],
          ["Storage trail", ["h-store", "h-pr"]]
        );
      }),
    60_000
  );

  it.live(
    "renames a flow that data.mjs has",
    () =>
      Effect.gen(function* () {
        const { page, home } = yield* served;

        yield* goToChapterPaused(page, "c-all");
        yield* openFlows(page);
        yield* Effect.promise(() =>
          page.locator('[data-flow-name="f-note"]').fill("Notes")
        );
        yield* click(page, '[data-flow-rename="f-note"]');
        yield* Effect.sleep("600 millis");

        const [saved] = (yield* proposalsOrEmpty(home)).flows ?? [];

        assert.deepStrictEqual(saved?.change, {
          action: "rename",
          flow: "f-note",
          name: "Notes",
        });
      }),
    60_000
  );
});

/** Proposes a planned store called `name` at `x`, `y`, from the add form. */
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

/** Picks the server and the proposals together and makes a group of them. */
const makeGroup = Effect.fnUntraced(function* (page: Page, title: string) {
  yield* click(page, '[data-structure="server"]');
  yield* Effect.promise(() =>
    page.locator('[data-structure="server"]').click({ modifiers: ["Shift"] })
  );
  yield* Effect.promise(() =>
    page.locator('[data-structure="proposals"]').click({ modifiers: ["Shift"] })
  );
  yield* click(page, '[data-control="add-group"]');
  yield* waitFor(page, "[data-new-group]");
  yield* Effect.promise(() =>
    page.locator("[data-new-group-title]").fill(title)
  );
  yield* click(page, "[data-new-group-submit]");
  yield* waitFor(page, "[data-pending-zone]");
});

/** The body that pins a spot note far off the map, on the file revision `base`. */
const farSpot = (base: number) =>
  Schema.encodeEffect(Schema.fromJsonString(NoteAdd))({
    baseFileRevision: base,
    id: "n-far",
    target: { kind: "spot", x: 60, y: 40 },
    text: "Far away",
  }).pipe(Effect.orDie);

describe("a hop proposal in the Pending tab and in exports", () => {
  it.live(
    "is listed in the Pending tab with a Discard, and discarding removes the hop",
    () =>
      Effect.gen(function* () {
        const { page, home } = yield* served;

        yield* goToChapterPaused(page, "c-all");
        yield* drawHop(page, "asks");
        yield* click(page, '[data-tab="pending"]');
        yield* waitFor(page, '[data-review-section="diagram"]');

        // Listed once, in its section, with the Discard the review list gives.
        assert.strictEqual(
          yield* count(page, '[data-review-item][data-review-kind="hop"]'),
          1
        );

        yield* click(
          page,
          '[data-review-item][data-review-kind="hop"] button:has-text("Discard")'
        );
        yield* Effect.promise(() =>
          page.waitForFunction(
            `document.querySelector('[data-hop-state="proposed"]') === null`,
            undefined,
            waitTimeout
          )
        );

        assert.deepStrictEqual((yield* proposalsOrEmpty(home)).hops ?? [], []);
      }),
    60_000
  );

  it.live(
    "is left out of the exported SVG, with every other kind of proposal, and the SVG equals the CLI's",
    () =>
      Effect.gen(function* () {
        const { home, serve, page } = yield* served;

        // A note far off the map, which a fit to the notes would take in
        // and an export must not.
        const far = yield* post(serve.url, "/api/notes", yield* farSpot(0));

        assert.strictEqual(far.status, 200, far.body);

        yield* goToChapterPaused(page, "c-all");
        yield* waitFor(page, '[data-note-marker^="spot:"]');

        // A hop added and one deleted, with a note on a third.
        yield* drawHop(page, "asks for a map");
        yield* selectHop(page, "h-pr");
        yield* click(page, '[data-hop-delete="h-pr"]');
        yield* waitFor(page, '[data-removed-hop-mark="h-pr"]');
        yield* Effect.promise(() => page.keyboard.press("Escape"));
        yield* selectHop(page, "h-save");
        yield* Effect.promise(() =>
          page
            .locator("[data-hop-panel] [data-note-text]")
            .fill("Why not a socket?")
        );
        yield* click(page, "[data-hop-panel] [data-note-send]");
        yield* waitFor(page, '[data-note-marker="hop:h-save"]');
        yield* Effect.promise(() => page.keyboard.press("Escape"));

        // A note on a structure.
        yield* click(page, '[data-structure="server"]');
        yield* waitFor(page, '[data-structure-panel="server"][data-pinned]');
        yield* Effect.promise(() =>
          page
            .locator(
              "[data-structure-panel] [data-notes-section] [data-note-text]"
            )
            .fill("Why a server?")
        );
        yield* click(
          page,
          "[data-structure-panel] [data-notes-section] [data-note-send]"
        );
        yield* waitFor(page, '[data-note-marker="server"]');
        yield* Effect.promise(() => page.keyboard.press("Escape"));

        // A structure added and one deleted.
        yield* addStructure(page, { name: "Build cache", x: 12, y: 12 });
        yield* waitFor(page, '[data-structure][data-pending="true"]');
        yield* click(page, '[data-structure="upstream"]');
        yield* click(page, '[data-change="delete"]');
        yield* waitFor(page, '[data-removed-mark="upstream"]');
        yield* Effect.promise(() => page.keyboard.press("Escape"));

        // A group made from two structures.
        yield* makeGroup(page, "Data layer");

        // A pinned part puts the spotlight on it, which the CLI has no way to
        // match. Unpin everything so both draw the chapter's spotlight.
        yield* Effect.promise(() =>
          page.evaluate("document.activeElement?.blur()")
        );
        yield* Effect.promise(() => page.keyboard.press("Escape"));
        yield* Effect.promise(() => page.keyboard.press("Escape"));
        yield* Effect.promise(() =>
          page.waitForFunction(
            `document.querySelector('[data-structure][data-selected="true"], [data-hop-selected]') === null`,
            undefined,
            waitTimeout
          )
        );

        for (const which of ["iso", "plan"] as const) {
          yield* showViewFitted(page, which);
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

          for (const proposed of [
            "asks for a map",
            "data-hop-state",
            "hop-strike",
            "data-note-marker",
            "data-spot",
            "BUILD CACHE",
            "Build cache",
            "removed",
            "strike",
            "DATA LAYER",
            "Data layer",
          ]) {
            assert.notInclude(fromPage, proposed, `${which}: ${proposed}`);
          }

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
    120_000
  );
});

describe("a hop proposed for deletion", () => {
  it.live(
    "can't be edited, says it waits on the agent, is left out of the new flow's checklist, and withdraws while the proposal is open",
    () =>
      Effect.gen(function* () {
        const { page, home } = yield* served;

        yield* goToChapterPaused(page, "c-all");
        yield* selectHop(page, "h-save");
        yield* click(page, '[data-hop-delete="h-save"]');
        yield* waitFor(page, '[data-removed-hop-mark="h-save"]');
        yield* waitFor(page, "[data-hop-panel] [data-deleting]");

        // Its flows and label can't change, and the reroute hint is gone.
        assert.isTrue(
          yield* Effect.promise(() =>
            page.locator('[data-hop-flow="f-note"]').isDisabled()
          )
        );
        assert.isTrue(
          yield* Effect.promise(() =>
            page.locator("[data-hop-label-field]").isDisabled()
          )
        );
        assert.notInclude(
          yield* Effect.promise(() =>
            page.locator("[data-hop-panel]").textContent()
          ),
          "Drag a segment"
        );
        assert.strictEqual(yield* count(page, "[data-withdraw-deletion]"), 1);

        // The new flow's checklist leaves it out, and keeps the others.
        yield* openFlows(page);
        assert.strictEqual(
          yield* count(page, '[data-new-flow-hop="h-save"]'),
          0
        );
        assert.strictEqual(
          yield* count(page, '[data-new-flow-hop="h-store"]'),
          1
        );
        yield* click(page, '[data-tab="details"]');
        yield* waitFor(page, "[data-hop-panel] [data-withdraw-deletion]");

        yield* click(page, "[data-withdraw-deletion]");
        yield* Effect.promise(() =>
          page.waitForFunction(
            `document.querySelector('[data-removed-hop-mark]') === null`,
            undefined,
            waitTimeout
          )
        );

        assert.deepStrictEqual((yield* proposalsOrEmpty(home)).hops ?? [], []);
        assert.isFalse(
          yield* Effect.promise(() =>
            page.locator('[data-hop-flow="f-note"]').isDisabled()
          )
        );
      }),
    60_000
  );

  it.live(
    "offers no withdrawal once the deletion is in a batch",
    () =>
      Effect.gen(function* () {
        const { page } = yield* served;

        yield* goToChapterPaused(page, "c-all");
        yield* selectHop(page, "h-save");
        yield* click(page, '[data-hop-delete="h-save"]');
        yield* waitFor(page, '[data-removed-hop-mark="h-save"]');
        yield* click(page, "[data-ready-for-review]");
        yield* waitFor(page, "[data-review-dialog][open]");
        yield* Effect.promise(() => page.keyboard.press("Escape"));
        yield* waitFor(page, "[data-hop-panel] [data-deletion-waiting]");

        assert.strictEqual(yield* count(page, "[data-withdraw-deletion]"), 0);
        assert.strictEqual(yield* count(page, "[data-hop-delete]"), 0);
      }),
    60_000
  );
});

describe("a structure proposed for deletion", () => {
  it.live(
    "says it waits on the agent, and withdraws while the proposal is open",
    () =>
      Effect.gen(function* () {
        const { page, home } = yield* served;

        yield* goToChapterPaused(page, "c-all");
        yield* click(page, '[data-structure="upstream"]');
        yield* click(page, '[data-change="delete"]');
        yield* waitFor(page, '[data-removed-mark="upstream"]');
        yield* waitFor(
          page,
          "[data-change-structure] [data-withdraw-deletion]"
        );

        yield* click(page, "[data-withdraw-deletion]");
        yield* Effect.promise(() =>
          page.waitForFunction(
            `document.querySelector('[data-removed-mark]') === null`,
            undefined,
            waitTimeout
          )
        );

        assert.deepStrictEqual(
          (yield* proposalsOrEmpty(home)).structures ?? [],
          []
        );

        yield* click(page, '[data-change="delete"]');
        yield* waitFor(page, '[data-removed-mark="upstream"]');
        yield* click(page, "[data-ready-for-review]");
        yield* waitFor(page, "[data-review-dialog][open]");
        yield* Effect.promise(() => page.keyboard.press("Escape"));
        yield* waitFor(page, "[data-change-structure] [data-deletion-waiting]");

        assert.strictEqual(yield* count(page, "[data-withdraw-deletion]"), 0);
      }),
    90_000
  );
});

/** data.mjs with hop `hop` (engineer to server) and flow `flow` added. */
const withHopAndFlow = (data: string, ids: { hop: string; flow: string }) =>
  pipe(
    data,
    Str.replace(
      '    { id: "h-pr", from: "proposals", to: "pull-request", label: "accepted" },\n',
      `    { id: "h-pr", from: "proposals", to: "pull-request", label: "accepted" },
    { id: "${ids.hop}", from: "engineer", to: "server", label: "asks for a map" },\n`
    ),
    Str.replace(
      "  flows: [\n",
      `  flows: [
    { id: "${ids.flow}", name: "Storage", hops: ["h-store", "h-pr"] },
`
    )
  );

describe("the open page after verdict changed --as on a hop and a flow", () => {
  it.live(
    "follows the final ids: the pinned hop, the flow's name and its editor",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* served;

        yield* goToChapterPaused(page, "c-all");
        yield* drawHop(page, "asks for a map");

        const proposals = yield* proposalsOrEmpty(home);
        const drawn = proposals.hops?.[0]?.change;
        const hopId = drawn?.action === "add" ? drawn.hop.id : "";

        yield* openFlows(page);
        yield* Effect.promise(() =>
          page.locator("[data-new-flow-name]").fill("Storage")
        );
        yield* Effect.promise(() =>
          page.locator('[data-new-flow-hop="h-store"]').check()
        );
        yield* Effect.promise(() =>
          page.locator('[data-new-flow-hop="h-pr"]').check()
        );
        yield* click(page, "[data-new-flow-submit]");
        yield* waitFor(page, '[data-flow-name]:not([data-flow-name="f-note"])');

        const made = (yield* proposalsOrEmpty(home)).flows?.[0]?.change;
        const flowId = made?.action === "add" ? made.flow.id : "";

        assert.match(hopId, /^asks-for-a-map-[0-9a-f]{4}$/u);
        assert.match(flowId, /^storage-[0-9a-f]{4}$/u);

        // The draw form pinned the new hop, so there is a selection to follow.
        yield* click(page, '[data-tab="details"]');
        yield* waitFor(page, `[data-hop-panel="${hopId}"]`);
        yield* click(page, "[data-ready-for-review]");
        yield* waitFor(page, "[data-review-dialog][open]");
        yield* Effect.promise(() => page.keyboard.press("Escape"));

        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dataFile = path.join(home, "data.mjs");

        yield* fs.writeFileString(
          dataFile,
          withHopAndFlow(yield* fs.readFileString(dataFile), {
            hop: "asks-map",
            flow: "storage",
          })
        );

        const reviewed = yield* runCli(home, ["review", home, "--json"]);
        const report = yield* decodeReview(reviewed.stdout);
        const items = report.batch?.items ?? [];

        for (const [kind, as] of [
          ["add hop", "asks-map"],
          ["add flow", "storage"],
        ] as const) {
          const item = Arr.findFirst(items, (found) => found.kind === kind);

          assert.isTrue(Option.isSome(item), kind);

          const verdict = yield* runCli(home, [
            "verdict",
            home,
            Option.getOrThrow(item).id,
            "changed",
            "--reason",
            "Named it.",
            "--as",
            as,
          ]);

          assert.strictEqual(verdict.exitCode, 0, verdict.stderr);
        }

        const committed = yield* runCli(home, ["commit", home]);

        assert.strictEqual(committed.exitCode, 0, committed.stderr);

        // The pinned hop is now the hop under its final id.
        yield* waitFor(page, '[data-hop-panel="asks-map"]');
        assert.strictEqual(
          yield* count(page, `[data-hop-panel="${hopId}"]`),
          0
        );

        // And the flow is listed under its final id.
        yield* openFlows(page);
        yield* Effect.promise(() =>
          page.waitForFunction(
            `document.querySelector('[data-flow-name="storage"]') !== null && document.querySelector('[data-flow-name="${flowId}"]') === null`,
            undefined,
            waitTimeout
          )
        );
      }).pipe(Effect.provide(NodeServices.layer)),
    120_000
  );
});

describe.each(["iso", "plan"] as const)(
  "the cross on a hop proposed for deletion in the %s view",
  (which) => {
    it.live(
      "keeps clear of every box and every piece of text",
      () =>
        Effect.gen(function* () {
          const { page } = yield* served;

          yield* goToChapterPaused(page, "c-all");
          yield* showViewFitted(page, which);

          // Every hop in turn, including the short one between Proposals and
          // Pull request, where the cross has least room.
          for (const hop of ["h-pr", "h-store", "h-save"]) {
            yield* selectHop(page, hop);
            yield* click(page, `[data-hop-delete="${hop}"]`);
            // A hop with no clear spot for a cross is still dashed and red.
            yield* waitAttached(
              page,
              `[data-hop="${hop}"][data-hop-state="removed"]`
            );
          }

          yield* Effect.promise(() => page.keyboard.press("Escape"));
          yield* Effect.sleep("300 millis");

          const report = yield* Effect.promise(() =>
            page.evaluate<DrawingReport>(drawingReport)
          );

          assert.isAbove(report.hopStrikes.length, 0);
          assert.strictEqual(
            yield* count(page, '[data-hop][data-hop-state="removed"]'),
            3
          );
          assert.deepStrictEqual(strikesOverText(report), []);
          assert.deepStrictEqual(strikesOverBoxes(report), []);
        }),
      90_000
    );
  }
);

describe("a flow that lists a hop proposed for deletion", () => {
  it.live(
    "can still be reordered with the move buttons",
    () =>
      Effect.gen(function* () {
        const { page, home } = yield* served;

        yield* goToChapterPaused(page, "c-all");
        yield* selectHop(page, "h-save");
        yield* click(page, '[data-hop-delete="h-save"]');
        yield* waitAttached(
          page,
          '[data-hop="h-save"][data-hop-state="removed"]'
        );
        yield* openFlows(page);
        yield* click(page, '[data-sort-down="h-note"]');
        yield* waitForFlowHops(page, "f-note", ["h-save", "h-note", "h-store"]);

        assert.strictEqual(yield* count(page, "[data-flow-failure]"), 0);

        // The row says so in words, and the buttons carry it in their names.
        // The hop is still reorderable.
        const note = yield* Effect.promise(() =>
          page.locator('[data-sort-note="h-save"]').textContent()
        );

        assert.include(note ?? "", "proposed for deletion");

        const label = yield* attributeOf(
          page,
          '[data-sortable="hops:f-note"] [data-sort-up="h-save"]',
          "aria-label"
        );

        assert.include(label ?? "", "proposed for deletion");
        assert.strictEqual(yield* count(page, '[data-sort-note="h-note"]'), 0);

        const [saved] = (yield* proposalsOrEmpty(home)).flows ?? [];

        assert.deepStrictEqual(
          saved?.change.action === "hops" ? saved.change.hops : [],
          ["h-save", "h-note", "h-store"]
        );
      }),
    60_000
  );
});
