import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  Record as Rec,
  Schema,
  String as Str,
} from "effect";
import type { Page } from "playwright";

import { click, inPage, literal, press } from "./browser.ts";
import { minimalMap, pipelineMap } from "./fixtures.ts";
import { buildAndOpen } from "./harness.ts";

const focusedControl = (page: Page) =>
  inPage<string | null>(
    page,
    `document.activeElement?.dataset.control ?? document.activeElement?.dataset.exportItem ?? null`
  );

/** The pipeline map's read-only file, at its last chapter. */
const lastChapter = Effect.gen(function* () {
  const opened = yield* buildAndOpen(yield* pipelineMap, "flake-pipeline");

  yield* Effect.promise(() =>
    opened.page.setViewportSize({ width: 1280, height: 800 })
  );
  yield* click(opened.page, '[data-chapter-rail] button[data-chapter="c-all"]');
  yield* Effect.promise(() =>
    opened.page.locator('[data-walkthrough][data-chapter="c-all"]').waitFor()
  );

  return opened;
});

/** Opens the Export menu, picks `item`, and returns the file it saved. */
const exportFile = Effect.fnUntraced(function* (page: Page, item: string) {
  yield* click(page, '[data-control="export"]');

  const [download] = yield* Effect.promise(() =>
    Promise.all([
      page.waitForEvent("download"),
      page.locator(`[data-export-item="${item}"]`).click(),
    ])
  );

  const path = yield* Effect.promise(() => download.path());
  const { readFile } = yield* Effect.promise(() => import("node:fs/promises"));
  const bytes = yield* Effect.promise(() => readFile(path));

  return { name: download.suggestedFilename(), bytes };
});

const chooseWhite = Effect.fnUntraced(function* (page: Page) {
  yield* click(page, '[data-control="export"]');
  yield* click(page, '[data-export-item="background"]');
  yield* press(page, "Escape");
});

interface SvgReport {
  readonly rootRole: string | null;
  readonly labelledBy: string | null;
  readonly firstChildren: readonly string[];
  readonly titleText: string;
  readonly descText: string;
  readonly ids: readonly string[];
  /** Every `#id` the file refers to, by `url()`, `href` or ARIA. */
  readonly references: readonly string[];
  /** Every `url()` or `href` that doesn't point inside the file. */
  readonly external: readonly string[];
  readonly text: string;
  /** The text of each <style> element. */
  readonly styleElements: readonly string[];
}

/** Parses an SVG file in the page and reports what's in it. */
const svgReport = (page: Page, text: string) =>
  inPage<SvgReport>(
    page,
    `(() => {
      const doc = new DOMParser().parseFromString(${literal(text)}, "image/svg+xml");
      const root = doc.documentElement;
      if (root.localName !== "svg" || doc.querySelector("parsererror")) {
        throw new Error("The SVG doesn't parse.");
      }
      const all = [root, ...root.querySelectorAll("*")];
      const references = [];
      const external = [];
      for (const element of all) {
        for (const { name, value } of element.attributes) {
          if (name === "href" || name === "xlink:href") {
            if (value.startsWith("#")) references.push(value.slice(1));
            else external.push(value);
          } else if (name === "aria-labelledby" || name === "aria-describedby") {
            references.push(...value.split(/\\s+/));
          } else {
            for (const match of value.matchAll(/url\\(([^)]*)\\)/g)) {
              const target = match[1].replace(/["']/g, "");
              if (target.startsWith("#")) references.push(target.slice(1));
              else external.push(target);
            }
          }
        }
      }
      return {
        rootRole: root.getAttribute("role"),
        labelledBy: root.getAttribute("aria-labelledby"),
        firstChildren: [...root.children].slice(0, 2).map((child) => child.localName),
        titleText: root.children[0]?.textContent ?? "",
        descText: root.children[1]?.textContent ?? "",
        ids: all.flatMap((element) => (element.id === "" ? [] : [element.id])),
        references,
        external,
        text: root.textContent,
        styleElements: [...root.querySelectorAll("style")].map((style) => style.textContent),
      };
    })()`
  );

const decoder = new TextDecoder();

/** The colour of a PNG's top left pixel, read through a canvas. */
const cornerPixel = (page: Page, bytes: Uint8Array) =>
  inPage<readonly number[]>(
    page,
    `(async () => {
      const image = new Image();
      image.src = "data:image/png;base64,${Buffer.from(bytes).toString("base64")}";
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      return [...context.getImageData(2, 2, 1, 1).data];
    })()`
  );

/** Each structure's middle, relative to the first, in the drawing's units. */
const relativeCentres = (page: Page, selector: (id: string) => string) =>
  inPage<Readonly<Record<string, { x: number; y: number }>>>(
    page,
    `(() => {
      const ids = ["updater", "build", "maintainer", "ruleset", "watchdog"];
      const selector = (id) => ${literal(selector("@"))}.replace("@", id);
      const centre = (id) => {
        const box = document.querySelector(selector(id)).getBBox();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      };
      const origin = centre(ids[0]);
      return Object.fromEntries(ids.map((id) => {
        const at = centre(id);
        return [id, { x: at.x - origin.x, y: at.y - origin.y }];
      }));
    })()`
  );

const Binding = Schema.Struct({ elementId: Schema.String });

const ExcalidrawElement = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  frameId: Schema.NullOr(Schema.String),
  containerId: Schema.optionalKey(Schema.String),
  boundElements: Schema.Array(
    Schema.Struct({ id: Schema.String, type: Schema.String })
  ),
  startBinding: Schema.optionalKey(Schema.NullOr(Binding)),
  endBinding: Schema.optionalKey(Schema.NullOr(Binding)),
});

const ExcalidrawFile = Schema.Struct({
  type: Schema.Literal("excalidraw"),
  version: Schema.Literal(2),
  source: Schema.String,
  elements: Schema.Array(ExcalidrawElement),
  appState: Schema.Struct({ viewBackgroundColor: Schema.String }),
  files: Schema.Record(Schema.String, Schema.Unknown),
});

const decodeExcalidraw = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ExcalidrawFile)
);

describe("export", () => {
  it.live(
    "saves an accessible, self-contained SVG of the view and chapter from the read-only file",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page, errors, requests } = yield* lastChapter;

          const names = yield* inPage<readonly string[]>(
            page,
            `[...document.querySelectorAll("[data-map-layer] [data-structure]")].map((element) => element.getAttribute("aria-label"))`
          );

          const { name, bytes } = yield* exportFile(page, "svg");
          const report = yield* svgReport(page, decoder.decode(bytes));
          const prefix = "flake-pipeline-iso-chapter-8-";

          assert.strictEqual(name, "flake-pipeline-iso-chapter-8.svg");
          assert.strictEqual(report.rootRole, "img");
          assert.deepStrictEqual(report.firstChildren, ["title", "desc"]);
          assert.strictEqual(report.labelledBy, `${prefix}title ${prefix}desc`);
          assert.include(report.titleText, "Flake update pipeline");
          assert.include(report.titleText, "Iso view");
          assert.include(report.titleText, "chapter 8");
          assert.include(report.descText, "The whole pipeline");
          assert.isTrue(
            Arr.every(report.ids, Str.startsWith(prefix)),
            `unprefixed ids: ${Arr.join(
              Arr.filter(report.ids, (id) => !Str.startsWith(prefix)(id)),
              ", "
            )}`
          );
          assert.strictEqual(new Set(report.ids).size, report.ids.length);
          assert.deepStrictEqual(report.external, []);
          // The file carries its font, so it draws the same wherever it opens.
          assert.isTrue(
            Arr.some(report.styleElements, Str.includes("base64,")),
            "the font is embedded"
          );
          assert.deepStrictEqual(
            Arr.filter(report.references, (id) => !report.ids.includes(id)),
            []
          );
          // An id depends only on the map, so the hatch pattern has a plain
          // one, as every other export of the same map does.
          assert.isTrue(
            Arr.some(report.ids, Str.endsWith("pattern-1")),
            "the hatch pattern has a plain id"
          );
          assert.lengthOf(names, 15);

          for (const structure of names) {
            assert.include(report.text, structure);
          }

          assert.notInclude(report.text, "Packet");
          assert.deepStrictEqual(requests, []);
          assert.deepStrictEqual(errors, []);
        })
      ),
    60_000
  );

  it.live(
    "the SVG draws structures where the page drew them, in both views",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* lastChapter;

          for (const view of ["iso", "plan"] as const) {
            if (view === "plan") {
              yield* click(page, '[data-view-toggle] [data-view="plan"]');
              yield* Effect.promise(() =>
                page.locator('[data-walkthrough][data-view="plan"]').waitFor()
              );
            }

            const onScreen = yield* relativeCentres(
              page,
              (id) => `[data-map-layer] [data-structure="${id}"]`
            );

            const { bytes } = yield* exportFile(page, "svg");

            const opened = yield* Effect.promise(() =>
              page.context().newPage()
            );

            yield* Effect.promise(() =>
              opened.setContent(
                Str.replace(/^<\?xml[^>]*>/u, "")(decoder.decode(bytes))
              )
            );

            const exported = yield* relativeCentres(
              opened,
              (id) => `#flake-pipeline-${view}-chapter-8-structure-${id}`
            );

            for (const [id, at] of Rec.toEntries(onScreen)) {
              const there = exported[id];

              assert.isDefined(there, id);
              assert.closeTo(
                there?.x ?? Number.NaN,
                at.x,
                1,
                `${view} ${id} x`
              );
              assert.closeTo(
                there?.y ?? Number.NaN,
                at.y,
                1,
                `${view} ${id} y`
              );
            }

            yield* Effect.promise(() => opened.close());
          }
        })
      ),
    60_000
  );

  it.live(
    "saves a PNG on white once the menu's background is ticked",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* lastChapter;

          yield* chooseWhite(page);

          const white = yield* exportFile(page, "png");

          assert.strictEqual(white.name, "flake-pipeline-iso-chapter-8.png");
          assert.deepStrictEqual(
            yield* cornerPixel(page, white.bytes),
            [255, 255, 255, 255]
          );
        })
      ),
    60_000
  );

  it.live(
    "saves the whole map as an Excalidraw file, whatever the chapter",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* lastChapter;

          // An early chapter: the file holds the whole map regardless.
          yield* click(
            page,
            '[data-chapter-rail] button[data-chapter="c-monday"]'
          );

          const { name, bytes } = yield* exportFile(page, "excalidraw");
          const file = yield* decodeExcalidraw(decoder.decode(bytes));

          assert.strictEqual(name, "flake-pipeline.excalidraw");
          // Every structure, not only the ones the chapter shows.
          assert.lengthOf(
            Arr.filter(file.elements, ({ type }) => type === "rectangle"),
            15
          );
        })
      ),
    60_000
  );

  it.live(
    "the menu works from the keyboard, gives focus back to its button, and Tab moves on from it",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* lastChapter;

          yield* Effect.promise(() =>
            page.locator('[data-control="export"]').focus()
          );
          yield* press(page, "Enter");
          yield* Effect.promise(() =>
            page.locator("[data-export-menu]").waitFor()
          );
          assert.strictEqual(yield* focusedControl(page), "svg");

          yield* press(page, "ArrowDown");
          assert.strictEqual(yield* focusedControl(page), "png");
          yield* press(page, "End");
          assert.strictEqual(yield* focusedControl(page), "background");

          // The background option is drawn as a checkbox in both states.
          const row = page.locator('[data-export-item="background"]');

          assert.include(yield* Effect.promise(() => row.textContent()), "☐");
          yield* press(page, " ");
          assert.include(yield* Effect.promise(() => row.textContent()), "☑");

          const checked = yield* Effect.promise(() =>
            page
              .locator('[data-export-item="background"]')
              .getAttribute("aria-checked")
          );

          assert.strictEqual(checked, "true");
          yield* press(page, "ArrowDown");
          assert.strictEqual(yield* focusedControl(page), "svg");
          yield* press(page, "ArrowUp");
          assert.strictEqual(yield* focusedControl(page), "background");

          // The map's keys stay off while the menu has focus.
          yield* press(page, "v");
          yield* Effect.promise(() =>
            page.locator('[data-walkthrough][data-view="iso"]').waitFor()
          );

          yield* press(page, "Escape");
          assert.strictEqual(
            yield* Effect.promise(() =>
              page.locator("[data-export-menu]").count()
            ),
            0
          );
          assert.strictEqual(yield* focusedControl(page), "export");

          // Tab from the open menu closes it and moves focus on, off the menu.
          yield* press(page, "Enter");
          yield* Effect.promise(() =>
            page.locator("[data-export-menu]").waitFor()
          );
          yield* press(page, "Tab");
          assert.strictEqual(
            yield* Effect.promise(() =>
              page.locator("[data-export-menu]").count()
            ),
            0
          );
          assert.isTrue(
            yield* inPage<boolean>(
              page,
              `document.activeElement !== document.body && document.activeElement.closest("[data-export-menu]") === null && document.activeElement.dataset.control !== "export"`
            ),
            "focus moved on from the menu"
          );
        })
      ),
    60_000
  );

  it.live(
    "writes map text with <, & and quotes literally, in a file that parses",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const files = yield* minimalMap;
          const data = files["pipeline/map/data.mjs"] ?? "";

          const opened = yield* buildAndOpen(
            {
              ...files,
              "pipeline/map/data.mjs": Arr.reduce(
                [
                  ['name: "Flake updater"', `name: 'Fish & "chips" <1>'`],
                  ['label: "update → build"', `label: 'a < b & "c"'`],
                  [
                    'title: "Flake update pipeline"',
                    `title: 'Q&A "live" <draft>'`,
                  ],
                ] as const,
                data,
                (text, [from, to]) => Str.replace(from, to)(text)
              ),
            },
            "pipeline"
          );

          const { name, bytes } = yield* exportFile(opened.page, "svg");
          const text = decoder.decode(bytes);
          const report = yield* svgReport(opened.page, text);

          assert.strictEqual(name, "pipeline-iso-chapter-1.svg");
          assert.include(report.titleText, 'Q&A "live" <draft>');
          assert.include(report.text, 'Fish & "chips" <1>');
          assert.include(report.text, 'a < b & "c"');
          assert.notInclude(text, "<draft>");
          assert.notInclude(text, "<1>");
        })
      ),
    60_000
  );

  it.live("says so and saves nothing when an export fails", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* lastChapter;

        // The SVG is drawn from the map's data, not read back from the page,
        // so a failure comes from the browser: a save that can't start, or a
        // picture it can't decode.
        yield* Effect.promise(() =>
          page.evaluate(
            `window.__saved = 0;
             document.addEventListener("click", (event) => { if (event.target instanceof HTMLAnchorElement && event.target.download) window.__saved += 1; }, true);
             URL.createObjectURL = () => { throw new Error("no saving"); };
             HTMLImageElement.prototype.decode = () => Promise.reject(new Error("no decoding"));`
          )
        );

        for (const item of ["svg", "png"]) {
          yield* click(page, '[data-control="export"]');
          yield* click(page, `[data-export-item="${item}"]`);
          yield* Effect.promise(() =>
            page
              .locator("[data-export-problem]")
              .filter({ hasText: "Nothing was saved" })
              .waitFor()
          );

          const live = yield* Effect.promise(() =>
            page.locator("[data-export-problem]").getAttribute("aria-live")
          );

          assert.strictEqual(live, "polite");
          assert.strictEqual(yield* inPage<number>(page, "window.__saved"), 0);
        }
      })
    )
  );
});
