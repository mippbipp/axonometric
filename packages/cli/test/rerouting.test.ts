import { LayoutFile, MapProblem, Proposals } from "@axonometric/contracts";
import type { StructureMove } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  FileSystem,
  Option,
  Order,
  Path,
  Schema,
  String as Str,
} from "effect";
import type { Page } from "playwright";

import { literal, openUrl } from "./browser.ts";
import { fullMap } from "./fixtures.ts";
import { makeHome, runCli, startServe } from "./harness.ts";

// Rerouting arrows and moving groups in a page that a real serve serves. The
// review map has engineer, page, server, proposals, pull-request and
// upstream at 0,0, 4,0, 8,0, 8,6, 12,6 and 18,0. The server's hop to the
// proposals store (h-store) runs from (9, 2) to (9, 6), straight down along y.
// Groups: people holds the engineer, loop holds page, server, proposals and
// the pull request, and outside holds upstream.

const waitTimeout = { timeout: 15_000 };

const decodeProposals = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Proposals)
);

const decodeLayout = Schema.decodeUnknownEffect(LayoutFile);

type View = "iso" | "plan";

interface Point {
  readonly x: number;
  readonly y: number;
}

/** The review map served on a free port, open in its last chapter. */
const servedReview = Effect.gen(function* () {
  const path = yield* Path.Path;
  const root = yield* makeHome(yield* fullMap);
  const home = path.join(root, "review", "map");
  const serve = yield* startServe(home, ["--port", "0"]);
  const opened = yield* openUrl(serve.url);

  yield* Effect.promise(() =>
    opened.page.setViewportSize({ width: 1280, height: 800 })
  );
  yield* Effect.promise(() =>
    opened.page
      .locator('[data-chapter-rail] button[data-chapter="c-all"]')
      .click()
  );
  yield* Effect.promise(() =>
    opened.page
      .locator('[data-walkthrough][data-chapter="c-all"]')
      .waitFor(waitTimeout)
  );

  return { root, home, serve, ...opened };
}).pipe(Effect.provide(NodeServices.layer));

const toView = Effect.fnUntraced(function* (page: Page, view: View) {
  yield* Effect.promise(() =>
    page.locator(`[data-view-toggle] [data-view="${view}"]`).click()
  );
  yield* Effect.promise(() =>
    page.locator(`[data-walkthrough][data-view="${view}"]`).waitFor()
  );
});

const waitFor = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).first().waitFor(waitTimeout));

const waitGone = (page: Page, selector: string) =>
  Effect.promise(() =>
    page
      .locator(selector)
      .first()
      .waitFor({ state: "detached", ...waitTimeout })
  );

const attribute = (page: Page, selector: string, name: string) =>
  Effect.promise(() => page.locator(selector).first().getAttribute(name));

const count = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).count());

/** What proposals.json in `home` holds. */
const proposalsIn = Effect.fnUntraced(function* (home: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(home, "proposals.json");

  return (yield* fs.exists(file))
    ? Option.some(yield* decodeProposals(yield* fs.readFileString(file)))
    : Option.none<Proposals>();
}, Effect.provide(NodeServices.layer));

/** Waits until proposals.json in `home` is at `revision`. */
const waitForRevision = Effect.fnUntraced(function* (
  home: string,
  revision: number
) {
  for (let tries = 0; tries < 150; tries++) {
    const now = yield* proposalsIn(home);

    if (Option.isSome(now) && now.value.revision >= revision) {
      return now.value;
    }

    yield* Effect.sleep("100 millis");
  }

  return assert.fail(`proposals.json never reached revision ${revision}`);
});

/** One grid unit along an axis on screen, at the view's current zoom. */
const unitOnScreen = Effect.fnUntraced(function* (page: Page, view: View) {
  const scale = yield* attribute(page, "svg[data-scale]", "data-scale");

  return (view === "plan" ? 60 : Math.hypot(36, 18)) * Number(scale);
});

/**
 * Where `ground` sits on screen. The view's drawing is the page's SVG; a
 * hop's segment is the invisible line over it, so its middle is a point on
 * the segment.
 */
const middleOf = Effect.fnUntraced(function* (page: Page, selector: string) {
  const box = yield* Effect.promise(() =>
    page.locator(selector).first().boundingBox()
  );

  assert.isNotNull(box, `${selector} isn't on screen`);

  return box === null
    ? { x: 0, y: 0 }
    : { x: box.x + box.width / 2, y: box.y + box.height / 2 };
});

/** Presses at `from` and moves by `by` in small steps, still pressed. */
const pressAndMove = Effect.fnUntraced(function* (
  page: Page,
  from: Point,
  by: Point
) {
  yield* Effect.promise(() => page.mouse.move(from.x, from.y));
  yield* Effect.promise(() => page.mouse.down());
  yield* Effect.promise(() =>
    page.mouse.move(from.x + by.x, from.y + by.y, { steps: 12 })
  );
});

const dragBy = (page: Page, from: Point, by: Point) =>
  pressAndMove(page, from, by).pipe(
    Effect.andThen(Effect.promise(() => page.mouse.up()))
  );

/**
 * How far a drag of `cells` grid units along the ground's `x` or `y` axis
 * moves the pointer on screen. Plan view draws x to the right and y down.
 * The Iso view draws x down and to the right and y down and to the left.
 */
const screenDelta = (view: View, unit: number, ground: Point): Point =>
  view === "plan"
    ? { x: ground.x * unit, y: ground.y * unit }
    : {
        x: ((ground.x - ground.y) * unit * 36) / Math.hypot(36, 18),
        y: ((ground.x + ground.y) * unit * 18) / Math.hypot(36, 18),
      };

/** The segments of hop `hop` on the page, in route order, with their axes. */
const segmentsOf = (page: Page, hop: string) =>
  Effect.promise(() =>
    page.evaluate<readonly { segment: number; axis: string }[]>(
      `[...document.querySelectorAll(${literal(`[data-route-segment][data-hop-id="${hop}"]`)})].map((line) => ({ segment: Number(line.getAttribute("data-segment")), axis: line.getAttribute("data-axis") }))`
    )
  );

/**
 * The route a hop is drawn along, as the page's `data-route` says, turned
 * back from `view`'s screen points to ground units.
 */
const drawnRoute = Effect.fnUntraced(function* (
  page: Page,
  hop: string,
  view: View
) {
  const text = yield* attribute(page, `[data-hop="${hop}"]`, "data-route");

  return Arr.map(Str.split(text ?? "", " "), (pair) => {
    const [sx, sy] = Arr.map(Str.split(pair, ","), Number);

    if (view === "plan") {
      return { x: (sx ?? 0) / 60, y: (sy ?? 0) / 60 };
    }

    const across = (sx ?? 0) / 36;
    const down = (sy ?? 0) / 18;

    return {
      x: Math.round(((across + down) / 2) * 1000) / 1000,
      y: Math.round(((down - across) / 2) * 1000) / 1000,
    };
  });
});

const segmentSelector = (hop: string, segment: number) =>
  `[data-route-segment][data-hop-id="${hop}"][data-segment="${segment}"]`;

/** What the warnings list shows: each message, and the place under it. */
const warningsOf = (page: Page) =>
  Effect.promise(() =>
    page.evaluate<
      readonly { message: string; where: string; isNew: boolean }[]
    >(
      `[...document.querySelectorAll("[data-drag-warning]")].map((item) => ({ message: item.querySelector("[data-warning-message]").textContent, where: item.querySelector("[data-warning-where]").textContent, isNew: item.getAttribute("data-warning-new") === "true" }))`
    )
  );

const CheckWarnings = Schema.Struct({ warnings: Schema.Array(MapProblem) });

const decodeReport = Schema.decodeEffect(Schema.fromJsonString(CheckWarnings));

/** A warning as one string, for comparing lists of them. */
const placed = (item: { message: string; where: string }) =>
  `${item.where}|${item.message}`;

/** What the warnings list shows, as sorted strings. */
const asShown = (shown: readonly { message: string; where: string }[]) =>
  Arr.sort(Arr.map(shown, placed), Order.String);

/** Whether any two visible texts on the page share ground, as pairs of names. */
const overlappingTexts = (page: Page) =>
  Effect.promise(() =>
    page.evaluate<readonly string[]>(`(() => {
      const visible = (element) => {
        const style = getComputedStyle(element);

        return style.visibility !== "hidden" && style.display !== "none";
      };

      const texts = [
        ...[...document.querySelectorAll("[data-name-tag]")].map((tag) => ({
          name: "tag:" + tag.getAttribute("data-name-tag"),
          element: tag.querySelector("text"),
        })),
        ...[...document.querySelectorAll("[data-hop-label]")].map((label) => ({
          name: "label:" + label.getAttribute("data-hop-label"),
          element: label,
        })),
        ...[...document.querySelectorAll("[data-zone-title]")].map((title) => ({
          name: "title:" + title.closest("[data-zone]").getAttribute("data-zone"),
          element: title,
        })),
      ]
        .filter(({ element }) => element !== null && visible(element))
        .map(({ name, element }) => ({ name, box: element.getBoundingClientRect() }));

      const found = [];

      texts.forEach((a, index) => {
        texts.slice(index + 1).forEach((b) => {
          if (
            a.box.left < b.box.right &&
            b.box.left < a.box.right &&
            a.box.top < b.box.bottom &&
            b.box.top < a.box.bottom
          ) {
            found.push(a.name + " over " + b.name);
          }
        });
      });

      return found;
    })()`)
  );

const reroutesIn = (proposals: Proposals) =>
  Arr.filter(proposals.layout, (change) => change.kind === "reroute");

describe("rerouting a hop by dragging a segment", () => {
  for (const view of ["plan", "iso"] as const) {
    it.live(
      `drags the h-store segment in ${view} view, snapped to half units, and both views then draw the new route`,
      () =>
        Effect.gen(function* () {
          const { home, page, errors } = yield* servedReview;

          yield* toView(page, view);

          const unit = yield* unitOnScreen(page, view);
          const segments = yield* segmentsOf(page, "h-store");

          // h-store is one straight leg down along y, from (9, 2) to (9, 6).
          assert.deepStrictEqual(segments, [{ segment: 0, axis: "y" }]);

          const from = yield* middleOf(page, segmentSelector("h-store", 0));

          // 1.2 units along +x, which snaps to 1, moves the leg to x 10 and
          // jogs its ends out along the edges.
          yield* dragBy(page, from, screenDelta(view, unit, { x: 1.2, y: 0 }));

          const saved = yield* waitForRevision(home, 1);
          const [change] = reroutesIn(saved);

          assert.strictEqual(saved.layout.length, 1);
          assert.strictEqual(change?.kind, "reroute");
          assert.deepStrictEqual(change?.target, {
            kind: "hop",
            id: "h-store",
          });

          const points = change?.points ?? [];

          assert.isAbove(points.length, 1);
          assert.isTrue(
            Arr.every(
              points,
              ({ x, y }) => Number.isInteger(x * 2) && Number.isInteger(y * 2)
            )
          );
          // The route starts on the server's edge and ends on the store's.
          assert.strictEqual(points[0]?.y, 2);
          assert.strictEqual(points.at(-1)?.y, 6);
          assert.strictEqual(points[0]?.x, points.at(-1)?.x);
          assert.isTrue(
            Arr.some(
              points,
              ({ x }) => x === 10 || x === (points[0]?.x ?? 0) + 1
            )
          );

          yield* waitFor(page, '[data-hop-pending="h-store"]');

          // Both views draw the same route: the saved points, on the ground.
          const other = view === "plan" ? "iso" : "plan";
          const inThisView = yield* drawnRoute(page, "h-store", view);

          yield* toView(page, other);
          yield* waitFor(page, '[data-hop-pending="h-store"]');

          const inOther = yield* drawnRoute(page, "h-store", other);

          assert.deepStrictEqual(inThisView, points);
          assert.deepStrictEqual(inOther, points);
          assert.deepStrictEqual(errors, []);
        }),
      90_000
    );
  }

  it.live(
    "shows a cursor for each segment's drag axis, and takes a press just off the line",
    () =>
      Effect.gen(function* () {
        const { page } = yield* servedReview;

        for (const view of ["plan", "iso"] as const) {
          yield* toView(page, view);

          const cursors = yield* Effect.promise(() =>
            page.evaluate<readonly { cursor: string; axis: string }[]>(
              `[...document.querySelectorAll('[data-route-segment][data-hop-id="h-store"]')].map((line) => ({ cursor: getComputedStyle(line).cursor, axis: line.getAttribute("data-axis") }))`
            )
          );

          // A segment along y is dragged along x.
          assert.deepStrictEqual(
            cursors,
            [
              {
                cursor: view === "plan" ? "ew-resize" : "nwse-resize",
                axis: "y",
              },
            ],
            view
          );
        }

        // h-store's leg runs straight down in Plan view. A press 3.5 drawing
        // units beside it is off the drawn line, and still drags it.
        yield* toView(page, "plan");

        const middle = yield* middleOf(page, segmentSelector("h-store", 0));
        const unit = yield* unitOnScreen(page, "plan");

        const scale = Number(
          yield* attribute(page, "svg[data-scale]", "data-scale")
        );

        yield* pressAndMove(
          page,
          { x: middle.x + 3.5 * scale, y: middle.y },
          screenDelta("plan", unit, { x: 1, y: 0 })
        );
        yield* waitFor(page, '[data-route-preview="h-store"]');
        yield* Effect.promise(() => page.mouse.up());
      }),
    60_000
  );

  it.live(
    "accepting a reroute clears its pending look, and 'Reset route' in the Pending tab then adds a reset as a pending change",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* servedReview;

        yield* toView(page, "plan");

        const unit = yield* unitOnScreen(page, "plan");
        const from = yield* middleOf(page, segmentSelector("h-store", 0));

        yield* dragBy(page, from, screenDelta("plan", unit, { x: 1, y: 0 }));
        yield* waitForRevision(home, 1);
        yield* waitFor(page, '[data-hop-pending="h-store"]');

        yield* Effect.promise(() =>
          page.locator('[role="tab"][data-tab="pending"]').click()
        );
        yield* waitFor(page, '[data-pending-change="reroute"]');
        yield* Effect.promise(() =>
          page.getByRole("button", { name: /^Accept the reroute of/u }).click()
        );
        yield* waitFor(page, '[data-saved-revision="1"]');

        // Accepting takes the change out of proposals.json, and the hop
        // loses its pending look.
        assert.deepStrictEqual((yield* waitForRevision(home, 2)).layout, []);
        yield* waitGone(page, "[data-hop-pending]");
        yield* waitFor(page, '[data-route-override="h-store"]');

        // check passes on what was written.
        const checked = yield* runCli(home, ["check", home]);

        assert.strictEqual(checked.exitCode, 0, checked.stdout);

        yield* Effect.promise(() =>
          page.locator('[data-reset-route="h-store"]').click()
        );

        const saved = yield* waitForRevision(home, 3);

        assert.deepStrictEqual(
          Arr.map(reroutesIn(saved), ({ points }) => points),
          [null]
        );
        yield* waitFor(page, '[data-pending-change="reroute"]');
        assert.include(
          (yield* Effect.promise(() =>
            page.locator('[data-pending-change="reroute"]').textContent()
          )) ?? "",
          "reset to automatic routing"
        );
      }),
    90_000
  );

  it.live(
    "'Reset route' in the hop's panel lists the same action, and discarding the reset restores the override",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* servedReview;

        yield* toView(page, "plan");

        const unit = yield* unitOnScreen(page, "plan");
        const from = yield* middleOf(page, segmentSelector("h-store", 0));

        yield* dragBy(page, from, screenDelta("plan", unit, { x: 1, y: 0 }));
        yield* waitForRevision(home, 1);

        // Clicking the hop's long segment pins the hop and opens its panel.
        const long = yield* middleOf(page, segmentSelector("h-store", 2));

        yield* Effect.promise(() => page.mouse.click(long.x, long.y));
        yield* waitFor(page, '[data-hop-panel="h-store"]');
        yield* Effect.promise(() =>
          page.locator('[data-hop-panel="h-store"] [data-reset-route]').click()
        );

        // The hop only had a pending override, so the reset drops that
        // change instead of adding one.
        const saved = yield* waitForRevision(home, 2);

        assert.deepStrictEqual(saved.layout, []);
        yield* waitGone(page, '[data-hop-pending="h-store"]');
      }),
    90_000
  );
});

const waitingForAgent = "waiting for the agent";

describe("a reroute in the review loop", () => {
  /** Drags h-store right, then sends it to the agent with Ready for review. */
  const frozenReroute = Effect.gen(function* () {
    const opened = yield* servedReview;
    const { home, page } = opened;

    yield* toView(page, "plan");

    const unit = yield* unitOnScreen(page, "plan");
    const from = yield* middleOf(page, segmentSelector("h-store", 0));

    yield* dragBy(page, from, screenDelta("plan", unit, { x: 1, y: 0 }));
    yield* waitForRevision(home, 1);
    yield* Effect.promise(() =>
      page.locator("[data-ready-for-review]").first().click()
    );
    yield* waitFor(page, "[data-review-dialog][open]");
    yield* Effect.promise(() =>
      page.locator("[data-review-close]").first().click()
    );

    return opened;
  });

  it.live(
    "refuses Reset route, a new route and a discard while the reroute waits for the agent",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* frozenReroute;

        // The frozen reroute is still drawn, as pending.
        yield* waitFor(page, '[data-hop-pending="h-store"]');

        // A new drag of the same hop is refused, with the waiting message.
        const unit = yield* unitOnScreen(page, "plan");
        const from = yield* middleOf(page, segmentSelector("h-store", 2));

        yield* pressAndMove(
          page,
          from,
          screenDelta("plan", unit, { x: 1, y: 0 })
        );
        assert.strictEqual(
          yield* attribute(
            page,
            '[data-route-preview="h-store"]',
            "data-refused"
          ),
          "true"
        );
        assert.include(
          (yield* Effect.promise(() =>
            page.locator("[data-route-preview] title").first().textContent()
          )) ?? "",
          "waiting for the agent"
        );
        yield* Effect.promise(() => page.mouse.up());

        // Reset route, from the hop's panel and from the Pending list.
        yield* Effect.promise(() =>
          page.locator('[role="tab"][data-tab="pending"]').click()
        );
        yield* waitFor(page, '[data-reset-route="h-store"]');
        yield* Effect.promise(() =>
          page.locator('[data-reset-route="h-store"]').first().click()
        );
        yield* waitFor(page, "[data-discard-refused]");
        assert.include(
          (yield* Effect.promise(() =>
            page.locator("[data-discard-refused]").first().textContent()
          )) ?? "",
          "waiting for the agent"
        );

        // Nothing but the freeze was written.
        const saved = Option.getOrThrow(yield* proposalsIn(home));

        assert.deepStrictEqual(saved.layout, []);
        assert.strictEqual(saved.batches?.length, 1);
      }),
    120_000
  );

  it.live(
    "refuses a group drag that would carry a frozen route along, with the waiting message",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* frozenReroute;

        // The reroute sits in layout changes as pending (frozen). A drag of
        // the whole loop group would shift h-store's override with it, a new
        // reroute of a hop that is waiting for the agent.
        yield* waitFor(page, '[data-hop-pending="h-store"]');

        const unit = yield* unitOnScreen(page, "plan");
        const from = yield* middleOf(page, '[data-zone-title-hit="loop"]');

        yield* pressAndMove(
          page,
          from,
          screenDelta("plan", unit, { x: 0, y: 2 })
        );
        yield* waitFor(page, "[data-drag-refusal]");

        assert.include(
          (yield* Effect.promise(() =>
            page.locator("[data-drag-refusal]").first().textContent()
          )) ?? "",
          waitingForAgent
        );

        yield* Effect.promise(() => page.mouse.up());

        // The drop wrote nothing but the freeze.
        const saved = Option.getOrThrow(yield* proposalsIn(home));

        assert.deepStrictEqual(saved.layout, []);
      }),
    120_000
  );

  it.live(
    "once the agent commits a frozen reroute, Reset route works again",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* frozenReroute;
        const batch = Option.getOrThrow(yield* proposalsIn(home)).batches?.[0];
        const itemId = batch?.items[0]?.id ?? "";

        for (const args of [
          ["verdict", home, itemId, "accepted"],
          ["commit", home],
        ]) {
          const result = yield* runCli(home, args);

          assert.strictEqual(result.exitCode, 0, result.stderr);
        }

        yield* Effect.promise(() =>
          page.locator('[role="tab"][data-tab="pending"]').click()
        );

        // The page hears of the commit over its event stream. Until it has,
        // the reroute is still frozen and a reset would be refused.
        yield* waitGone(page, '[data-review-state="frozen"]');
        yield* waitFor(page, '[data-route-override="h-store"]');
        yield* Effect.promise(() =>
          page.locator('[data-reset-route="h-store"]').first().click()
        );

        // The reroute's write made revision 1, the freeze 2, the verdict 3,
        // the commit 4, and the reset 5.
        const after = yield* waitForRevision(home, 5);

        assert.deepStrictEqual(
          Arr.map(reroutesIn(after), ({ points }) => points),
          [null]
        );
      }).pipe(Effect.provide(NodeServices.layer)),
    120_000
  );
});

const loopMembers = ["page", "proposals", "pull-request", "server"];

describe("moving a group by its zone title", () => {
  for (const view of ["plan", "iso"] as const) {
    it.live(
      `drags the loop zone's title in ${view} view and moves every member as one change, snapped to half units`,
      () =>
        Effect.gen(function* () {
          const { home, page, errors } = yield* servedReview;

          yield* toView(page, view);

          const unit = yield* unitOnScreen(page, view);
          const title = '[data-zone-title-hit="loop"]';

          yield* waitFor(page, title);

          const from = yield* middleOf(page, title);

          // 0.4 along x snaps to 0.5, and 2.2 along y to 2.
          yield* dragBy(
            page,
            from,
            screenDelta(view, unit, { x: 0.4, y: 2.2 })
          );

          const saved = yield* waitForRevision(home, 1);
          const [change] = saved.layout;

          assert.strictEqual(saved.layout.length, 1);
          assert.strictEqual(change?.kind, "move");

          const moved: readonly StructureMove[] =
            change?.kind === "move" ? change.moves : [];

          // One change covers every member of the group, including those
          // the chapter hasn't revealed, and nothing outside it.
          assert.deepStrictEqual(
            Arr.sort(
              Arr.map(moved, ({ target }) => target.id),
              Order.String
            ),
            loopMembers
          );

          const byId = Order.mapInput(
            Order.String,
            ({ target }: StructureMove) => target.id
          );

          assert.deepStrictEqual(
            Arr.map(Arr.sort(moved, byId), ({ position }) => position),
            [
              { x: 4.5, y: 2 },
              { x: 8.5, y: 8 },
              { x: 12.5, y: 8 },
              { x: 8.5, y: 2 },
            ]
          );

          // One undo takes the whole group back.
          yield* Effect.promise(() => page.keyboard.press("Control+z"));

          const undone = yield* waitForRevision(home, 2);

          assert.deepStrictEqual(undone.layout, []);
          assert.deepStrictEqual(errors, []);
        }),
      90_000
    );
  }
});

describe("text while dragging", () => {
  // The proposals store has hops at both ends whose labels the last chapter
  // draws, so they would lie on the tags and zone around it.
  const spots = {
    structure: () =>
      ({
        selector: '[data-structure="proposals"]',
        by: { x: -1.5, y: -2 },
      }) as const,
    group: () =>
      ({
        selector: '[data-zone-title-hit="loop"]',
        by: { x: 0.5, y: 2 },
      }) as const,
  };

  for (const [what, spot] of [
    ["a group", spots.group()],
    ["a structure", spots.structure()],
  ] as const) {
    it.live(
      `no visible text lies on another while ${what} is dragged, in either view, and hop labels return after the drop`,
      () =>
        Effect.gen(function* () {
          const { home, page } = yield* servedReview;
          const before = yield* overlappingTexts(page);

          // The overlaps the map already had don't count; the drag adds none.
          const added = Effect.map(overlappingTexts(page), (now) =>
            Arr.filter(now, (pair) => !Arr.contains(before, pair))
          );

          // In Plan view, then undone and dragged again in the Iso view.
          for (const [view, revision] of [
            ["plan", 1],
            ["iso", 3],
          ] as const) {
            if (revision > 1) {
              yield* Effect.promise(() => page.keyboard.press("Control+z"));
              yield* waitForRevision(home, revision - 1);
            }

            yield* toView(page, view);

            const unit = yield* unitOnScreen(page, view);
            const from = yield* middleOf(page, spot.selector);

            yield* pressAndMove(page, from, screenDelta(view, unit, spot.by));
            yield* Effect.sleep("300 millis");

            assert.deepStrictEqual(yield* added, [], `${view} view`);

            // Labels of hops with an end on what moves are hidden.
            assert.isAbove(
              yield* count(page, "[data-hop-label][data-drag-hidden]"),
              0,
              `${view} view`
            );

            yield* Effect.promise(() => page.mouse.up());
            yield* waitForRevision(home, revision);
            yield* waitGone(page, "[data-drag-hidden]");
            assert.deepStrictEqual(yield* added, [], `${view} view, dropped`);
          }
        }),
      120_000
    );
  }

  it.live(
    "a resize hides the labels of the hops at the resized structure",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* servedReview;

        yield* toView(page, "plan");
        yield* Effect.promise(() =>
          page.locator('[data-structure="proposals"]').click()
        );
        yield* waitFor(page, '[data-resize-handle="se"]');

        const unit = yield* unitOnScreen(page, "plan");
        const from = yield* middleOf(page, '[data-resize-handle="se"]');

        yield* pressAndMove(page, from, { x: unit, y: unit });
        yield* Effect.sleep("300 millis");

        const hiddenFor = yield* Effect.promise(() =>
          page.evaluate<readonly string[]>(
            `[...document.querySelectorAll("[data-hop-label][data-drag-hidden]")].map((label) => label.getAttribute("data-hop-label"))`
          )
        );

        assert.deepStrictEqual(Arr.sort(hiddenFor, Order.String), [
          "h-pr",
          "h-store",
        ]);
        yield* Effect.promise(() => page.mouse.up());
        yield* waitForRevision(home, 1);
        yield* waitGone(page, "[data-drag-hidden]");
      })
  );
});

/** The boxes, on screen, of everything a drag mustn't be covered by. */
const drawingBoxes = (page: Page) =>
  Effect.promise(() =>
    page.evaluate<
      readonly {
        name: string;
        left: number;
        top: number;
        right: number;
        bottom: number;
      }[]
    >(`(() => {
      const rect = (name, element) => {
        const box = element.getBoundingClientRect();

        return { name, left: box.left, top: box.top, right: box.right, bottom: box.bottom };
      };

      return [
        ...[...document.querySelectorAll("[data-structure]")].map((element) =>
          rect("structure:" + element.getAttribute("data-structure"), element)
        ),
        ...[...document.querySelectorAll("[data-name-tag] text")].map((element) =>
          rect("tag:" + element.textContent, element)
        ),
        ...[...document.querySelectorAll("[data-hop-label]")]
          .filter((element) => getComputedStyle(element).visibility !== "hidden")
          .map((element) => rect("label:" + element.getAttribute("data-hop-label"), element)),
        ...[...document.querySelectorAll("[data-zone-title]")].map((element) =>
          rect("title:" + element.textContent, element)
        ),
      ];
    })()`)
  );

const panelBox = (page: Page) =>
  Effect.promise(() =>
    page.locator("[data-drag-warnings]").first().boundingBox()
  );

describe("the warnings panel", () => {
  it.live(
    "stays inside the side panel, keeps the heading in view while a long list scrolls, and reaches its last line",
    () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const files = yield* fullMap;
        const layoutFile = "review/map/layout.json";
        const saved = yield* decodeLayout(files[layoutFile] ?? "");

        // Four structures stacked on one spot's tags give check many
        // warnings before the drag begins.
        const root = yield* makeHome({
          ...files,
          [layoutFile]: yield* Schema.encodeEffect(LayoutFile)({
            ...saved,
            structures: {
              ...saved.structures,
              "pull-request": { x: 12, y: 3, w: 2, d: 1.5 },
              proposals: { x: 8, y: 3, w: 2, d: 2 },
            },
          }),
        });

        const home = path.join(root, "review", "map");
        const serve = yield* startServe(home, ["--port", "0"]);
        const { page } = yield* openUrl(serve.url);

        // A short window, so the warnings outgrow the panel's cap.
        yield* Effect.promise(() =>
          page.setViewportSize({ width: 1280, height: 480 })
        );
        yield* Effect.promise(() =>
          page
            .locator('[data-chapter-rail] button[data-chapter="c-all"]')
            .click()
        );
        yield* toView(page, "plan");

        const unit = yield* unitOnScreen(page, "plan");
        const from = yield* middleOf(page, segmentSelector("h-store", 0));

        yield* pressAndMove(
          page,
          from,
          screenDelta("plan", unit, { x: 0.5, y: 0 })
        );
        yield* waitFor(page, "[data-drag-warning]");

        const measure = () =>
          Effect.promise(() =>
            page.evaluate<{
              panel: { top: number; bottom: number };
              aside: { top: number; bottom: number };
              heading: { top: number; bottom: number };
              list: {
                top: number;
                bottom: number;
                scrolls: boolean;
                scrollTop: number;
              };
              last: { top: number; bottom: number };
            }>(`(() => {
              const box = (element) => { const b = element.getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; };
              const panel = document.querySelector("[data-drag-warnings]");
              const list = panel.querySelector("[data-drag-warnings-list]");
              const items = panel.querySelectorAll("[data-drag-warning]");

              return {
                panel: box(panel),
                aside: box(document.querySelector("[data-side-panel]")),
                heading: box(panel.querySelector("[data-drag-warnings-heading]")),
                list: { ...box(list), scrolls: list.scrollHeight > list.clientHeight, scrollTop: list.scrollTop },
                last: box(items[items.length - 1]),
              };
            })()`)
          );

        const before = yield* measure();

        // The panel stays inside the side panel, and leaves room under it.
        assert.isAtLeast(before.panel.top, before.aside.top);
        assert.isAtMost(before.panel.bottom, before.aside.bottom + 0.5);
        assert.isBelow(
          before.panel.bottom - before.panel.top,
          before.aside.bottom - before.aside.top
        );

        // The warnings don't all fit, so the list scrolls.
        assert.isTrue(before.list.scrolls);
        assert.isAbove(before.last.bottom, before.list.bottom + 0.5);

        // Scroll the list to its end: the last line lies inside the list,
        // with the heading where it was.
        yield* Effect.promise(() =>
          page.evaluate(
            `(() => { const list = document.querySelector("[data-drag-warnings-list]"); list.scrollTop = list.scrollHeight; })()`
          )
        );

        const after = yield* measure();

        assert.isAbove(after.list.scrollTop, before.list.scrollTop);
        assert.isAtLeast(after.last.top, after.list.top - 0.5);
        assert.isAtMost(after.last.bottom, after.list.bottom + 0.5);
        assert.isAtMost(after.last.bottom, after.aside.bottom + 0.5);
        assert.deepStrictEqual(after.heading, before.heading);
        assert.isAtLeast(after.heading.top, after.panel.top);

        yield* Effect.promise(() => page.mouse.up());
      }).pipe(Effect.provide(NodeServices.layer)),
    120_000
  );
});

/**
 * How far hop `hop`'s label box sits from the line through `route`, a
 * `data-route` value, in drawing units.
 */
const labelGapTo = (page: Page, hop: string, route: string) =>
  Effect.promise(() =>
    page.evaluate<number>(`(() => {
      const label = document.querySelector('[data-hop-label="${hop}"]').getBoundingClientRect();
      const scale = Number(document.querySelector("svg[data-scale]").getAttribute("data-scale"));
      const matrix = document.querySelector('[data-hop="${hop}"]').getScreenCTM();
      const points = ${literal(route)}.split(" ").map((pair) => pair.split(",").map(Number)).map(([x, y]) => ({ x: x * matrix.a + y * matrix.c + matrix.e, y: x * matrix.b + y * matrix.d + matrix.f }));
      let least = Infinity;

      for (let index = 0; index + 1 < points.length; index++) {
        const [a, b] = [points[index], points[index + 1]];

        for (let step = 0; step <= 40; step++) {
          const x = a.x + ((b.x - a.x) * step) / 40;
          const y = a.y + ((b.y - a.y) * step) / 40;
          const dx = Math.max(label.left - x, 0, x - label.right);
          const dy = Math.max(label.top - y, 0, y - label.bottom);

          least = Math.min(least, Math.hypot(dx, dy));
        }
      }

      return least / scale;
    })()`)
  );

describe("a rerouted hop's label", () => {
  it.live(
    "is placed beside the rerouted points, not the old route, in Plan view",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* servedReview;

        yield* toView(page, "plan");

        const old =
          (yield* attribute(page, '[data-hop="h-store"]', "data-route")) ?? "";

        const unit = yield* unitOnScreen(page, "plan");
        const from = yield* middleOf(page, segmentSelector("h-store", 0));

        // Two units right takes the leg well clear of where it was.
        yield* dragBy(page, from, screenDelta("plan", unit, { x: 2, y: 0 }));
        yield* waitForRevision(home, 1);
        yield* waitFor(page, '[data-hop-pending="h-store"]');
        yield* waitFor(page, '[data-hop-label="h-store"]');

        const rerouted =
          (yield* attribute(page, '[data-hop="h-store"]', "data-route")) ?? "";

        assert.notStrictEqual(rerouted, old);

        const toNew = yield* labelGapTo(page, "h-store", rerouted);
        const toOld = yield* labelGapTo(page, "h-store", old);

        // The scene sets a label beside its leg at least 3 drawing units
        // away, never touching it. The Iso view may put it on the line
        // instead, on a paper backing, so only Plan view has a gap to
        // measure.
        assert.isAbove(toNew, 2.5);
        assert.isBelow(toNew, toOld);
      }),
    90_000
  );
});

describe("the panel for what a drag would leave", () => {
  it.live(
    "lists what check would print for a drag of one structure, and for a resize",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { home, page } = yield* servedReview;
        const layoutPath = path.join(home, "layout.json");

        const accepted = yield* decodeLayout(
          yield* fs.readFileString(layoutPath)
        );

        yield* toView(page, "plan");

        const unit = yield* unitOnScreen(page, "plan");

        // Drag the proposals store up under the server's tag: the tag then
        // sits on a box, which check reports.
        const store = yield* middleOf(page, '[data-structure="proposals"]');

        yield* pressAndMove(
          page,
          store,
          screenDelta("plan", unit, { x: 0, y: -2.5 })
        );
        yield* waitFor(page, "[data-drag-warning]");

        const whileMoving = yield* warningsOf(page);

        yield* Effect.promise(() => page.mouse.up());
        yield* waitGone(page, "[data-drag-warnings]");

        const moved = yield* waitForRevision(home, 1);

        // Undo the move, then resize the server out to where it covers the
        // tags around it.
        yield* Effect.promise(() => page.keyboard.press("Control+z"));
        yield* waitForRevision(home, 2);
        yield* Effect.promise(() =>
          page.locator('[data-structure="server"]').click()
        );
        yield* waitFor(page, '[data-resize-handle="se"]');

        const corner = yield* middleOf(page, '[data-resize-handle="se"]');

        yield* pressAndMove(
          page,
          corner,
          screenDelta("plan", unit, { x: 0.5, y: 3.5 })
        );
        yield* waitFor(page, "[data-drag-warning]");

        const whileResizing = yield* warningsOf(page);

        yield* Effect.promise(() => page.mouse.up());

        const resized = yield* waitForRevision(home, 3);

        // Each list against what check prints for the layout its drop left.
        const placedAfter = (changes: Proposals["layout"]) =>
          Arr.reduce(changes, accepted.structures, (structures, change) => {
            if (change.kind === "move") {
              return Arr.reduce(
                change.moves,
                structures,
                (all, { target, position }) => {
                  const at = all[target.id];

                  return at === undefined
                    ? all
                    : { ...all, [target.id]: { ...at, ...position } };
                }
              );
            }

            if (change.kind === "resize") {
              const at = structures[change.target.id];

              return at === undefined
                ? structures
                : {
                    ...structures,
                    [change.target.id]: { ...at, ...change.footprint },
                  };
            }

            return structures;
          });

        // The layout is written as accepting the changes would leave it,
        // with nothing left pending, so check reads that layout alone.
        const checkedAfter = Effect.fnUntraced(function* (
          changes: Proposals["layout"]
        ) {
          yield* fs.writeFileString(
            layoutPath,
            yield* Schema.encodeEffect(LayoutFile)({
              ...accepted,
              structures: placedAfter(changes),
            })
          );
          yield* fs.writeFileString(
            path.join(home, "proposals.json"),
            yield* Schema.encodeEffect(Schema.fromJsonString(Proposals))({
              format: 1,
              revision: resized.revision + 1,
              layout: [],
            })
          );

          const printed = yield* runCli(home, ["check", "--json", home]);

          return Arr.sort(
            Arr.map((yield* decodeReport(printed.stdout)).warnings, (problem) =>
              placed({
                message: problem.message,
                where:
                  problem.path === ""
                    ? problem.file
                    : `${problem.file} ${problem.path}`,
              })
            ),
            Order.String
          );
        });

        assert.isNotEmpty(whileMoving);
        assert.isNotEmpty(whileResizing);
        assert.deepStrictEqual(
          asShown(whileMoving),
          yield* checkedAfter(moved.layout)
        );
        assert.deepStrictEqual(
          asShown(whileResizing),
          yield* checkedAfter(resized.layout)
        );
      }).pipe(Effect.provide(NodeServices.layer)),
    120_000
  );

  it.live(
    "shows the reason in the panel when a drop would be refused, with the fix in words",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* servedReview;

        yield* toView(page, "plan");

        const unit = yield* unitOnScreen(page, "plan");
        const from = yield* middleOf(page, segmentSelector("h-store", 0));

        // Give h-store an override and accept it, so a move of its end
        // structure is a move that would leave it off its footprint.
        yield* dragBy(page, from, screenDelta("plan", unit, { x: 1, y: 0 }));
        yield* waitForRevision(home, 1);
        yield* Effect.promise(() =>
          page.locator('[role="tab"][data-tab="pending"]').click()
        );
        yield* Effect.promise(() => page.locator("[data-accept-all]").click());
        yield* waitFor(page, "[data-saved-revision]");

        // Move the proposals store down: the override's last point is no
        // longer on its edge, which check reports as an error.
        const store = yield* middleOf(page, '[data-structure="proposals"]');

        yield* pressAndMove(
          page,
          store,
          screenDelta("plan", unit, { x: 0, y: 2.5 })
        );
        yield* waitFor(page, "[data-drag-refusal]");

        const reason =
          (yield* Effect.promise(() =>
            page.locator("[data-drag-refusal]").first().textContent()
          )) ?? "";

        assert.include(reason, 'Reset the route of hop "h-store" first');
        assert.include(reason, "check reports as an error");

        // The panel says it in the open, not in a tooltip, and nothing is
        // listed as a warning meanwhile.
        assert.strictEqual(yield* count(page, "[data-drag-warning]"), 0);
        yield* Effect.promise(() => page.mouse.up());
        yield* waitGone(page, "[data-drag-warnings]");
      }),
    120_000
  );

  it.live(
    "stays off the drawing: it covers no structure, tag, label or title",
    () =>
      Effect.gen(function* () {
        const { page } = yield* servedReview;

        yield* toView(page, "plan");

        const unit = yield* unitOnScreen(page, "plan");
        const from = yield* middleOf(page, segmentSelector("h-store", 0));

        yield* pressAndMove(
          page,
          from,
          screenDelta("plan", unit, { x: 4, y: 0 })
        );
        yield* waitFor(page, "[data-drag-warning]");

        const panel = yield* panelBox(page);

        assert.isNotNull(panel);

        const covered = Arr.filter(
          yield* drawingBoxes(page),
          (box) =>
            panel !== null &&
            box.left < panel.x + panel.width &&
            panel.x < box.right &&
            box.top < panel.y + panel.height &&
            panel.y < box.bottom
        );

        assert.deepStrictEqual(
          Arr.map(covered, ({ name }) => name),
          []
        );
        yield* Effect.promise(() => page.mouse.up());
      }),
    90_000
  );
});

describe("a group drag's hops", () => {
  it.live(
    "hides the lines, heads and packets of hops at a moving structure, not only their labels, and shows them again on the drop",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* servedReview;

        yield* toView(page, "plan");

        const unit = yield* unitOnScreen(page, "plan");
        const from = yield* middleOf(page, '[data-zone-title-hit="loop"]');

        yield* pressAndMove(
          page,
          from,
          screenDelta("plan", unit, { x: 0.5, y: 2 })
        );
        yield* Effect.sleep("300 millis");

        /** The hops or packets matching `selector` that paint now. */
        const painted = (selector: string) =>
          Effect.promise(() =>
            page.evaluate<readonly string[]>(
              `[...document.querySelectorAll(${literal(selector)})].filter((element) => getComputedStyle(element).visibility !== "hidden").map((element) => element.getAttribute("data-hop") ?? element.getAttribute("data-packet") ?? "")`
            )
          );

        // Every hop has an end in the loop group, so no hop line or head
        // paints while it moves: h-note ends at the page.
        assert.deepStrictEqual(yield* painted("[data-hop]"), []);
        assert.deepStrictEqual(
          yield* painted("[data-hop] [data-arrowhead]"),
          []
        );

        // A packet walks the old route, so it goes with its hop. It moves
        // from hop to hop as its run goes on, so look at a few moments of
        // the drag, not one.
        for (let look = 0; look < 3; look++) {
          assert.deepStrictEqual(
            yield* painted("[data-packet]"),
            [],
            `look ${look}`
          );
          yield* Effect.sleep("350 millis");
        }

        yield* Effect.promise(() => page.mouse.up());
        yield* waitForRevision(home, 1);
        yield* waitGone(page, "[data-drag-hidden]");
        assert.lengthOf(yield* painted("[data-hop]"), 4);
      }),
    120_000
  );
});

describe("the warnings while dragging", () => {
  it.live(
    "show the same text that check prints for the layout the drop would leave",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { home, page } = yield* servedReview;

        yield* toView(page, "plan");

        const unit = yield* unitOnScreen(page, "plan");
        const from = yield* middleOf(page, segmentSelector("h-store", 0));

        // The review map is clean to begin with, as check says.
        const before = yield* runCli(home, ["check", home]);

        assert.include(before.stdout, ": 0 errors, 0 warnings.");

        // Pull h-store's leg 4 units along x, to x 13, which runs under the
        // pull request at x 12–14, y 6–7.5.
        yield* pressAndMove(
          page,
          from,
          screenDelta("plan", unit, { x: 4, y: 0 })
        );
        yield* waitFor(page, "[data-drag-warning]");

        const shown = yield* warningsOf(page);

        const dropped = yield* attribute(
          page,
          '[data-route-preview="h-store"]',
          "data-refused"
        );

        assert.strictEqual(dropped, "false");
        assert.isAbove(shown.length, 0);

        yield* Effect.promise(() => page.mouse.up());

        const saved = yield* waitForRevision(home, 1);
        const [change] = reroutesIn(saved);

        // Write that route into layout.json, as accepting it would, and run
        // check on the result.
        const layout = yield* decodeLayout(
          yield* fs.readFileString(path.join(home, "layout.json"))
        );

        yield* fs.writeFileString(
          path.join(home, "layout.json"),
          yield* Schema.encodeEffect(LayoutFile)({
            ...layout,
            routes: { "h-store": change?.points ?? [] },
          })
        );

        const printed = yield* runCli(home, ["check", "--json", home]);

        const report = yield* decodeReport(printed.stdout);

        // The page shows check's problems as objects: the message, and the
        // file and field under it. Same problems, not check's printed line.
        assert.deepStrictEqual(
          Arr.sort(Arr.map(shown, placed), Order.String),
          Arr.sort(
            Arr.map(report.warnings, (problem) =>
              placed({
                message: problem.message,
                where:
                  problem.path === ""
                    ? problem.file
                    : `${problem.file} ${problem.path}`,
              })
            ),
            Order.String
          )
        );

        for (const item of shown) {
          assert.notInclude(item.message, "warning layout.json");
        }

        // Every warning check reports is listed, and the ones this drag made
        // are marked: the review map had none before, so all are new.
        assert.isTrue(Arr.every(shown, ({ isNew }) => isNew));
      }).pipe(Effect.provide(NodeServices.layer)),
    120_000
  );

  it.live(
    "show nothing while a drag leaves the layout as clean as it was",
    () =>
      Effect.gen(function* () {
        const { page } = yield* servedReview;

        yield* toView(page, "plan");

        const unit = yield* unitOnScreen(page, "plan");
        const from = yield* middleOf(page, segmentSelector("h-store", 0));

        yield* pressAndMove(
          page,
          from,
          screenDelta("plan", unit, { x: 0.5, y: 0 })
        );
        yield* Effect.sleep("600 millis");

        assert.strictEqual(yield* count(page, "[data-drag-warnings]"), 0);
        yield* Effect.promise(() => page.mouse.up());
      })
  );

  it.live(
    "also show for a group drag, and go when the drag ends",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* servedReview;

        yield* toView(page, "plan");

        const unit = yield* unitOnScreen(page, "plan");
        const from = yield* middleOf(page, '[data-zone-title-hit="loop"]');

        // Moving the loop group 8 units along x puts its zone on the outside
        // group's, which check reports as overlapping zones.
        yield* pressAndMove(
          page,
          from,
          screenDelta("plan", unit, { x: 7, y: 0 })
        );
        yield* waitFor(page, "[data-drag-warning]");

        const shown = yield* warningsOf(page);

        assert.isTrue(
          Arr.some(shown, ({ message }) =>
            Str.includes("zones of groups")(message)
          )
        );

        yield* Effect.promise(() => page.mouse.up());
        yield* waitForRevision(home, 1);
        yield* waitGone(page, "[data-drag-warning]");
      }),
    90_000
  );
});
