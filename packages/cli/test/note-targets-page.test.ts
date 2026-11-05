import { NoteAdd } from "@axonometric/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Schema } from "effect";
import type { Page } from "playwright";

import {
  click,
  count,
  goToChapterPaused,
  pointOnHop,
  showView,
  textOf,
  waitFor,
} from "./browser.ts";
import { openReviewMap, readProposals } from "./harness.ts";
import { post } from "./revisions.ts";

// Notes on a hop and on an empty spot, against a real serve: pinned from the
// hop's panel and the Note tool, drawn as rings clear of text and boxes in
// both views, and left out of an export.

const served = openReviewMap({});

const fill = (page: Page, selector: string, text: string) =>
  Effect.promise(() => page.locator(selector).first().fill(text));

const views = ["iso", "plan"] as const;

const spotReadout = /Spot (?<x>-?[\d.]+), (?<y>-?[\d.]+)/u;

/** The grid position the Note tool's readout shows. */
const spotOf = (readout: string) => {
  const found = spotReadout.exec(readout)?.groups;

  return { x: Number(found?.x), y: Number(found?.y) };
};

/**
 * Presses a point on hop `id`, which selects the hop. The segment is a thin
 * hit line, so it is pressed by position.
 */
const selectHop = Effect.fnUntraced(function* (page: Page, id: string) {
  const at = yield* pointOnHop(page, id);

  assert.isNotNull(at, `no uncovered point on hop ${id}`);
  yield* Effect.promise(() => page.mouse.click(at?.x ?? 0, at?.y ?? 0));
  yield* waitFor(page, `[data-hop-panel="${id}"]`);
});

/** Pins `text` from the open hop panel. */
const noteOnHop = Effect.fnUntraced(function* (page: Page, text: string) {
  yield* fill(page, "[data-hop-panel] [data-note-text]", text);
  yield* click(page, "[data-hop-panel] [data-note-send]");
});

/** Arms the Note tool and clicks on empty ground at `at`, a share of the map area. */
const pinSpot = Effect.fnUntraced(function* (
  page: Page,
  at: { readonly x: number; readonly y: number },
  text: string
) {
  yield* click(page, '[data-control="note-tool"]');
  yield* waitFor(page, "[data-spot-picker]");

  const box = yield* Effect.promise(() =>
    page.locator("[data-map-surface]").boundingBox()
  );

  assert.isNotNull(box);

  yield* Effect.promise(() =>
    page.mouse.click(
      (box?.x ?? 0) + (box?.width ?? 0) * at.x,
      (box?.y ?? 0) + (box?.height ?? 0) * at.y
    )
  );
  yield* waitFor(page, "[data-spot-panel]");
  yield* fill(page, "[data-spot-panel] [data-note-text]", text);
  yield* click(page, "[data-spot-panel] [data-note-send]");
});

interface Box {
  readonly name: string;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface Markers {
  /** Every ring's screen box. */
  readonly rings: Box[];
  /** Boxes of text a ring must stay clear of: name tags, hop labels and chips. */
  readonly texts: Box[];
  /** Rings that sit on a drawn shape of a structure, by name. */
  readonly onShapes: string[];
}

/**
 * Where the rings are, what text is near them, and which rings touch a
 * structure's drawn shapes. A structure in the Iso view is a slanted shape
 * inside a larger bounding rectangle, so touching is tested on the shape: a
 * ring touches when its centre or a point on its edge is inside a fill of
 * the structure.
 */
const markersOnPage = (page: Page) =>
  Effect.promise(() =>
    page.evaluate<Markers>(`(() => {
      const box = (name, element) => {
        const r = element.getBoundingClientRect();

        return { name, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      };

      const all = (selector, name) =>
        [...document.querySelectorAll(selector)].map((element) =>
          box(name(element), element)
        );

      const shapes = [
        ...document.querySelectorAll(
          "[data-structure] polygon, [data-structure] path, [data-structure] rect"
        ),
      ];

      const inside = (shape, x, y) => {
        const matrix = shape.getScreenCTM();

        if (matrix === null || typeof shape.isPointInFill !== "function") {
          return false;
        }

        const local = new DOMPoint(x, y).matrixTransform(matrix.inverse());

        return shape.isPointInFill(local);
      };

      const rings = [
        ...document.querySelectorAll("[data-note-marker][data-note-placed='ring']"),
      ];

      const onShapes = [];

      for (const ring of rings) {
        const circle = ring.tagName === "circle" ? ring : ring.querySelector("circle");
        const r = circle.getBoundingClientRect();
        const cx = (r.left + r.right) / 2;
        const cy = (r.top + r.bottom) / 2;
        const radius = r.width / 2;
        const points = [[cx, cy]];

        for (let turn = 0; turn < 16; turn += 1) {
          const angle = (turn * Math.PI) / 8;

          points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
        }

        const name = "marker:" + ring.getAttribute("data-note-marker");

        if (points.some(([x, y]) => shapes.some((shape) => inside(shape, x, y)))) {
          onShapes.push(name);
        }
      }

      return {
        rings: rings.map((ring) =>
          box("marker:" + ring.getAttribute("data-note-marker"), ring)
        ),
        texts: [
          ...all("[data-name-tag]", (e) => "tag:" + e.getAttribute("data-name-tag")),
          ...all("[data-hop-label]", (e) => "label:" + e.getAttribute("data-hop-label")),
          ...all("[data-code-chip]", () => "chip"),
        ],
        onShapes,
      };
    })()`)
  );

const overlap = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

describe("a note on a hop", () => {
  it.live(
    "is pinned from the hop's panel, shown on the panel and marked on the map",
    () =>
      Effect.gen(function* () {
        const { home, page, errors } = yield* served;

        yield* goToChapterPaused(page, "c-all");
        yield* selectHop(page, "h-save");
        yield* noteOnHop(page, "Why not a socket?");
        yield* waitFor(page, "[data-hop-panel] [data-panel-note]");
        yield* waitFor(page, '[data-note-marker="hop:h-save"]');

        const proposals = yield* readProposals(home);

        assert.deepStrictEqual(
          Arr.map(proposals.notes ?? [], ({ target, text }) => [target, text]),
          [[{ kind: "hop", id: "h-save" }, "Why not a socket?"]]
        );

        yield* click(page, '[role="tab"][data-tab="pending"]');
        yield* waitFor(page, '[data-review-kind="note"]');

        const listed = yield* Effect.promise(() =>
          page.locator('[data-review-kind="note"]').first().textContent()
        );

        assert.include(
          listed,
          "Note on hop POST /proposals: Why not a socket?"
        );
        assert.deepStrictEqual(errors, []);
      }),
    60_000
  );
});

describe("a note on an empty spot", () => {
  it.live(
    "is pinned with the Note tool, saved on the half-unit grid and listed in the panel",
    () =>
      Effect.gen(function* () {
        const { home, page, errors } = yield* served;

        yield* goToChapterPaused(page, "c-all");
        yield* pinSpot(page, { x: 0.5, y: 0.82 }, "A cache could sit here.");
        yield* waitFor(page, "[data-spot-panel] [data-panel-note]");
        yield* waitFor(page, '[data-note-marker^="spot:"]');

        const [saved] = (yield* readProposals(home)).notes ?? [];

        assert.strictEqual(saved?.target.kind, "spot");
        assert.strictEqual(saved?.text, "A cache could sit here.");

        if (saved?.target.kind === "spot") {
          assert.isTrue(Number.isInteger(saved.target.x * 2));
          assert.isTrue(Number.isInteger(saved.target.y * 2));
        }

        yield* click(page, '[role="tab"][data-tab="pending"]');
        yield* waitFor(page, '[data-review-kind="note"]');
        assert.deepStrictEqual(errors, []);
      }),
    60_000
  );
});

describe("markers for hops and spots", () => {
  for (const view of views) {
    it.live(
      `sit clear of boxes, name tags, chips and labels in ${view}`,
      () =>
        Effect.gen(function* () {
          const { page } = yield* served;

          yield* goToChapterPaused(page, "c-all");
          yield* showView(page, view);
          yield* selectHop(page, "h-save");
          yield* noteOnHop(page, "On the hop");
          yield* waitFor(page, '[data-note-marker="hop:h-save"]');

          yield* pinSpot(page, { x: 0.5, y: 0.82 }, "On a spot");
          yield* waitFor(page, '[data-note-marker^="spot:"]');

          // Pin one on a structure as well, so all three kinds are drawn.
          yield* click(page, '[data-structure="server"]');
          yield* waitFor(page, '[data-structure-panel="server"][data-pinned]');
          yield* fill(
            page,
            "[data-structure-panel] [data-notes-section] [data-note-text]",
            "On a box"
          );
          yield* click(
            page,
            "[data-structure-panel] [data-notes-section] [data-note-send]"
          );
          yield* waitFor(page, '[data-note-marker="server"]');

          const { rings, texts, onShapes } = yield* markersOnPage(page);

          assert.isAtLeast(rings.length, 3);
          assert.deepStrictEqual(onShapes, [], `rings on a box in ${view}`);

          for (const ring of rings) {
            for (const text of texts) {
              assert.isFalse(
                overlap(ring, text),
                `${ring.name} covers ${text.name} in ${view}`
              );
            }

            for (const other of rings) {
              assert.isFalse(
                ring !== other && overlap(ring, other),
                `${ring.name} touches ${other.name} in ${view}`
              );
            }
          }
        }),
      90_000
    );
  }
});

/** The body that pins a far-off spot note, on the file revision `base`. */
const farSpot = (base: number) =>
  Schema.encodeEffect(Schema.fromJsonString(NoteAdd))({
    baseFileRevision: base,
    id: "n-far",
    target: { kind: "spot", x: 60, y: 40 },
    text: "Far away",
  }).pipe(Effect.orDie);

/** Whether every ring is wholly inside the map surface. */
const ringsOnScreen = (page: Page) =>
  Effect.promise(() =>
    page.evaluate<boolean>(`(() => {
        const surface = document.querySelector("[data-map-surface]").getBoundingClientRect();
        const rings = [...document.querySelectorAll("[data-note-marker][data-note-placed='ring']")];

        return rings.length > 0 && rings.every((ring) => {
          const r = ring.getBoundingClientRect();

          return r.left >= surface.left && r.right <= surface.right && r.top >= surface.top && r.bottom <= surface.bottom;
        });
      })()`)
  );

describe("zoom to fit", () => {
  for (const view of views) {
    it.live(
      `includes a spot note far from the map in ${view}`,
      () =>
        Effect.gen(function* () {
          const { serve, page, errors } = yield* served;

          const sent = yield* post(serve.url, "/api/notes", yield* farSpot(0));

          assert.strictEqual(sent.status, 200, sent.body);

          yield* goToChapterPaused(page, "c-all");
          yield* showView(page, view);
          yield* waitFor(page, '[data-note-marker^="spot:"]');
          yield* click(page, 'button[title="Zoom to fit (0)"]');
          yield* Effect.promise(() => page.waitForTimeout(500));

          assert.isTrue(yield* ringsOnScreen(page));
          assert.deepStrictEqual(errors, []);
        }),
      60_000
    );
  }
});

describe("the keyboard", () => {
  it.live(
    "opens a ring by a press, or by its name with Enter or Space, and shows a focus ring",
    () =>
      Effect.gen(function* () {
        const { page } = yield* served;

        yield* goToChapterPaused(page, "c-all");
        yield* selectHop(page, "h-save");
        yield* noteOnHop(page, "A thought");
        yield* waitFor(page, '[data-note-marker="hop:h-save"]');
        yield* click(page, '[data-structure="server"]');
        yield* waitFor(page, '[data-structure-panel="server"][data-pinned]');
        yield* fill(
          page,
          "[data-structure-panel] [data-notes-section] [data-note-text]",
          "On a box"
        );
        yield* click(
          page,
          "[data-structure-panel] [data-notes-section] [data-note-send]"
        );
        yield* waitFor(page, '[data-note-marker="server"]');
        yield* Effect.promise(() => page.keyboard.press("Escape"));

        // Pressing the hop's ring opens the hop's panel.
        yield* click(page, '[data-note-marker="hop:h-save"]');
        yield* waitFor(page, '[data-hop-panel="h-save"]');
        yield* Effect.promise(() => page.keyboard.press("Escape"));
        yield* Effect.promise(() =>
          page.locator("[data-hop-panel]").waitFor({ state: "detached" })
        );

        const hopRing = page.getByRole("button", {
          name: 'Note on hop "POST /proposals"',
        });

        const boxRing = page.getByRole("button", {
          name: 'Note on "Save server"',
        });

        assert.strictEqual(yield* Effect.promise(() => hopRing.count()), 1);
        assert.strictEqual(yield* Effect.promise(() => boxRing.count()), 1);

        yield* Effect.promise(() => hopRing.focus());

        // Focus shows: the ring has an outline.
        const outline = yield* Effect.promise(() =>
          page.evaluate<string>(
            `getComputedStyle(document.querySelector('[data-note-marker="hop:h-save"]')).outlineStyle`
          )
        );

        assert.notStrictEqual(outline, "none");

        yield* Effect.promise(() => page.keyboard.press("Enter"));
        yield* waitFor(page, '[data-hop-panel="h-save"]');
        yield* Effect.promise(() => page.keyboard.press("Escape"));
        yield* Effect.promise(() =>
          page.locator("[data-hop-panel]").waitFor({ state: "detached" })
        );
        yield* Effect.promise(() => boxRing.focus());
        yield* Effect.promise(() => page.keyboard.press("Space"));
        yield* waitFor(page, '[data-structure-panel="server"][data-pinned]');
      }),
    60_000
  );

  it.live(
    "pins a note on a spot with the arrow keys and Enter",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* served;

        yield* goToChapterPaused(page, "c-all");
        yield* showView(page, "iso");

        // The button is reachable and armed from the keyboard.
        yield* Effect.promise(() =>
          page.locator('[data-control="note-tool"]').focus()
        );
        yield* Effect.promise(() => page.keyboard.press("Enter"));
        yield* waitFor(page, "[data-spot-cursor]");
        yield* Effect.promise(() => page.locator("body").focus());

        const readout = () => textOf(page, "[data-spot-readout]");
        const start = yield* readout();

        yield* Effect.promise(() => page.keyboard.press("ArrowRight"));
        yield* Effect.promise(() => page.keyboard.press("ArrowDown"));
        yield* Effect.promise(() => page.keyboard.press("Shift+ArrowRight"));

        const moved = yield* readout();

        assert.notStrictEqual(moved, start);

        const after = spotOf(moved);
        const before = spotOf(start);

        assert.closeTo(after.x - before.x, 5.5, 1e-9);
        assert.closeTo(after.y - before.y, 0.5, 1e-9);

        yield* Effect.promise(() => page.keyboard.press("Enter"));
        yield* waitFor(page, "[data-spot-panel]");
        yield* fill(page, "[data-spot-panel] [data-note-text]", "By keyboard");
        yield* click(page, "[data-spot-panel] [data-note-send]");
        yield* waitFor(page, "[data-spot-panel] [data-panel-note]");

        const [saved] = (yield* readProposals(home)).notes ?? [];

        assert.deepStrictEqual(saved?.target, {
          kind: "spot",
          x: after.x,
          y: after.y,
        });
        assert.strictEqual(saved?.text, "By keyboard");
      }),
    60_000
  );

  it.live(
    "keeps the arrow keys for the cursor while the tool is armed, and Escape stops it",
    () =>
      Effect.gen(function* () {
        const { page } = yield* served;

        yield* goToChapterPaused(page, "c-all");

        const chapter = () =>
          page.evaluate<string>(
            "document.querySelector('[data-walkthrough]').dataset.chapter"
          );

        yield* click(page, '[data-control="note-tool"]');
        yield* waitFor(page, "[data-spot-cursor]");
        yield* Effect.promise(() => page.keyboard.press("ArrowLeft"));

        // The arrow moved the cursor, not the chapter.
        assert.strictEqual(yield* Effect.promise(chapter), "c-all");

        yield* Effect.promise(() => page.keyboard.press("Escape"));
        yield* Effect.promise(() =>
          page.locator("[data-spot-cursor]").waitFor({ state: "detached" })
        );
        assert.strictEqual(yield* count(page, "[data-spot-panel]"), 0);
      })
  );
});

/**
 * The fewest screen pixels between the outer edge of every hop ring and the
 * outer edge of every hop line, from what the page really draws: each point
 * goes through the screen matrix, and the strokes are measured at the scale
 * they show at.
 */
const ringToLinePixels = (page: Page) =>
  Effect.promise(() =>
    page.evaluate<
      readonly { ring: string; hop: string; pixels: number }[]
    >(`(() => {
      const near = (p, a, b) => {
        const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
        const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));

        return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
      };

      const rings = [...document.querySelectorAll("[data-note-marker^='hop:'][data-note-placed='ring']")];
      const lines = [...document.querySelectorAll("[data-hop]")];
      const found = [];

      for (const ring of rings) {
        const circle = ring.querySelector("circle");
        const m = circle.getScreenCTM();
        const scale = Math.hypot(m.a, m.b);
        const centre = new DOMPoint(Number(circle.getAttribute("cx")), Number(circle.getAttribute("cy"))).matrixTransform(m);
        const outer = (Number(circle.getAttribute("r")) + Number(circle.getAttribute("stroke-width")) / 2) * scale;

        for (const line of lines) {
          const stroke = line.querySelector("polyline:not([stroke='transparent'])");
          const points = stroke.getAttribute("points").split(" ").map((pair) => {
            const [x, y] = pair.split(",").map(Number);

            return new DOMPoint(x, y).matrixTransform(stroke.getScreenCTM());
          });
          const half = (Number(stroke.getAttribute("stroke-width")) / 2) * scale;
          let best = Infinity;

          for (let i = 0; i + 1 < points.length; i++) {
            best = Math.min(best, near(centre, points[i], points[i + 1]));
          }

          found.push({
            ring: ring.getAttribute("data-note-marker"),
            hop: line.getAttribute("data-hop"),
            pixels: best - outer - half,
          });
        }
      }

      return found;
    })()`)
  );

describe("hop rings at fit", () => {
  for (const view of views) {
    it.live(
      `keep 3 screen pixels from every hop's line at 1280×800 in ${view}`,
      () =>
        Effect.gen(function* () {
          const { page, errors } = yield* served;

          yield* goToChapterPaused(page, "c-all");
          yield* showView(page, view);

          for (const hop of ["h-save", "h-store", "h-pr"]) {
            yield* selectHop(page, hop);
            yield* noteOnHop(page, `A thought on ${hop}`);
            yield* waitFor(page, `[data-note-marker="hop:${hop}"]`);
            yield* Effect.promise(() => page.keyboard.press("Escape"));
          }

          yield* click(page, 'button[title="Zoom to fit (0)"]');
          yield* Effect.promise(() => page.waitForTimeout(500));

          const gaps = yield* ringToLinePixels(page);

          assert.isAtLeast(gaps.length, 9);

          for (const { ring, hop, pixels } of gaps) {
            assert.isAtLeast(
              pixels,
              3 - 0.05,
              `${ring} is ${pixels.toFixed(2)} px from the line of ${hop} in ${view}`
            );
          }

          assert.deepStrictEqual(errors, []);
        }),
      90_000
    );
  }
});
