import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  Option,
  Record as Rec,
  Schema,
  String as Str,
} from "effect";
import type { Page } from "playwright";

import { minimalMap, pipelineMap } from "./fixtures.ts";
import { buildAndOpen } from "./harness.ts";

/** `value` as a JavaScript string literal, newlines and all. */
// oxlint-disable-next-line effecttsgo/prefer-schema-over-json -- a JSON string is a JavaScript string literal
const jsString = (value: string) => JSON.stringify(value);

const inPage = <A>(page: Page, expression: string) =>
  Effect.promise(() => page.evaluate<A>(expression));

const click = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).first().click());

const press = (page: Page, key: string) =>
  Effect.promise(() => page.keyboard.press(key));

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
  readonly classes: number;
  readonly styles: number;
  readonly hiddenParts: number;
  readonly drawnParts: number;
}

/** Parses an SVG file in the page and reports what's in it. */
const svgReport = (page: Page, text: string) =>
  inPage<SvgReport>(
    page,
    `(() => {
      const doc = new DOMParser().parseFromString(${jsString(text)}, "image/svg+xml");
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
      const drawn = root.querySelectorAll("rect, polygon, polyline, path, circle, ellipse, line");
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
        classes: root.querySelectorAll("[class]").length,
        styles: root.querySelectorAll("style, [style]").length,
        hiddenParts: [...drawn].filter((element) => element.closest('[aria-hidden="true"]') !== null).length,
        drawnParts: drawn.length,
      };
    })()`
  );

const decoder = new TextDecoder();

/** A PNG's size in pixels, from its IHDR chunk. */
const pngSize = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  return { width: view.getUint32(16), height: view.getUint32(20) };
};

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
      const selector = (id) => ${jsString(selector("@"))}.replace("@", id);
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
          assert.deepStrictEqual(
            Arr.filter(report.references, (id) => !report.ids.includes(id)),
            []
          );
          assert.strictEqual(report.classes, 0);
          assert.strictEqual(report.styles, 0);
          assert.isAbove(report.hiddenParts, report.drawnParts / 2);
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

            const opened = yield* Effect.promise(
              () =>
                page.context().browser()?.newPage() ??
                Promise.reject(new Error("The page has no browser."))
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
    "saves a PNG at twice the SVG's size, on paper or on white",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* lastChapter;
          const svg = yield* exportFile(page, "svg");

          const size = yield* inPage<{ width: number; height: number }>(
            page,
            `(() => {
              const root = new DOMParser().parseFromString(${jsString(decoder.decode(svg.bytes))}, "image/svg+xml").documentElement;
              return { width: Number(root.getAttribute("width")), height: Number(root.getAttribute("height")) };
            })()`
          );

          const png = yield* exportFile(page, "png");

          assert.strictEqual(png.name, "flake-pipeline-iso-chapter-8.png");
          assert.deepStrictEqual(pngSize(png.bytes), {
            width: size.width * 2,
            height: size.height * 2,
          });

          const paper = yield* cornerPixel(page, png.bytes);

          assert.deepStrictEqual(paper, [230, 223, 190, 255]);

          yield* chooseWhite(page);

          const white = yield* exportFile(page, "png");

          assert.deepStrictEqual(
            yield* cornerPixel(page, white.bytes),
            [255, 255, 255, 255]
          );
        })
      ),
    60_000
  );

  it.live(
    "saves the whole map as an Excalidraw file with bound arrows and frames",
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

          const byId = new Map(
            Arr.map(file.elements, (element) => [element.id, element])
          );

          const count = (type: string) =>
            Arr.filter(file.elements, (element) => element.type === type)
              .length;

          assert.strictEqual(name, "flake-pipeline.excalidraw");
          assert.strictEqual(byId.size, file.elements.length);
          assert.strictEqual(count("rectangle"), 15);
          assert.strictEqual(count("arrow"), 29);
          assert.strictEqual(count("frame"), 4);
          assert.strictEqual(count("text"), 15 + 29);

          for (const element of file.elements) {
            for (const binding of [element.startBinding, element.endBinding]) {
              if (binding !== undefined && binding !== null) {
                assert.strictEqual(
                  byId.get(binding.elementId)?.type,
                  "rectangle"
                );
              }
            }

            if (element.type === "arrow") {
              assert.isDefined(element.startBinding ?? undefined);
              assert.isDefined(element.endBinding ?? undefined);
            }

            for (const bound of element.boundElements) {
              assert.strictEqual(byId.get(bound.id)?.type, bound.type);
            }

            const container = Option.fromNullishOr(element.containerId);

            if (Option.isSome(container)) {
              assert.isDefined(byId.get(container.value));
            }

            if (element.frameId !== null) {
              assert.strictEqual(byId.get(element.frameId)?.type, "frame");
            }
          }
        })
      ),
    60_000
  );

  it.live(
    "the menu works from the keyboard and gives focus back to its button",
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
          yield* press(page, " ");

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

  it.live("gives the SVG ids that depend only on the map, not on React", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* lastChapter;
        const { bytes } = yield* exportFile(page, "svg");
        const report = yield* svgReport(page, decoder.decode(bytes));

        assert.isTrue(
          Arr.some(report.ids, Str.endsWith("pattern-1")),
          "the hatch pattern has a plain id"
        );
        assert.isFalse(
          Arr.some(report.ids, Str.includes("_r_")),
          "no id comes from useId"
        );
      })
    )
  );

  it.live("draws the background option as a checkbox in both states", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* lastChapter;
        const row = page.locator('[data-export-item="background"]');

        yield* click(page, '[data-control="export"]');
        assert.include(yield* Effect.promise(() => row.textContent()), "☐");
        yield* click(page, '[data-export-item="background"]');
        assert.include(yield* Effect.promise(() => row.textContent()), "☑");
      })
    )
  );

  it.live("Tab hands focus to the Export button, then moves on from it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* lastChapter;

        yield* click(page, '[data-control="export"]');
        yield* press(page, "Tab");
        assert.strictEqual(
          yield* Effect.promise(() =>
            page.locator("[data-export-menu]").count()
          ),
          0
        );
        assert.strictEqual(
          yield* inPage<string>(
            page,
            `document.activeElement === document.body ? "body" : document.activeElement.hasAttribute("data-theme-toggle") ? "next" : document.activeElement.tagName`
          ),
          "next"
        );
      })
    )
  );

  it.live("says so and saves nothing when an export fails", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* lastChapter;

        yield* inPage<undefined>(
          page,
          `document.querySelector("[data-map-layer] [data-viewport]").removeAttribute("data-viewport")`
        );
        yield* Effect.promise(() =>
          page.evaluate(
            `window.__saved = 0; document.addEventListener("click", (event) => { if (event.target instanceof HTMLAnchorElement && event.target.download) window.__saved += 1; }, true)`
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
