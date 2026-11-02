import {
  LayoutFile,
  MapProblem,
  Proposals,
  Revision,
} from "@axonometric/contracts";
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

const decodeRevision = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Revision)
);

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
    page.evaluate<readonly { message: string; where: string }[]>(
      `[...document.querySelectorAll("[data-drag-warning]")].map((item) => ({ message: item.querySelector("[data-warning-message]").textContent, where: item.querySelector("[data-warning-where]").textContent }))`
    )
  );

const CheckWarnings = Schema.Struct({ warnings: Schema.Array(MapProblem) });

const decodeReport = Schema.decodeEffect(Schema.fromJsonString(CheckWarnings));

/** A warning as one string, for comparing lists of them. */
const placed = (item: { message: string; where: string }) =>
  `${item.where}|${item.message}`;

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
    "shows a wide hit line over every segment, with a cursor for its drag axis",
    () =>
      Effect.gen(function* () {
        const { page } = yield* servedReview;

        for (const view of ["plan", "iso"] as const) {
          yield* toView(page, view);

          const cursors = yield* Effect.promise(() =>
            page.evaluate<
              readonly { cursor: string; width: string; axis: string }[]
            >(
              `[...document.querySelectorAll('[data-route-segment][data-hop-id="h-store"]')].map((line) => ({ cursor: getComputedStyle(line).cursor, width: getComputedStyle(line).strokeWidth, axis: line.getAttribute("data-axis") }))`
            )
          );

          // A segment along y is dragged along x.
          assert.deepStrictEqual(
            cursors,
            [
              {
                cursor: view === "plan" ? "ew-resize" : "nwse-resize",
                width: "10px",
                axis: "y",
              },
            ],
            view
          );
        }
      }),
    60_000
  );

  it.live(
    "'Reset route' removes the override as a pending change, from the hop's panel",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* servedReview;

        yield* toView(page, "plan");

        const unit = yield* unitOnScreen(page, "plan");
        const from = yield* middleOf(page, segmentSelector("h-store", 0));

        yield* dragBy(page, from, screenDelta("plan", unit, { x: 1, y: 0 }));
        yield* waitForRevision(home, 1);
        yield* waitFor(page, '[data-hop-pending="h-store"]');

        // Accept it, so the override is in layout.json and a reset has
        // something to remove.
        yield* Effect.promise(() =>
          page.locator('[role="tab"][data-tab="pending"]').click()
        );
        yield* Effect.promise(() => page.locator("[data-accept-all]").click());
        yield* waitFor(page, "[data-saved-revision]");

        const routed = yield* Effect.promise(() =>
          page.locator('[data-route-override="h-store"]').count()
        );

        assert.strictEqual(routed, 1);

        yield* Effect.promise(() =>
          page.locator('[data-reset-route="h-store"]').click()
        );

        const saved = yield* waitForRevision(home, 3);
        const [change] = reroutesIn(saved);

        assert.strictEqual(change?.kind, "reroute");
        assert.isNull(change?.points);
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

describe("accepting a reroute", () => {
  it.live(
    "writes the route override to layout.json, saves a revision, and clears the pending look",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { home, page } = yield* servedReview;

        yield* toView(page, "plan");

        const unit = yield* unitOnScreen(page, "plan");
        const from = yield* middleOf(page, segmentSelector("h-store", 0));

        yield* dragBy(page, from, screenDelta("plan", unit, { x: 1, y: 0 }));

        const pending = yield* waitForRevision(home, 1);
        const [change] = reroutesIn(pending);

        yield* Effect.promise(() =>
          page.locator('[role="tab"][data-tab="pending"]').click()
        );
        yield* waitFor(page, '[data-pending-change="reroute"]');
        yield* Effect.promise(() =>
          page.getByRole("button", { name: /^Accept the reroute of/u }).click()
        );
        yield* waitFor(page, '[data-saved-revision="1"]');

        const layout = yield* decodeLayout(
          yield* fs.readFileString(path.join(home, "layout.json"))
        );

        assert.deepStrictEqual(layout.routes?.["h-store"], change?.points);

        const revision = yield* decodeRevision(
          yield* fs.readFileString(path.join(home, "history", "0001.json"))
        );

        assert.include(revision.message, "Reroute");
        assert.deepStrictEqual(
          revision.layout.routes?.["h-store"],
          change?.points
        );
        assert.strictEqual(revision.accepted.length, 1);

        const after = yield* waitForRevision(home, 2);

        assert.deepStrictEqual(after.layout, []);
        yield* waitGone(page, "[data-hop-pending]");

        // check passes on what was written.
        const checked = yield* runCli(home, ["check", home]);

        assert.strictEqual(checked.exitCode, 0, checked.stdout);
      }).pipe(Effect.provide(NodeServices.layer)),
    90_000
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

  it.live(
    "refuses a move that would put a footprint on a structure outside the group",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* servedReview;

        yield* toView(page, "plan");

        const unit = yield* unitOnScreen(page, "plan");
        const from = yield* middleOf(page, '[data-zone-title-hit="people"]');

        // The engineer sits at x 0–2. Moving it 4 along x lands on the page.
        yield* pressAndMove(
          page,
          from,
          screenDelta("plan", unit, { x: 4, y: 0 })
        );

        assert.strictEqual(
          yield* attribute(page, "[data-drag-outline]", "data-refused"),
          "true"
        );

        yield* Effect.promise(() => page.mouse.up());
        yield* waitGone(page, "[data-drag-outline]");
        yield* Effect.sleep("500 millis");

        assert.isTrue(Option.isNone(yield* proposalsIn(home)));
        assert.strictEqual(
          yield* count(page, '[data-structure][data-pending="true"]'),
          0
        );
      }),
    90_000
  );
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

  for (const view of ["plan", "iso"] as const) {
    for (const [what, spot] of [
      ["a group", spots.group()],
      ["a structure", spots.structure()],
    ] as const) {
      it.live(
        `no visible text lies on another while ${what} is dragged in ${view} view, and hop labels return after the drop`,
        () =>
          Effect.gen(function* () {
            const { home, page } = yield* servedReview;

            yield* toView(page, view);

            const unit = yield* unitOnScreen(page, view);
            const from = yield* middleOf(page, spot.selector);
            const before = yield* overlappingTexts(page);

            yield* pressAndMove(page, from, screenDelta(view, unit, spot.by));
            yield* Effect.sleep("300 millis");

            // The overlaps the map already had don't count; the drag adds none.
            const during = yield* overlappingTexts(page);

            assert.deepStrictEqual(
              Arr.filter(during, (pair) => !Arr.contains(before, pair)),
              []
            );

            // Labels of hops with an end on what moves are hidden.
            const hidden = yield* count(
              page,
              "[data-hop-label][data-drag-hidden]"
            );

            assert.isAbove(hidden, 0);

            yield* Effect.promise(() => page.mouse.up());
            yield* waitForRevision(home, 1);
            yield* waitGone(page, "[data-drag-hidden]");
            assert.deepStrictEqual(
              Arr.filter(
                yield* overlappingTexts(page),
                (pair) => !Arr.contains(before, pair)
              ),
              []
            );
          }),
        90_000
      );
    }
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
