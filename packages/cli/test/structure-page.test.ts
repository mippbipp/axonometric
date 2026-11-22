import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  FileSystem,
  Path,
  Schedule,
  String as Str,
} from "effect";
import type { Page } from "playwright";

import {
  assertCount,
  click,
  count,
  goToChapterPaused,
  inPage,
  press,
  showViewFitted,
  strokeOf,
  waitFor,
  waitTimeout,
  choose,
} from "./browser.ts";
import { crosses, drawingReport, nameTagClashes } from "./drawing-report.ts";
import type { Drawn, DrawingReport } from "./drawing-report.ts";
import { openReviewMap, readProposals, runCli } from "./harness.ts";

// Seam 2: structure proposals in a page that a real serve serves. The review
// map's chapters reveal engineer and page, then server and proposals, then
// the rest, so a proposed structure is revealed in each of them.

const served = openReviewMap({});

/**
 * The structure proposals in proposals.json once there are `expected` of them.
 * The page draws a proposal as pending before the server has written it.
 */
const savedStructures = (home: string, expected: number) =>
  readProposals(home).pipe(
    Effect.map((proposals) => proposals.structures ?? []),
    Effect.filterOrFail(
      (saved) => saved.length === expected,
      () => `proposals.json never held ${expected} structure proposals`
    ),
    Effect.retry({ schedule: Schedule.spaced("100 millis"), times: 100 }),
    Effect.orDie
  );

const rightClick = (page: Page, id: string) =>
  Effect.promise(() =>
    page.locator(`[data-structure="${id}"]`).click({ button: "right" })
  );

/** Closes the context menu, which stays open after a pick from a submenu. */
const closeMenu = Effect.fnUntraced(function* (page: Page) {
  const menu = page.locator("[data-structure-menu]");

  // The first Escape closes the submenu, the next the menu.
  for (
    let tries = 0;
    tries < 3 && (yield* Effect.promise(() => menu.count())) > 0;
    tries++
  ) {
    yield* Effect.promise(() => page.keyboard.press("Escape"));
    yield* Effect.promise(() => page.waitForTimeout(100));
  }

  yield* Effect.promise(() =>
    menu.waitFor({ state: "detached", ...waitTimeout })
  );
});

const pendingOn = (page: Page, id: string) =>
  Effect.promise(() =>
    page.waitForFunction(
      `document.querySelector('[data-structure="${id}"][data-pending="true"]') !== null`,
      undefined,
      waitTimeout
    )
  );

/** Opens the form, names the structure and clicks the map at (x, y) in the page. */
const addStructure = Effect.fnUntraced(function* (
  page: Page,
  fields: { readonly name: string; readonly x: number; readonly y: number }
) {
  yield* click(page, '[data-control="add-structure"]');
  yield* waitFor(page, "[data-add-structure]");
  yield* Effect.promise(() =>
    page.locator('[data-add="name"]').fill(fields.name)
  );
  yield* choose(page, '[data-add="shape"]', "store");
  yield* choose(page, '[data-add="status"]', "planned");
  yield* Effect.promise(() =>
    page.locator('[data-add="x"]').fill(String(fields.x))
  );
  yield* Effect.promise(() =>
    page.locator('[data-add="y"]').fill(String(fields.y))
  );
  // PROBE
  const state = yield* Effect.promise(() =>
    page.evaluate<string>(`JSON.stringify({
      checking: document.querySelectorAll("[data-add-structure][data-checking]").length,
      disabled: document.querySelector('[data-add="submit"]')?.disabled,
      finding: document.querySelectorAll("[data-add-hint][data-finding]").length,
      x: document.querySelector('[data-add="x"]')?.value,
      y: document.querySelector('[data-add="y"]')?.value,
    })`)
  );
  process.stderr.write(`PROBE262 at click ${state}\n`);
  // END PROBE
  yield* click(page, '[data-add="submit"]');
  // PROBE
  const after = (label: string) =>
    Effect.promise(() =>
      page.evaluate<string>(`JSON.stringify({
        failure: document.querySelector("[data-add-failure]")?.textContent,
        form: document.querySelectorAll("[data-add-structure]").length,
        pending: document.querySelectorAll('[data-structure][data-pending="true"]').length,
        sending: document.querySelector('[data-add="submit"]')?.textContent,
      })`)
    ).pipe(
      Effect.map((out) => process.stderr.write(`PROBE262 ${label} ${out}\n`))
    );
  yield* after("after click");
  yield* Effect.sleep("3 seconds");
  yield* after("3s later");
  // END PROBE
});

/** The pieces of the cross that run over a code chip or a name tag. */
const strikesOverText = (report: DrawingReport): ReadonlyArray<string> => {
  // The chip's rendered box, with 3 pixels of air round it.
  const aired = Arr.map(report.chips, ({ id, polygon }): Drawn => {
    const xs = Arr.map(polygon, ({ x }) => x);
    const ys = Arr.map(polygon, ({ y }) => y);
    const [left, right] = [Math.min(...xs) - 3, Math.max(...xs) + 3];
    const [top, bottom] = [Math.min(...ys) - 3, Math.max(...ys) + 3];

    return {
      id,
      polygon: [
        { x: left, y: top },
        { x: right, y: top },
        { x: right, y: bottom },
        { x: left, y: bottom },
      ],
    };
  });

  const text: ReadonlyArray<Drawn> = [
    ...aired,
    ...Arr.filter(report.text, ({ id }) => Str.startsWith("tag:")(id)),
  ];

  return Arr.flatMap(report.strikes, ({ id, segment }) =>
    Arr.flatMap(text, (other) =>
      crosses(segment, other.polygon) ? [`${id} × ${other.id}`] : []
    )
  );
};

/** Every name tag drawn now over other text or a box other than its own. */
const clashes = (page: Page) =>
  inPage<DrawingReport>(page, drawingReport).pipe(Effect.map(nameTagClashes));

describe("adding a structure from the toolbar", () => {
  it.live(
    "asks for name, shape, group, status and position, and saves a proposal",
    () =>
      Effect.gen(function* () {
        const { errors, home, page } = yield* served;

        yield* goToChapterPaused(page, "c-all");
        yield* click(page, '[data-control="add-structure"]');
        yield* waitFor(page, "[data-add-structure]");

        for (const field of ["name", "shape", "group", "status", "x", "y"]) {
          const addFieldCount = yield* count(page, `[data-add="${field}"]`);

          assert.strictEqual(addFieldCount, 1, field);
        }

        for (const name of ["Shape", "Group", "Status"]) {
          const named = yield* Effect.promise(() =>
            page.getByRole("combobox", { exact: true, name }).count()
          );

          assert.strictEqual(named, 1, `${name} select is named`);
        }

        for (const name of ["x", "y"]) {
          const named = yield* Effect.promise(() =>
            page.getByRole("textbox", { exact: true, name }).count()
          );

          assert.strictEqual(named, 1, `${name} number input is named`);
        }

        const addSubmitDisabled = yield* Effect.promise(() =>
          page.locator('[data-add="submit"]').isDisabled()
        );

        assert.isTrue(addSubmitDisabled);

        yield* Effect.promise(() => page.locator('[data-add="x"]').fill("12"));
        yield* Effect.promise(() => page.locator('[data-add="y"]').fill("12"));
        yield* Effect.promise(() =>
          page.locator('[data-add="name"]').fill("Build cache")
        );
        yield* choose(page, '[data-add="shape"]', "store");
        yield* choose(page, '[data-add="group"]', "outside");
        yield* choose(page, '[data-add="status"]', "planned");
        yield* click(page, '[data-add="submit"]');
        yield* Effect.promise(() =>
          page.waitForFunction(
            `document.querySelector('[data-structure][data-pending="true"]') !== null`,
            undefined,
            waitTimeout
          )
        );

        const proposals = yield* readProposals(home);
        const [saved] = proposals.structures ?? [];

        assert.strictEqual(saved?.change.action, "add");

        if (saved?.change.action === "add") {
          assert.deepStrictEqual(
            { ...saved.change.structure, id: "" },
            {
              group: "outside",
              id: "",
              name: "Build cache",
              shape: "store",
              status: "planned",
            }
          );
          assert.match(saved.change.structure.id, /^build-cache-[0-9a-f]{4}$/u);
          assert.deepStrictEqual(saved.change.at, { d: 2, w: 2, x: 12, y: 12 });
        }

        assert.deepStrictEqual(errors, []);
      }),
    60_000
  );

  it.live("takes its position from a click on the map", () =>
    Effect.gen(function* () {
      const { home, page } = yield* served;

      yield* goToChapterPaused(page, "c-all");
      yield* click(page, '[data-control="add-structure"]');
      yield* click(page, '[data-add="pick"]');

      const box = yield* Effect.promise(() =>
        page.locator("[data-map-surface] svg[data-scale]").first().boundingBox()
      );

      // Empty ground at the right edge of the fitted map.
      yield* Effect.promise(() =>
        page.mouse.click(
          (box?.x ?? 0) + (box?.width ?? 0) * 0.9,
          (box?.y ?? 0) + (box?.height ?? 0) * 0.85
        )
      );
      yield* waitFor(page, "[data-spot-outline]");

      const x = yield* Effect.promise(() =>
        page.locator('[data-add="x"]').inputValue()
      );

      const y = yield* Effect.promise(() =>
        page.locator('[data-add="y"]').inputValue()
      );

      assert.notStrictEqual(x, "");
      assert.notStrictEqual(y, "");
      assert.strictEqual(Number(x) * 2, Math.round(Number(x) * 2));

      yield* Effect.promise(() =>
        page.locator('[data-add="name"]').fill("Dropped")
      );
      yield* click(page, '[data-add="submit"]');
      yield* Effect.promise(() =>
        page.waitForFunction(
          `document.querySelector('[data-structure][data-pending="true"]') !== null`,
          undefined,
          waitTimeout
        )
      );

      const [saved] = (yield* readProposals(home)).structures ?? [];

      assert.strictEqual(
        saved?.change.action === "add" ? saved.change.at.x : -1,
        Number(x)
      );
    })
  );
});

describe.each(["iso", "plan"] as const)(
  "a proposed structure in the %s view",
  (which) => {
    it.live(
      "is drawn in the pending look, in every chapter, and its name tag clears every box and text",
      () =>
        Effect.gen(function* () {
          const { page } = yield* served;

          yield* goToChapterPaused(page, "c-all");
          yield* addStructure(page, { name: "Build cache", x: 12, y: 12 });
          yield* waitFor(page, '[data-structure][data-pending="true"]');
          yield* showViewFitted(page, which);

          for (const id of ["c-page", "c-save", "c-all"]) {
            yield* goToChapterPaused(page, id);
            yield* showViewFitted(page, which);

            const proposed = page.locator(
              '[data-structure][data-pending="true"]'
            );

            const proposedCount = yield* Effect.promise(() => proposed.count());
            assert.strictEqual(proposedCount, 1, `chapter ${id}`);

            const stroke = yield* strokeOf(
              page,
              '[data-structure][data-pending="true"]'
            );

            const ink = yield* strokeOf(
              page,
              '[data-structure]:not([data-pending="true"])'
            );

            assert.notStrictEqual(stroke, ink);

            // No text badge on the map: the look is outlines and tints.
            yield* assertCount(page, "[data-pending-badge]", 0);

            const nameTagCount = yield* count(page, "[data-name-tag]");
            assert.isAbove(nameTagCount, 0);
            const tagClashes = yield* clashes(page);
            assert.deepStrictEqual(tagClashes, [], `chapter ${id}`);
          }
        }),
      90_000
    );
  }
);

describe("deleting a structure", () => {
  it.live(
    "is drawn crossed out in both views until reviewed, with no text on the mark",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* served;

        yield* goToChapterPaused(page, "c-all");
        yield* click(page, '[data-structure="upstream"]');
        yield* waitFor(page, '[data-structure-panel="upstream"]');
        yield* click(page, '[data-change="delete"]');
        yield* waitFor(page, '[data-removed-mark="upstream"]');

        for (const which of ["iso", "plan"] as const) {
          yield* showViewFitted(page, which);

          const mark = page.locator('[data-removed-mark="upstream"]');

          const markCount = yield* Effect.promise(() => mark.count());
          assert.strictEqual(markCount, 1);

          // The cross keeps clear of every chip and tag, wherever it is cut.
          const report = yield* Effect.promise(() =>
            page.evaluate<DrawingReport>(drawingReport)
          );

          assert.isAtLeast(report.strikes.length, 2);
          assert.deepStrictEqual(strikesOverText(report), []);
          const tagClashes = yield* clashes(page);
          assert.deepStrictEqual(tagClashes, []);
        }

        const [saved] = (yield* readProposals(home)).structures ?? [];

        assert.deepStrictEqual(saved?.change, {
          action: "delete",
          structure: "upstream",
        });

        const deletingText = yield* Effect.promise(() =>
          page.locator("[data-deleting]").textContent()
        );

        assert.include(deletingText, "crossed out");
      }),
    90_000
  );

  it.live(
    "is not in the exported SVG, which equals the CLI's, with a note and an added structure pending too",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* served;

        yield* goToChapterPaused(page, "c-all");
        yield* addStructure(page, { name: "Build cache", x: 12, y: 12 });
        yield* waitFor(page, '[data-structure][data-pending="true"]');
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
        yield* click(page, '[data-structure="upstream"]');
        yield* click(page, '[data-change="delete"]');
        yield* waitFor(page, '[data-removed-mark="upstream"]');
        // A pinned structure puts the spotlight on it, which the CLI has no
        // way to match. Unpin it so both draw the chapter's spotlight.
        yield* Effect.promise(() =>
          page.evaluate("document.activeElement?.blur()")
        );
        yield* Effect.promise(() => page.keyboard.press("Escape"));
        yield* Effect.promise(() =>
          page.waitForFunction(
            `document.querySelector('[data-structure][data-selected="true"]') === null`,
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

          const downloadPath = yield* Effect.promise(() => download.path());
          const downloadedBytes = yield* fs.readFile(downloadPath);
          const fromPage = new TextDecoder().decode(downloadedBytes);

          assert.notInclude(fromPage, "BUILD CACHE");
          assert.notInclude(fromPage, "Build cache");
          assert.notInclude(fromPage, "removed");
          assert.notInclude(fromPage, "strike");
          assert.notInclude(fromPage, "data-note-marker");
          assert.notInclude(fromPage, "data-verdict");

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
          const cliText = yield* fs.readFileString(target);
          assert.strictEqual(
            fromPage,
            cliText,
            `${which}: the page's SVG differs from the CLI's`
          );
        }
      }).pipe(Effect.provide(NodeServices.layer)),
    90_000
  );
});

describe("the context menu on a structure", () => {
  it.live(
    "opens from the keyboard on a focused structure, and Escape gives focus back to it",
    () =>
      Effect.gen(function* () {
        const { page } = yield* served;

        yield* goToChapterPaused(page, "c-all");

        const focusedStructure = `document.activeElement?.getAttribute("data-structure")`;
        const focusedMenuEntry = `document.activeElement?.closest("[data-structure-menu]") !== null && document.activeElement?.getAttribute("role") === "menuitem"`;

        // macOS Chromium sends Shift+F10 with no contextmenu event, and the
        // other systems send one. Dropping the event makes every system take
        // the macOS path, which the page has to handle itself.
        yield* Effect.promise(() =>
          page.evaluate(
            `addEventListener("contextmenu", (event) => { if (event.button !== 2) { event.stopImmediatePropagation(); } }, true)`
          )
        );
        yield* Effect.promise(() =>
          page.locator('[data-structure="engineer"]').focus()
        );
        yield* press(page, "Shift+F10");
        yield* waitFor(page, '[data-structure-menu="engineer"]');
        yield* Effect.promise(() =>
          page.waitForFunction(focusedMenuEntry, undefined, waitTimeout)
        );
        yield* press(page, "ArrowDown");
        yield* press(page, "Escape");
        yield* Effect.promise(() =>
          page
            .locator("[data-structure-menu]")
            .waitFor({ state: "detached", ...waitTimeout })
        );
        yield* Effect.promise(() =>
          page.waitForFunction(
            `${focusedStructure} === "engineer"`,
            undefined,
            waitTimeout
          )
        );

        yield* rightClick(page, "server");
        yield* waitFor(page, '[data-structure-menu="server"]');
        yield* press(page, "Escape");
        yield* Effect.promise(() =>
          page
            .locator("[data-structure-menu]")
            .waitFor({ state: "detached", ...waitTimeout })
        );
        yield* Effect.promise(() =>
          page.waitForFunction(
            `${focusedStructure} === "server"`,
            undefined,
            waitTimeout
          )
        );
      }),
    60_000
  );

  it.live(
    "offers a rename, a shape, a group, a status and a deletion in both views, and proposes each",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* served;

        yield* goToChapterPaused(page, "c-all");

        for (const which of ["iso", "plan"] as const) {
          yield* showViewFitted(page, which);
          yield* Effect.promise(() =>
            page.locator('[data-structure="server"]').click({ button: "right" })
          );
          yield* waitFor(page, '[data-structure-menu="server"]');

          for (const entry of ["shape", "group", "status"]) {
            const menuEntryCount = yield* count(page, `[data-menu="${entry}"]`);

            assert.strictEqual(menuEntryCount, 1, entry);
          }

          yield* assertCount(page, '[data-menu="delete"]', 1);
          yield* assertCount(page, '[data-menu="rename"]', 1);

          yield* Effect.promise(() => page.keyboard.press("Escape"));
        }

        yield* rightClick(page, "server");
        yield* click(page, '[data-menu="status"]');
        yield* click(page, '[data-menu-status="off"]');
        yield* pendingOn(page, "server");
        yield* closeMenu(page);

        yield* rightClick(page, "proposals");
        yield* click(page, '[data-menu="group"]');
        yield* click(page, '[data-menu-group="outside"]');
        yield* pendingOn(page, "proposals");
        yield* closeMenu(page);

        yield* rightClick(page, "engineer");
        yield* click(page, '[data-menu="shape"]');
        yield* click(page, '[data-menu-shape="box"]');
        yield* pendingOn(page, "engineer");
        yield* closeMenu(page);

        // Rename puts the typing in the panel's name field.
        yield* rightClick(page, "page");
        yield* click(page, '[data-menu="rename"]');
        yield* Effect.promise(() =>
          page.waitForFunction(
            `document.activeElement?.getAttribute("data-change") === "name"`,
            undefined,
            waitTimeout
          )
        );
        yield* Effect.promise(() => page.keyboard.type("Map view"));
        yield* Effect.promise(() => page.keyboard.press("Enter"));
        yield* pendingOn(page, "page");

        yield* rightClick(page, "upstream");
        yield* click(page, '[data-menu="delete"]');
        yield* waitFor(page, '[data-removed-mark="upstream"]');

        const savedChanges = yield* savedStructures(home, 5);
        const changes = Arr.map(savedChanges, ({ change }) => change);

        assert.sameDeepMembers(
          [...changes],
          [
            { action: "status", status: "off", structure: "server" },
            { action: "group", group: "outside", structure: "proposals" },
            { action: "shape", shape: "box", structure: "engineer" },
            { action: "rename", name: "Map view", structure: "page" },
            { action: "delete", structure: "upstream" },
          ]
        );
      }),
    90_000
  );
});
