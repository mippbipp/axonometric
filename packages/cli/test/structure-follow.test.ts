import { LayoutFile, ReviewReport } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  FileSystem,
  Option,
  Order,
  Path,
  pipe,
  Record as Rec,
  Schema,
  String as Str,
} from "effect";
import type { Locator, Page } from "playwright";

import {
  click,
  count,
  goToChapterPaused,
  literal,
  press,
  textOf,
  waitFor,
  waitTimeout,
} from "./browser.ts";
import { drawingReport, overlap } from "./drawing-report.ts";
import type { DrawingReport } from "./drawing-report.ts";
import { openReviewMap, readProposals, runCli } from "./harness.ts";

// Seam 2, for the gaps: what a proposal adds to check's report, where the add
// form puts a structure and where it sits on the page, dragging a structure
// into another group's zone, and the page following a final id. The review
// map has groups people (engineer), loop (page, server, proposals, pull
// request) and outside (upstream) in a row, so the zones can be made to meet.

const decodeLayout = Schema.decodeUnknownEffect(LayoutFile);

const decodeReview = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ReviewReport)
);

const served = openReviewMap({});

/** Opens chapter `id` with its packets paused, zoomed to fit. */
const chapter = Effect.fnUntraced(function* (page: Page, id: string) {
  yield* goToChapterPaused(page, id);
  yield* press(page, "0");
});

/**
 * Waits until proposals.json in `home` has been written at least once. The
 * page shows an edit as pending before the server has saved it, so a test
 * that reads the file after seeing the pending mark waits here first.
 */
const savedProposals = Effect.fnUntraced(function* (home: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(home, "proposals.json");

  for (let tries = 0; tries < 150; tries++) {
    if (yield* fs.exists(file)) {
      return yield* readProposals(home);
    }

    yield* Effect.sleep("100 millis");
  }

  return assert.fail("proposals.json was never written");
}, Effect.provide(NodeServices.layer));

const report = (page: Page) =>
  Effect.promise(() => page.evaluate<DrawingReport>(drawingReport));

/** The on-screen box of the first element matching `selector`. */
const boxOf = Effect.fnUntraced(function* (page: Page, selector: string) {
  const box = yield* Effect.promise(() =>
    page.locator(selector).first().boundingBox()
  );

  assert.isNotNull(box, selector);

  return box ?? { x: 0, y: 0, width: 0, height: 0 };
});

const rectPolygon = (box: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}) => [
  { x: box.x, y: box.y },
  { x: box.x + box.width, y: box.y },
  { x: box.x + box.width, y: box.y + box.height },
  { x: box.x, y: box.y + box.height },
];

const pendingWait = (page: Page) =>
  Effect.promise(() =>
    page.waitForFunction(
      `document.querySelector('[data-structure][data-pending="true"]') !== null`,
      undefined,
      waitTimeout
    )
  );

const openForm = Effect.fnUntraced(function* (page: Page) {
  yield* click(page, '[data-control="add-structure"]');
  yield* waitFor(page, "[data-add-structure]");
});

/** One warning in the panel: its words, and whether the change made it. */
interface Warning {
  readonly text: string;
  readonly isNew: boolean;
}

/** The attribute `name` of `item`, read in the page. */
const attributeOf = (item: Locator, name: string) =>
  Effect.promise(() => item.getAttribute(name));

const warningOf = (item: Locator) =>
  Effect.all({
    text: Effect.promise(() => item.textContent()),
    isNew: attributeOf(item, "data-warning-new"),
  }).pipe(
    Effect.map(({ text, isNew }): Warning => ({
      text: text ?? "",
      isNew: isNew === "true",
    }))
  );

/** Each warning in the panel beside the map. */
const warnings = Effect.fnUntraced(function* (page: Page) {
  const items = yield* Effect.promise(() =>
    page.locator("[data-drag-warning]").all()
  );

  return yield* Effect.forEach(items, warningOf);
});

/** Whether the candidate footprint's outline is inside the drawing canvas. */
const outlineOnCanvas = Effect.fnUntraced(function* (page: Page) {
  const outline = yield* boxOf(page, "[data-spot-outline]");
  const canvas = yield* boxOf(page, "[data-walkthrough] svg");
  const panel = yield* boxOf(page, "[data-side-panel]");
  const right = Math.min(canvas.x + canvas.width, panel.x);

  return (
    outline.x >= canvas.x - 0.5 &&
    outline.y >= canvas.y - 0.5 &&
    outline.x + outline.width <= right + 0.5 &&
    outline.y + outline.height <= canvas.y + canvas.height + 0.5
  );
});

describe("the add form", () => {
  for (const view of ["iso", "plan"] as const) {
    it.live(
      `keeps the candidate footprint on the canvas for every group, in the ${view} view at 1280×800`,
      () =>
        Effect.gen(function* () {
          const { page } = yield* served;

          yield* chapter(page, "c-all");
          yield* click(page, `[data-view-toggle] [data-view="${view}"]`);
          yield* Effect.promise(() => page.keyboard.press("0"));
          yield* openForm(page);
          yield* Effect.promise(() =>
            page.locator('[data-add="name"]').fill("Build cache")
          );

          for (const group of ["people", "loop", "outside"]) {
            yield* Effect.promise(() =>
              page.locator('[data-add="group"]').selectOption(group)
            );
            yield* Effect.promise(() => page.waitForTimeout(600));
            yield* waitFor(page, "[data-spot-outline]");

            assert.isTrue(yield* outlineOnCanvas(page), `${view} ${group}`);
            assert.strictEqual(
              yield* count(page, "[data-drag-warning][data-warning-new=true]"),
              0,
              `${view} ${group}`
            );
          }
        }),
      90_000
    );
  }

  it.live(
    "starts at a free spot beside the group, so Propose is ready, and follows the group",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* served;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        const { structures } = yield* decodeLayout(
          yield* fs.readFileString(path.join(home, "layout.json"))
        );

        // The review map's groups: people holds the engineer, outside the
        // upstream, and loop the rest.
        const groupOf = new Map([
          ["engineer", "people"],
          ["upstream", "outside"],
        ]);

        yield* chapter(page, "c-all");
        yield* openForm(page);
        yield* Effect.promise(() =>
          page.locator('[data-add="name"]').fill("Build cache")
        );

        const x = () =>
          Effect.promise(() => page.locator('[data-add="x"]').inputValue());

        const y = () =>
          Effect.promise(() => page.locator('[data-add="y"]').inputValue());

        /** The candidate is clear of every box, and nearest one of `group`. */
        const assertBeside = Effect.fnUntraced(function* (group: string) {
          const spot = {
            x: Number(yield* x()),
            y: Number(yield* y()),
            w: 2,
            d: 2,
          };

          const placed = Rec.toEntries(structures);

          const over = Arr.filter(
            placed,
            ([, box]) =>
              spot.x < box.x + box.w &&
              box.x < spot.x + spot.w &&
              spot.y < box.y + box.d &&
              box.y < spot.y + spot.d
          );

          assert.deepStrictEqual(
            Arr.map(over, ([id]) => id),
            [],
            group
          );

          const gap = (box: { x: number; y: number; w: number; d: number }) =>
            Math.hypot(
              box.x + box.w / 2 - (spot.x + spot.w / 2),
              box.y + box.d / 2 - (spot.y + spot.d / 2)
            );

          const [nearest] = Arr.sort(
            placed,
            Order.mapInput(Order.Number, ([, box]: (typeof placed)[number]) =>
              gap(box)
            )
          );

          assert.strictEqual(
            groupOf.get(nearest?.[0] ?? "") ?? "loop",
            group,
            `nearest to ${nearest?.[0]}`
          );
        });

        assert.notStrictEqual(yield* x(), "");
        yield* assertBeside("people");
        assert.isFalse(
          yield* Effect.promise(() =>
            page.locator('[data-add="submit"]').isDisabled()
          )
        );

        const first = yield* x();

        yield* Effect.promise(() =>
          page.locator('[data-add="group"]').selectOption("outside")
        );
        yield* Effect.promise(() =>
          page.waitForFunction(
            `document.querySelector('[data-add="x"]').value !== ${literal(first)}`,
            undefined,
            waitTimeout
          )
        );
        yield* assertBeside("outside");

        // Once a spot is typed, the group no longer moves it.
        yield* Effect.promise(() => page.locator('[data-add="x"]').fill("30"));
        yield* Effect.promise(() =>
          page.locator('[data-add="group"]').selectOption("people")
        );
        assert.strictEqual(yield* x(), "30");
      }).pipe(Effect.provide(NodeServices.layer)),
    60_000
  );

  for (const view of ["iso", "plan"] as const) {
    it.live(
      `sits in the side panel and clears every structure and text in the ${view} view at 1280×800`,
      () =>
        Effect.gen(function* () {
          const { page } = yield* served;

          yield* chapter(page, "c-all");
          yield* click(page, `[data-view-toggle] [data-view="${view}"]`);
          yield* Effect.promise(() => page.keyboard.press("0"));
          yield* openForm(page);

          const form = yield* boxOf(page, "[data-add-structure]");
          const panel = yield* boxOf(page, "[data-side-panel]");

          assert.isAtLeast(form.x, panel.x - 0.5);
          assert.isAtMost(form.x + form.width, panel.x + panel.width + 0.5);
          assert.isAtMost(form.y + form.height, 800.5);

          const seen = yield* report(page);
          const polygon = rectPolygon(form);

          assert.deepStrictEqual(
            Arr.flatMap([...seen.structures, ...seen.text], (drawn) =>
              overlap(polygon, drawn.polygon) ? [drawn.id] : []
            ),
            []
          );
        }),
      60_000
    );
  }

  it.live(
    "warns, marked new, when the new structure stretches a zone over another group's, and so does a group change from the panel",
    () =>
      Effect.gen(function* () {
        const { page } = yield* served;

        const zoneWarnings = warnings(page).pipe(
          Effect.map((found) =>
            Arr.filter(found, ({ text }) =>
              Str.includes("zones of groups")(text)
            )
          )
        );

        yield* chapter(page, "c-all");
        yield* openForm(page);
        yield* Effect.promise(() =>
          page.locator('[data-add="name"]').fill("Build cache")
        );
        yield* Effect.promise(() =>
          page.locator('[data-add="group"]').selectOption("people")
        );
        // Far from the engineer, in the middle of the loop group.
        yield* Effect.promise(() => page.locator('[data-add="x"]').fill("14"));
        yield* Effect.promise(() => page.locator('[data-add="y"]').fill("0"));
        yield* waitFor(page, "[data-drag-warnings]");

        const fromForm = yield* zoneWarnings;

        assert.isAbove(fromForm.length, 0, "add form");
        assert.isTrue(
          Arr.every(fromForm, ({ isNew }) => isNew),
          "add form"
        );
        assert.include(
          yield* textOf(page, "[data-drag-warnings]"),
          "New from this change"
        );

        // The warnings are in the side panel, not over the drawing.
        const docked = yield* boxOf(page, "[data-drag-warnings]");
        const panel = yield* boxOf(page, "[data-side-panel]");

        assert.isAtLeast(docked.x, panel.x - 0.5);

        yield* click(page, '[data-add="cancel"]');
        yield* Effect.promise(() =>
          page
            .locator("[data-drag-warnings]")
            .waitFor({ state: "detached", ...waitTimeout })
        );

        yield* click(page, '[data-structure="upstream"]');
        yield* waitFor(page, '[data-structure-panel="upstream"]');
        yield* Effect.promise(() =>
          page.locator('[data-change="group"]').selectOption("people")
        );
        yield* waitFor(page, "[data-drag-warnings]");

        const fromPanel = yield* zoneWarnings;

        assert.isAbove(fromPanel.length, 0, "panel");
        assert.isTrue(
          Arr.every(fromPanel, ({ isNew }) => isNew),
          "panel"
        );
      }),
    60_000
  );
});

describe("a group change", () => {
  it.live(
    "from a drop into another group's zone is proposed, and the move lands as a layout change",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* served;

        yield* chapter(page, "c-all");

        // Drag the engineer (people) into the loop group's zone, onto free
        // ground between the page and the server.
        const from = yield* boxOf(page, '[data-structure="engineer"]');
        const into = yield* boxOf(page, '[data-structure="proposals"]');

        yield* Effect.promise(() =>
          page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
        );
        yield* Effect.promise(() => page.mouse.down());
        yield* Effect.promise(() =>
          page.mouse.move(into.x - 70, into.y + into.height / 2, { steps: 12 })
        );
        yield* Effect.promise(() => page.mouse.up());

        yield* Effect.promise(() =>
          page.waitForFunction(
            `document.querySelector('[data-structure="engineer"][data-pending="true"]') !== null`,
            undefined,
            waitTimeout
          )
        );

        // The group change is written after the move, so wait for it.
        yield* click(page, '[role="tab"][data-tab="pending"]');
        yield* waitFor(
          page,
          '[data-review-kind="structure"][data-review-action="group"]'
        );

        const proposals = yield* readProposals(home);

        assert.isTrue(
          Arr.some(proposals.layout, ({ kind }) => kind === "move")
        );
        assert.deepStrictEqual(
          Arr.map(proposals.structures ?? [], ({ change }) => change),
          [{ action: "group", structure: "engineer", group: "loop" }]
        );
      }),
    60_000
  );
});

describe("the open page after verdict changed --as and commit", () => {
  it.live(
    "follows the final id: selection, position and pending changes move to it",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* served;

        yield* chapter(page, "c-all");
        yield* openForm(page);
        yield* Effect.promise(() =>
          page.locator('[data-add="name"]').fill("Build cache")
        );
        yield* Effect.promise(() => page.locator('[data-add="x"]').fill("12"));
        yield* Effect.promise(() => page.locator('[data-add="y"]').fill("12"));
        yield* click(page, '[data-add="submit"]');
        yield* pendingWait(page);

        const [proposal] = (yield* savedProposals(home)).structures ?? [];

        const provisional =
          proposal?.change.action === "add" ? proposal.change.structure.id : "";

        assert.match(provisional, /^build-cache-[0-9a-f]{4}$/u);

        // Select it and note it, so the page holds a selection and a pending note.
        yield* click(page, `[data-structure="${provisional}"]`);
        yield* waitFor(page, `[data-structure-panel="${provisional}"]`);
        yield* Effect.promise(() =>
          page
            .locator(
              "[data-structure-panel] [data-notes-section] [data-note-text]"
            )
            .fill("Why a store?")
        );
        yield* click(
          page,
          "[data-structure-panel] [data-notes-section] [data-note-send]"
        );
        yield* waitFor(page, "[data-panel-note]");

        yield* click(page, "[data-ready-for-review]");
        yield* waitFor(page, "[data-review-dialog][open]");

        // The agent adds the structure under another id, says so, and commits.
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dataFile = path.join(home, "data.mjs");
        const data = yield* fs.readFileString(dataFile);

        yield* fs.writeFileString(
          dataFile,
          addStructureTo(data, "build-cache")
        );

        const reviewed = yield* runCli(home, ["review", home, "--json"]);
        const batch = yield* decodeReview(reviewed.stdout);
        const items = batch.batch?.items ?? [];

        const add = Arr.findFirst(
          items,
          ({ kind }) => kind === "add structure"
        );

        const note = Arr.findFirst(items, ({ kind }) => kind === "note");

        const verdicts: readonly (readonly [
          Option.Option<{ readonly id: string }>,
          readonly string[],
        ])[] = [
          [
            add,
            [
              "changed",
              "--reason",
              "Named it build-cache.",
              "--as",
              "build-cache",
            ],
          ],
          [note, ["accepted"]],
        ];

        for (const [item, args] of verdicts) {
          const verdict = yield* runCli(home, [
            "verdict",
            home,
            Option.getOrThrow(item).id,
            ...args,
          ]);

          assert.strictEqual(verdict.exitCode, 0, verdict.stderr);
        }

        const committed = yield* runCli(home, ["commit", home]);

        assert.strictEqual(committed.exitCode, 0, committed.stderr);

        // The page now draws build-cache, selected, where it was dropped.
        // The server rebuilds as soon as data.mjs changes, so build-cache can
        // show before the commit reaches the page, beside the still-open
        // proposal. Wait for the commit to retire the provisional id.
        yield* waitFor(page, '[data-structure="build-cache"]');
        yield* Effect.promise(() =>
          page
            .locator(`[data-structure="${provisional}"]`)
            .first()
            .waitFor({ ...waitTimeout, state: "detached" })
        );
        assert.strictEqual(
          yield* count(page, `[data-structure="${provisional}"]`),
          0
        );
        yield* waitFor(
          page,
          '[data-structure-panel="build-cache"][data-pinned]'
        );

        // The note followed the structure to its new id.
        const shown = yield* textOf(page, "[data-structure-panel]");

        assert.include(shown, "Build cache");
        assert.include(shown, "Why a store?");
      }).pipe(Effect.provide(NodeServices.layer)),
    120_000
  );
});

/** data.mjs with a structure `id` in the loop group, revealed in the first chapter. */
const addStructureTo = (data: string, id: string): string =>
  pipe(
    data,
    Str.replace(
      'reveals: ["engineer", "page"],',
      `reveals: ["engineer", "page", "${id}"],`
    ),
    Str.replace(
      "  structures: [\n",
      `  structures: [
    structure({
      id: "${id}",
      code: "BC",
      name: "Build cache",
      shape: "store",
      status: "planned",
      oneLiner: "Keeps built maps.",
      whatItDoes: "Stores them.",
      howItsBuilt: "A folder.",
    }),
`
    )
  );
