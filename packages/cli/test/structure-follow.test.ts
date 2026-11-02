import { LayoutFile, Proposals } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  FileSystem,
  Path,
  Schema,
  String as Str,
} from "effect";
import type { Page } from "playwright";

import { openUrl } from "./browser.ts";
import { drawingReport, overlap } from "./drawing-report.ts";
import type { DrawingReport } from "./drawing-report.ts";
import { fullMap } from "./fixtures.ts";
import { makeHome, runCli, startServe } from "./harness.ts";

// Seam 2, for the gaps: what a proposal adds to check's report, where the add
// form puts a structure and where it sits on the page, dragging a structure
// into another group's zone, and the page following a final id. The review
// map has groups people (engineer), loop (page, server, proposals, pull
// request) and outside (upstream) in a row, so the zones can be made to meet.

const waitTimeout = { timeout: 15_000 };

const decodeProposals = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Proposals)
);

const decodeLayout = Schema.decodeUnknownEffect(LayoutFile);

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

const textOf = (page: Page, selector: string) =>
  Effect.promise(() =>
    page
      .locator(selector)
      .first()
      .textContent()
      .then((text) => text ?? "")
  );

const chapter = Effect.fnUntraced(function* (page: Page, id: string) {
  yield* click(page, `[data-chapter-rail] button[data-chapter="${id}"]`);
  yield* waitFor(page, `[data-walkthrough][data-chapter="${id}"]`);
  yield* click(page, '[data-playback-controls] [data-control="pause"]');
  yield* Effect.promise(() => page.keyboard.press("0"));
});

const readProposals = Effect.fnUntraced(function* (home: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  return yield* decodeProposals(
    yield* fs.readFileString(path.join(home, "proposals.json"))
  );
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

/** Each warning in the panel: its words, and whether the change made it. */
const warnings = Effect.fnUntraced(function* (page: Page) {
  const items = yield* Effect.promise(() =>
    page.locator("[data-drag-warning]").all()
  );

  return yield* Effect.forEach(items, (item) =>
    Effect.promise(async () => ({
      text: (await item.textContent()) ?? "",
      isNew: (await item.getAttribute("data-warning-new")) === "true",
    }))
  );
});

describe("the add form", () => {
  it.live(
    "starts at the first free slot beside the group, so Propose is ready, and follows the group",
    () =>
      Effect.gen(function* () {
        const { page } = yield* served;

        yield* chapter(page, "c-all");
        yield* openForm(page);
        yield* Effect.promise(() =>
          page.locator('[data-add="name"]').fill("Build cache")
        );

        const x = () =>
          Effect.promise(() => page.locator('[data-add="x"]').inputValue());

        assert.notStrictEqual(yield* x(), "");
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
            `document.querySelector('[data-add="x"]').value !== ${JSON.stringify(first)}`,
            undefined,
            waitTimeout
          )
        );

        // Once a spot is typed, the group no longer moves it.
        yield* Effect.promise(() => page.locator('[data-add="x"]').fill("30"));
        yield* Effect.promise(() =>
          page.locator('[data-add="group"]').selectOption("people")
        );
        assert.strictEqual(yield* x(), "30");
      }),
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
    "warns, marked new, when the new structure stretches a zone over another group's",
    () =>
      Effect.gen(function* () {
        const { page } = yield* served;

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

        const found = yield* warnings(page);
        const zones = Arr.filter(found, ({ text }) =>
          Str.includes("zones of groups")(text)
        );

        assert.isAbove(zones.length, 0);
        assert.isTrue(Arr.every(zones, ({ isNew }) => isNew));
        assert.include(
          yield* textOf(page, "[data-drag-warnings]"),
          "New from this change"
        );

        // The warnings are in the side panel, not over the drawing.
        const docked = yield* boxOf(page, "[data-drag-warnings]");
        const panel = yield* boxOf(page, "[data-side-panel]");

        assert.isAtLeast(docked.x, panel.x - 0.5);
      }),
    60_000
  );
});

describe("a group change", () => {
  it.live(
    "from the panel warns about the zones it makes meet, marked new",
    () =>
      Effect.gen(function* () {
        const { page } = yield* served;

        yield* chapter(page, "c-all");
        yield* click(page, '[data-structure="upstream"]');
        yield* waitFor(page, '[data-structure-panel="upstream"]');
        yield* Effect.promise(() =>
          page.locator('[data-change="group"]').selectOption("people")
        );
        yield* waitFor(page, "[data-drag-warnings]");

        const zones = Arr.filter(yield* warnings(page), ({ text }) =>
          Str.includes("zones of groups")(text)
        );

        assert.isAbove(zones.length, 0);
        assert.isTrue(Arr.every(zones, ({ isNew }) => isNew));
      }),
    60_000
  );

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
        yield* Effect.promise(() =>
          page.waitForFunction(
            `[...document.querySelectorAll("[data-pending-structure-proposal]")].length >= 0`,
            undefined,
            waitTimeout
          )
        );
        yield* click(page, '[role="tab"][data-tab="pending"]');
        yield* waitFor(page, '[data-pending-action="group"]');

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

  it.live("from a drop within its own zone is a layout change only", () =>
    Effect.gen(function* () {
      const { home, page } = yield* served;

      yield* chapter(page, "c-all");

      const from = yield* boxOf(page, '[data-structure="page"]');

      yield* Effect.promise(() =>
        page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
      );
      yield* Effect.promise(() => page.mouse.down());
      yield* Effect.promise(() =>
        page.mouse.move(
          from.x + from.width / 2 + 30,
          from.y + from.height / 2,
          {
            steps: 8,
          }
        )
      );
      yield* Effect.promise(() => page.mouse.up());
      yield* pendingWait(page);

      const proposals = yield* readProposals(home);

      assert.isAbove(proposals.layout.length, 0);
      assert.deepStrictEqual(proposals.structures ?? [], []);
    })
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

        const [proposal] = (yield* readProposals(home)).structures ?? [];
        const provisional =
          proposal?.change.action === "add" ? proposal.change.structure.id : "";

        assert.match(provisional, /^build-cache-[0-9a-f]{4}$/u);

        // Select it and note it, so the page holds a selection and a pending note.
        yield* click(page, `[data-structure="${provisional}"]`);
        yield* waitFor(page, `[data-structure-panel="${provisional}"]`);
        yield* Effect.promise(() =>
          page
            .locator("[data-structure-panel] [data-note-text]")
            .fill("Why a store?")
        );
        yield* click(page, "[data-structure-panel] [data-note-send]");
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
        const items = JSON.parse(reviewed.stdout).batch.items as readonly {
          readonly id: string;
          readonly kind: string;
        }[];

        const add = Arr.findFirst(
          items,
          ({ kind }) => kind === "add structure"
        );
        const note = Arr.findFirst(items, ({ kind }) => kind === "note");

        assert.isTrue(add._tag === "Some" && note._tag === "Some");

        for (const [item, args] of [
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
        ] as const) {
          const verdict = yield* runCli(home, [
            "verdict",
            home,
            item._tag === "Some" ? item.value.id : "",
            ...args,
          ]);

          assert.strictEqual(verdict.exitCode, 0, verdict.stderr);
        }

        const committed = yield* runCli(home, ["commit", home]);

        assert.strictEqual(committed.exitCode, 0, committed.stderr);

        // The page now draws build-cache, selected, where it was dropped.
        yield* waitFor(page, '[data-structure="build-cache"]');
        assert.strictEqual(
          yield* count(page, `[data-structure="${provisional}"]`),
          0
        );
        yield* waitFor(
          page,
          '[data-structure-panel="build-cache"][data-pinned]'
        );

        const layout = yield* decodeLayout(
          committed.files["layout.json"] ?? ""
        );

        assert.deepStrictEqual(layout.structures["build-cache"], {
          x: 12,
          y: 12,
          w: 2,
          d: 2,
        });

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
  data
    .replace(
      'reveals: ["engineer", "page"],',
      `reveals: ["engineer", "page", ${JSON.stringify(id)}],`
    )
    .replace(
      "  structures: [\n",
      `  structures: [
    structure({
      id: ${JSON.stringify(id)},
      code: "BC",
      name: "Build cache",
      shape: "store",
      status: "planned",
      oneLiner: "Keeps built maps.",
      whatItDoes: "Stores them.",
      howItsBuilt: "A folder.",
    }),
`
    );
