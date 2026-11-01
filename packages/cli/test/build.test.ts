import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  Order,
  Record as Rec,
  String as Str,
} from "effect";

import { minimalMap } from "./fixtures.ts";
import { makeHome, runCli } from "./harness.ts";

const dataFile = "pipeline/map/data.mjs";

const layoutFile = "pipeline/map/layout.json";

interface PlacementInput {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly d: number;
}

const layoutWith = (structures: Readonly<Record<string, PlacementInput>>) => {
  const entries = Arr.map(
    Rec.toEntries(structures),
    ([id, { x, y, w, d }]) =>
      `"${id}": { "x": ${x}, "y": ${y}, "w": ${w}, "d": ${d} }`
  );

  return `{ "format": 1, "revision": 0, "structures": { ${Arr.join(entries, ", ")} } }`;
};

/** A structure with every required field, as data.mjs source. */
const structure = (id: string, name: string) =>
  `{ id: "${id}", code: "${id === "gate" ? "G" : "U"}", name: ${JSON.stringify(name)}, shape: "box", group: "pipeline", status: "live", oneLiner: "One line.", whatItDoes: "Does.", howItsBuilt: "Built." }`;

/** A data.mjs with the given structures and hops, and nothing else. */
const dataWith = (
  structures: readonly string[],
  hops = "[]"
) => `export default {
  format: 1,
  revision: 0,
  overview: { title: "Pipeline", summary: "A summary." },
  groups: [{ id: "pipeline", title: "Pipeline" }],
  structures: [${Arr.join(structures, ", ")}],
  hops: ${hops},
  flows: [],
  chapters: [],
};
`;

/** Builds the minimal map with some of its files replaced. */
const buildWith = Effect.fnUntraced(function* (
  files: Readonly<Record<string, string>>
) {
  const home = yield* makeHome({ ...(yield* minimalMap), ...files });

  return yield* runCli(home, ["build", `${home}/pipeline/map`]);
});

describe("build", () => {
  it.effect("writes SYSTEM.md and <system>.html next to the home folder", () =>
    Effect.gen(function* () {
      const result = yield* buildWith({});

      assert.strictEqual(result.stderr, "");
      assert.strictEqual(result.exitCode, 0);
      assert.isString(result.files["pipeline/SYSTEM.md"]);
      assert.isString(result.files["pipeline/pipeline.html"]);
    })
  );

  it.effect("lists both structures and the hop in SYSTEM.md", () =>
    Effect.gen(function* () {
      const result = yield* buildWith({});
      const systemMd = result.files["pipeline/SYSTEM.md"] ?? "";

      assert.include(systemMd, "# Flake update pipeline\n");
      assert.include(systemMd, "| `updater` | Flake updater |");
      assert.include(systemMd, "| `gate` | Build gate |");
      assert.include(
        systemMd,
        '| `h-update` | Flake updater → Build gate | update → build | `{"inputs":["nixpkgs"]}` |'
      );
    })
  );

  it.effect("writes a standalone page with the map inlined", () =>
    Effect.gen(function* () {
      const result = yield* buildWith({
        [dataFile]: dataWith([
          structure("updater", "Flake updater"),
          structure("gate", "</script><b>gate"),
        ]),
      });

      const page = result.files["pipeline/pipeline.html"] ?? "";

      assert.strictEqual(result.exitCode, 0);
      assert.match(
        page,
        /^<!doctype html>\s*<html[^>]*>\s*<head>\s*<meta charset="utf-8"/u
      );
      assert.include(
        page,
        '<script type="application/json" id="axonometric-map-state">'
      );
      assert.include(page, String.raw`"name":"\u003c/script>\u003cb>gate"`);
      assert.notInclude(page, "</script><b>gate");
      assert.notMatch(page, /<(?:link|script)[^>]+(?:src|href)=/u);
    })
  );

  it.effect("titles the page with the overview's title", () =>
    Effect.gen(function* () {
      const result = yield* buildWith({});
      const page = result.files["pipeline/pipeline.html"] ?? "";

      assert.include(
        page,
        "<title>Flake update pipeline · axonometric</title>"
      );
      assert.notInclude(page, "<title>axonometric</title>");
    })
  );

  it.effect("names the field, the file and the fix for invalid data", () =>
    Effect.gen(function* () {
      const result = yield* buildWith({
        [dataFile]: `export default {
  format: 1,
  revision: 0,
  structures: [{ id: "updater", name: "Flake updater" }, { id: 7, name: "Build gate" }],
  hops: [],
};
`,
      });

      assert.strictEqual(result.exitCode, 1);
      assert.include(
        result.stderr,
        "error data.mjs structures[1].id: expected a string. Give every structure an id."
      );
      assert.include(result.stderr, "build wrote nothing.");
    })
  );

  it.effect("rejects a hop to a structure that doesn't exist", () =>
    Effect.gen(function* () {
      const result = yield* buildWith({
        [dataFile]: dataWith(
          [structure("updater", "Flake updater")],
          '[{ id: "h", from: "updater", to: "nowhere", label: "x" }]'
        ),
        [layoutFile]: layoutWith({ updater: { x: 0, y: 0, w: 2, d: 2 } }),
      });

      assert.strictEqual(result.exitCode, 1);
      assert.include(
        result.stderr,
        'error data.mjs hops[0].to: no structure has the id "nowhere".'
      );
    })
  );

  it.effect("rejects a quarter-unit position in layout.json", () =>
    Effect.gen(function* () {
      const result = yield* buildWith({
        [layoutFile]: layoutWith({
          updater: { x: 0.25, y: 0, w: 2, d: 2 },
          gate: { x: 4.5, y: 3, w: 2, d: 1.5 },
        }),
      });

      assert.strictEqual(result.exitCode, 1);
      assert.include(
        result.stderr,
        "layout.json structures.updater.x: expected a whole or half grid unit, such as 2 or 2.5. Round x to the nearest half unit."
      );
    })
  );

  it.effect("rejects a quarter-unit footprint in layout.json", () =>
    Effect.gen(function* () {
      const result = yield* buildWith({
        [layoutFile]: layoutWith({
          updater: { x: 0, y: 0, w: 2, d: 2 },
          gate: { x: 4.5, y: 3, w: 1.75, d: 1.5 },
        }),
      });

      assert.strictEqual(result.exitCode, 1);
      assert.include(result.stderr, "layout.json structures.gate.w:");
    })
  );

  it.effect("rejects layout.json that isn't JSON", () =>
    Effect.gen(function* () {
      const result = yield* buildWith({ [layoutFile]: "{ structures: " });

      assert.strictEqual(result.exitCode, 1);
      assert.include(result.stderr, "layout.json:");
    })
  );

  it.effect("rejects data.mjs that doesn't import", () =>
    Effect.gen(function* () {
      const result = yield* buildWith({ [dataFile]: "export default {" });

      assert.strictEqual(result.exitCode, 1);
      assert.include(result.stderr, "data.mjs: could not be imported:");
    })
  );

  it.effect("reports problems in both files at once", () =>
    Effect.gen(function* () {
      const result = yield* buildWith({
        [dataFile]: "export default { format: 1, revision: 0, hops: [] };",
        [layoutFile]: '{ "format": 2, "revision": 0, "structures": {} }',
      });

      assert.strictEqual(result.exitCode, 1);
      assert.include(result.stderr, "data.mjs structures: missing.");
      assert.include(
        result.stderr,
        "layout.json format: format 2 is newer than this axonometric reads (format 1). Upgrade axonometric, then try again."
      );
    })
  );

  it.effect("leaves no temporary files behind when a write fails", () =>
    Effect.gen(function* () {
      // A folder where the page should go makes renaming the page fail.
      const result = yield* buildWith({
        "pipeline/pipeline.html/keep.txt": "not a page",
      });

      assert.notStrictEqual(result.exitCode, 0);
      assert.deepStrictEqual(
        Arr.filter(Rec.keys(result.files), (file) =>
          Str.endsWith(".tmp")(file)
        ),
        []
      );
    })
  );

  it.effect(
    "writes no map file, and leaves no lock, when the map is invalid",
    () =>
      Effect.gen(function* () {
        const result = yield* buildWith({
          [dataFile]: dataWith(
            [structure("updater", "Flake updater")],
            '[{ id: "h", from: "updater", to: "nowhere", label: "x" }]'
          ),
          [layoutFile]: layoutWith({}),
        });

        // The lock folder stays, holding only the .gitignore that keeps it
        // out of git.
        assert.strictEqual(result.exitCode, 1);
        assert.deepStrictEqual(Arr.sort(Rec.keys(result.files), Order.String), [
          "pipeline/map/.axonometric/.gitignore",
          dataFile,
          layoutFile,
        ]);
      })
  );
});
