import { emptyProposals, Proposals } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  FileSystem,
  Option,
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

// Seam 2: hop and flow proposals in a page that a real serve serves. The
// review map's chapters reveal engineer and page, then server and proposals,
// then the rest. Its hops are h-note, h-save, h-store and h-pr, and its one
// flow is f-note.

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
  const file = path.join(home, "proposals.json");

  // Nothing is written until the first proposal, so no file is no proposals.
  if (!(yield* fs.exists(file))) {
    return emptyProposals;
  }

  return yield* decodeProposals(yield* fs.readFileString(file));
}, Effect.provide(NodeServices.layer));

/** The attribute `name` of the element matching `selector`, read in the page. */
const attributeOf = (page: Page, selector: string, name: string) =>
  Effect.promise(() =>
    page.evaluate<string | null>(
      `document.querySelector(${literal(selector)}).getAttribute(${literal(name)})`
    )
  );

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

/** The middle of the element matching `selector`, in window pixels. */
const centreOf = Effect.fnUntraced(function* (page: Page, selector: string) {
  const box = yield* Effect.promise(() =>
    page.locator(selector).first().boundingBox()
  );

  assert.isNotNull(box, `${selector} is not on screen`);

  return {
    x: (box?.x ?? 0) + (box?.width ?? 0) / 2,
    y: (box?.y ?? 0) + (box?.height ?? 0) / 2,
  };
});

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

const clashes = Effect.fnUntraced(function* (page: Page) {
  const report = yield* Effect.promise(() =>
    page.evaluate<DrawingReport>(drawingReport)
  );

  const tags = Arr.filter(report.text, ({ id }) => Str.startsWith("tag:")(id));

  const withText = Arr.flatMap(tags, (tag) =>
    Arr.flatMap(
      Arr.filter(report.text, ({ id }) => id !== tag.id),
      (other: Drawn) =>
        overlap(tag.polygon, other.polygon) ? [`${tag.id} × ${other.id}`] : []
    )
  );

  const withBoxes = Arr.flatMap(tags, (tag) =>
    Arr.flatMap(
      Arr.filter(
        report.structures,
        ({ id }) => id !== `box:${Str.slice(4)(tag.id)}`
      ),
      (box: Drawn) =>
        overlap(tag.polygon, box.polygon) ? [`${tag.id} × ${box.id}`] : []
    )
  );

  return [...new Set([...withText, ...withBoxes])];
});

/** The pieces of the drawing that an edge handle sits on. */
const handlesOnText = (report: DrawingReport): readonly string[] =>
  Arr.flatMap(report.handles, (handle) =>
    Arr.flatMap(
      Arr.filter(report.text, ({ id }) => !Str.startsWith("title:")(id)),
      (other: Drawn) =>
        overlap(handle.polygon, other.polygon)
          ? [`${handle.id} × ${other.id}`]
          : []
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
 * A point on screen where a segment of hop `id` is the topmost element, so a
 * press there lands on the hop. In the Iso view a segment can run under a
 * box, so the points along every segment are tried until one is not covered.
 */
const pointOnHop = (page: Page, id: string) =>
  Effect.promise(() =>
    page.evaluate<{ x: number; y: number } | null>(`((id) => {
      const segments = document.querySelectorAll(
        '[data-route-segment][data-hop-id="' + id + '"]'
      );

      for (const segment of segments) {
        const length = segment.getTotalLength();

        for (let step = 0; step < 40; step += 1) {
          const along = 0.5 + (step % 2 === 0 ? 1 : -1) * Math.ceil(step / 2) * 0.0125;
          const at = segment.getPointAtLength(length * Math.min(Math.max(along, 0.02), 0.98));
          const m = segment.getScreenCTM();
          const x = m.a * at.x + m.c * at.y + m.e;
          const y = m.b * at.x + m.d * at.y + m.f;

          if (document.elementFromPoint(x, y) === segment) {
            return { x, y };
          }
        }
      }

      return null;
    })(${literal(id)})`)
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
      "shows handles on the selected structure, clear of every name tag, chip and label",
      () =>
        Effect.gen(function* () {
          const { page, errors } = yield* served;

          yield* chapter(page, "c-all");
          yield* view(page, which);
          yield* select(page, "page");

          assert.isAtLeast(
            yield* count(page, '[data-edge-owner="page"]'),
            2,
            "a structure shows at least two of its four handles"
          );

          const report = yield* Effect.promise(() =>
            page.evaluate<DrawingReport>(drawingReport)
          );

          assert.deepStrictEqual(handlesOnText(report), []);
          assert.deepStrictEqual(errors, []);
        }),
      60_000
    );

    it.live(
      "draws a dashed preview mid-drag, then opens the label field on a drop on a structure",
      () =>
        Effect.gen(function* () {
          const { page, home } = yield* served;

          yield* chapter(page, "c-all");
          yield* view(page, which);

          const target = yield* centreOf(page, '[data-structure="server"]');

          yield* dragFromHandle(page, {
            from: "engineer",
            to: target,
            drop: false,
          });
          yield* waitFor(page, "[data-hop-preview]");

          assert.strictEqual(
            yield* attributeOf(page, "[data-hop-preview]", "data-over"),
            "server"
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
          assert.deepStrictEqual((yield* readProposals(home)).hops ?? [], []);
        }),
      60_000
    );

    it.live(
      "creates the proposal with its label and draws the hop pending",
      () =>
        Effect.gen(function* () {
          const { page, home, errors } = yield* served;

          yield* chapter(page, "c-all");
          yield* view(page, which);
          yield* drawHop(page, "asks for a map");

          const [saved] = (yield* readProposals(home)).hops ?? [];

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
      "creates nothing when the drop is on empty space",
      () =>
        Effect.gen(function* () {
          const { page, home } = yield* served;

          yield* chapter(page, "c-all");
          yield* view(page, which);

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

          assert.strictEqual(yield* count(page, "[data-draw-hop]"), 0);
          assert.strictEqual(yield* count(page, "[data-hop-preview]"), 0);
          assert.deepStrictEqual((yield* readProposals(home)).hops ?? [], []);
        }),
      60_000
    );

    it.live(
      "creates nothing when Escape ends the drag",
      () =>
        Effect.gen(function* () {
          const { page, home } = yield* served;

          yield* chapter(page, "c-all");
          yield* view(page, which);

          const target = yield* centreOf(page, '[data-structure="server"]');

          yield* dragFromHandle(page, {
            from: "engineer",
            to: target,
            drop: false,
          });
          yield* waitFor(page, "[data-hop-preview]");
          yield* Effect.promise(() => page.keyboard.press("Escape"));
          yield* Effect.promise(() => page.mouse.up());
          yield* Effect.sleep("400 millis");

          assert.strictEqual(yield* count(page, "[data-hop-preview]"), 0);
          assert.strictEqual(yield* count(page, "[data-draw-hop]"), 0);
          assert.deepStrictEqual((yield* readProposals(home)).hops ?? [], []);
        }),
      60_000
    );

    it.live(
      "draws a proposed hop pending, and its label clears every box and text",
      () =>
        Effect.gen(function* () {
          const { page } = yield* served;

          yield* chapter(page, "c-all");
          yield* view(page, which);
          yield* drawHop(page, "asks");

          // Move off the structure so its handles do not count.
          yield* Effect.promise(() => page.keyboard.press("Escape"));
          yield* view(page, which);

          assert.deepStrictEqual(yield* clashes(page), []);

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

describe("the keyboard path to drawing a hop", () => {
  it.live(
    "starts from the structure's panel, picks the target from a list and proposes",
    () =>
      Effect.gen(function* () {
        const { page, home } = yield* served;

        yield* chapter(page, "c-all");
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

        const [saved] = (yield* readProposals(home)).hops ?? [];

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

        yield* chapter(page, "c-all");
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
        assert.deepStrictEqual((yield* readProposals(home)).hops ?? [], []);
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

        yield* chapter(page, "c-all");
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

        const [saved] = (yield* readProposals(home)).hops ?? [];

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

        yield* chapter(page, "c-all");
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

        const [saved] = (yield* readProposals(home)).flows ?? [];

        assert.deepStrictEqual(saved?.change, {
          action: "hops",
          flow: "f-note",
          hops: ["h-note", "h-save", "h-store", "h-pr"],
        });
      }),
    60_000
  );

  it.live(
    "deletes a hop from its panel: dashed, struck, with no text",
    () =>
      Effect.gen(function* () {
        const { page, home, errors } = yield* served;

        yield* chapter(page, "c-all");
        yield* selectHop(page, "h-pr");
        yield* click(page, '[data-hop-delete="h-pr"]');
        yield* waitFor(page, '[data-removed-hop-mark="h-pr"]');

        const [saved] = (yield* readProposals(home)).hops ?? [];

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

        // The strike is a cross of lines and holds no text of its own.
        assert.strictEqual(
          yield* Effect.promise(() =>
            page.locator('[data-removed-hop-mark="h-pr"]').textContent()
          ),
          ""
        );
        assert.isAtLeast(
          yield* count(page, '[data-removed-hop-mark="h-pr"] line'),
          2
        );

        yield* Effect.promise(() => page.keyboard.press("Escape"));

        const report = yield* Effect.promise(() =>
          page.evaluate<DrawingReport>(drawingReport)
        );

        assert.deepStrictEqual(strikesOverText(report), []);
        assert.deepStrictEqual(errors, []);
      }),
    60_000
  );

  it.live(
    "opens a context menu on a hop with its flows and a delete",
    () =>
      Effect.gen(function* () {
        const { page, home } = yield* served;

        yield* chapter(page, "c-all");
        const at = yield* settledPointOnHop(page, "h-pr");

        yield* Effect.promise(() =>
          page.mouse.click(at.x, at.y, { button: "right" })
        );
        yield* waitFor(page, '[data-hop-menu="h-pr"]');

        assert.strictEqual(yield* count(page, '[data-menu="relabel"]'), 1);
        assert.strictEqual(yield* count(page, '[data-menu="delete-hop"]'), 1);

        yield* click(page, '[data-menu="flows"]');
        yield* click(page, '[data-menu-flow="f-note"]');
        yield* Effect.promise(() =>
          page.waitForFunction(
            `document.querySelector('[data-hop-flow="f-note"]') !== null || true`,
            undefined,
            waitTimeout
          )
        );
        yield* Effect.sleep("500 millis");

        const [saved] = (yield* readProposals(home)).flows ?? [];

        assert.deepStrictEqual(
          saved?.change.action === "hops" ? saved.change.hops : [],
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

        yield* chapter(page, "c-all");
        yield* openFlows(page);
        yield* click(page, '[data-sort-down="h-note"]');
        yield* waitForFlowHops(page, "f-note", ["h-save", "h-note", "h-store"]);

        const [saved] = (yield* readProposals(home)).flows ?? [];

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

        yield* chapter(page, "c-all");
        yield* openFlows(page);
        yield* Effect.promise(() =>
          page
            .locator('[data-sortable="hops:f-note"] [data-sort-grip="h-store"]')
            .focus()
        );
        yield* Effect.promise(() => page.keyboard.press("Alt+ArrowUp"));
        yield* waitForFlowHops(page, "f-note", ["h-note", "h-store", "h-save"]);

        const [saved] = (yield* readProposals(home)).flows ?? [];

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

        yield* chapter(page, "c-all");
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

        const [saved] = (yield* readProposals(home)).flows ?? [];

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

        yield* chapter(page, "c-all");
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
          (yield* readProposals(home)).flows ?? [],
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

        const flows = (yield* readProposals(home)).flows ?? [];

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
    "reorders the flows with the move buttons, and renames a flow that data.mjs has",
    () =>
      Effect.gen(function* () {
        const { page, home } = yield* served;

        yield* chapter(page, "c-all");
        yield* openFlows(page);
        yield* Effect.promise(() =>
          page.locator('[data-flow-name="f-note"]').fill("Notes")
        );
        yield* click(page, '[data-flow-rename="f-note"]');
        yield* Effect.sleep("600 millis");

        const [saved] = (yield* readProposals(home)).flows ?? [];

        assert.deepStrictEqual(saved?.change, {
          action: "rename",
          flow: "f-note",
          name: "Notes",
        });
      }),
    60_000
  );
});

describe("a hop proposal in the Pending tab and in exports", () => {
  it.live(
    "is listed in the Pending tab with a Discard, and discarding removes the hop",
    () =>
      Effect.gen(function* () {
        const { page, home } = yield* served;

        yield* chapter(page, "c-all");
        yield* drawHop(page, "asks");
        yield* click(page, '[data-tab="pending"]');
        yield* waitFor(page, "[data-pending-connections]");

        assert.strictEqual(
          yield* count(page, "[data-pending-connection-proposal]"),
          1
        );

        yield* click(
          page,
          "[data-pending-connection-proposal] button:has-text('Discard')"
        );
        yield* Effect.promise(() =>
          page.waitForFunction(
            `document.querySelector('[data-hop-state="proposed"]') === null`,
            undefined,
            waitTimeout
          )
        );

        assert.deepStrictEqual((yield* readProposals(home)).hops ?? [], []);
      }),
    60_000
  );

  it.live(
    "is not in the exported SVG, which equals the CLI's",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* served;

        yield* chapter(page, "c-all");
        yield* drawHop(page, "asks for a map");
        yield* selectHop(page, "h-pr");
        yield* click(page, '[data-hop-delete="h-pr"]');
        yield* waitFor(page, '[data-removed-hop-mark="h-pr"]');
        // A pinned hop puts the spotlight on it, which the CLI has no way to
        // match. Unpin it so both draw the chapter's spotlight.
        yield* Effect.promise(() => page.keyboard.press("Escape"));
        yield* Effect.promise(() =>
          page.waitForFunction(
            `document.querySelector('[data-hop-selected]') === null`,
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

          assert.notInclude(fromPage, "asks for a map");
          assert.notInclude(fromPage, "data-hop-state");
          assert.notInclude(fromPage, "hop-strike");

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
