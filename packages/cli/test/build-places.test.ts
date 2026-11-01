import { LayoutFile } from "@axonometric/contracts";
import type { Layout } from "@axonometric/contracts";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  Record as Rec,
  Schema,
  String as Str,
} from "effect";

import { minimalMap } from "./fixtures.ts";
import { makeHome, runCli } from "./harness.ts";

const dataFile = "pipeline/map/data.mjs";

const layoutFile = "pipeline/map/layout.json";

const decodeLayout = Schema.decodeUnknownEffect(LayoutFile);

const encodeLayout = Schema.encodeEffect(LayoutFile);

/** A structure with every required field, as data.mjs source. */
const structure = (id: string, group: string) =>
  `{ id: "${id}", code: "${Str.slice(0, 3)(Str.toUpperCase(id))}", name: "${id}", shape: "box", group: "${group}", status: "live", oneLiner: "One line.", whatItDoes: "Does.", howItsBuilt: "Built." }`;

/** A data.mjs with two groups, the given structures, and hops between them. */
const dataWith = (
  structures: readonly string[],
  hops: readonly (readonly [string, string])[] = []
) => `export default {
  format: 1,
  revision: 0,
  overview: { title: "Pipeline", summary: "A summary." },
  groups: [{ id: "front", title: "Front" }, { id: "back", title: "Back" }],
  structures: [${Arr.join(structures, ", ")}],
  hops: [${Arr.join(
    Arr.map(
      hops,
      ([from, to]) =>
        `{ id: "${from}-${to}", from: "${from}", to: "${to}", label: "calls" }`
    ),
    ", "
  )}],
  flows: [],
  chapters: [],
};
`;

const sixStructures = dataWith(
  [
    structure("web", "front"),
    structure("app", "front"),
    structure("cdn", "front"),
    structure("api", "back"),
    structure("db", "back"),
    structure("queue", "back"),
  ],
  [
    ["web", "api"],
    ["api", "db"],
    ["api", "queue"],
  ]
);

const buildIn = Effect.fnUntraced(function* (home: string) {
  return yield* runCli(home, ["build", `${home}/pipeline/map`]);
});

const layoutOf = Effect.fnUntraced(function* (
  files: Readonly<Partial<Record<string, string>>>
) {
  const text = files[layoutFile];

  assert.isDefined(text, "build wrote no layout.json");

  return yield* decodeLayout(text);
});

describe("build places structures", () => {
  it.effect(
    "places every structure of a map with no layout.json, and saves it",
    () =>
      Effect.gen(function* () {
        const home = yield* makeHome({ [dataFile]: sixStructures });
        const result = yield* buildIn(home);
        const layout = yield* layoutOf(result.files);

        assert.strictEqual(result.exitCode, 0, result.stderr);
        assert.strictEqual(result.stderr, "");
        assert.deepStrictEqual(Rec.keys(layout.structures), [
          "web",
          "app",
          "cdn",
          "api",
          "db",
          "queue",
        ]);
        assert.strictEqual(layout.revision, 1);
        assert.isString(result.files["pipeline/SYSTEM.md"]);

        const checked = yield* runCli(home, ["check", `${home}/pipeline/map`]);

        assert.include(checked.stdout, ": 0 errors, 0 warnings.");
      })
  );

  it.effect("gives the same layout every time for the same map", () =>
    Effect.gen(function* () {
      const first = yield* buildIn(
        yield* makeHome({ [dataFile]: sixStructures })
      );

      const second = yield* buildIn(
        yield* makeHome({ [dataFile]: sixStructures })
      );

      assert.strictEqual(first.files[layoutFile], second.files[layoutFile]);
    })
  );

  it.effect(
    "never moves a placed structure, and leaves layout.json alone when nothing changed",
    () =>
      Effect.gen(function* () {
        const home = yield* makeHome({ [dataFile]: sixStructures });
        const first = yield* buildIn(home);
        const again = yield* buildIn(home);

        assert.strictEqual(again.exitCode, 0, again.stderr);
        assert.strictEqual(again.files[layoutFile], first.files[layoutFile]);
      })
  );

  it.effect("places a new structure without moving the others", () =>
    Effect.gen(function* () {
      const home = yield* makeHome({ [dataFile]: sixStructures });
      const before = yield* layoutOf((yield* buildIn(home)).files);

      const grown = yield* makeHome({
        [dataFile]: dataWith(
          [
            structure("web", "front"),
            structure("app", "front"),
            structure("cdn", "front"),
            structure("api", "back"),
            structure("db", "back"),
            structure("queue", "back"),
            structure("cache", "back"),
          ],
          [["api", "cache"]]
        ),
        [layoutFile]: yield* encodeLayout(before),
      });

      const result = yield* buildIn(grown);
      const after = yield* layoutOf(result.files);

      assert.strictEqual(result.exitCode, 0, result.stderr);
      assert.deepStrictEqual(
        Rec.remove(after.structures, "cache"),
        before.structures
      );
      assert.isDefined(after.structures.cache);
      assert.strictEqual(after.revision, before.revision + 1);
      assert.strictEqual(result.stderr, "");
    })
  );

  it.effect(
    "check warns about an entry for a removed structure, and build removes it",
    () =>
      Effect.gen(function* () {
        const files = yield* minimalMap;

        const stale: Layout = {
          ...(yield* decodeLayout(files[layoutFile] ?? "")),
          revision: 4,
        };

        const home = yield* makeHome({
          ...files,
          [layoutFile]: yield* encodeLayout({
            ...stale,
            structures: {
              ...stale.structures,
              gone: { x: 20, y: 20, w: 2, d: 2 },
            },
          }),
        });

        const checked = yield* runCli(home, ["check", `${home}/pipeline/map`]);

        assert.strictEqual(checked.exitCode, 0);
        assert.include(
          checked.stdout,
          'warning layout.json structures.gone: no structure in data.mjs has the id "gone". build removes this entry.'
        );

        const built = yield* buildIn(home);
        const layout = yield* layoutOf(built.files);

        assert.strictEqual(built.exitCode, 0, built.stderr);
        assert.deepStrictEqual(layout.structures, stale.structures);
        assert.strictEqual(layout.revision, 5);
      })
  );

  it.effect(
    "check warns about an override for a removed hop, and build removes it",
    () =>
      Effect.gen(function* () {
        const files = yield* minimalMap;
        const saved = yield* decodeLayout(files[layoutFile] ?? "");

        const kept = [
          { x: 2, y: 5 },
          { x: 5, y: 5 },
          { x: 5, y: 1.5 },
        ];

        const home = yield* makeHome({
          ...files,
          [layoutFile]: yield* encodeLayout({
            ...saved,
            revision: 4,
            routes: {
              "h-update": kept,
              "h-gone": [
                { x: 0, y: 5 },
                { x: 4, y: 5 },
              ],
            },
          }),
        });

        const checked = yield* runCli(home, ["check", `${home}/pipeline/map`]);

        assert.strictEqual(checked.exitCode, 0);
        assert.include(
          checked.stdout,
          'warning layout.json routes["h-gone"]: no hop in data.mjs has the id "h-gone". build removes this route override.'
        );

        const built = yield* buildIn(home);
        const layout = yield* layoutOf(built.files);

        assert.strictEqual(built.exitCode, 0, built.stderr);
        assert.deepStrictEqual(layout.routes, { "h-update": kept });
        assert.deepStrictEqual(layout.structures, saved.structures);
        assert.strictEqual(layout.revision, 5);
        assert.include(
          built.stderr + built.stdout,
          'Removed the route override for "h-gone"'
        );
      })
  );

  it.effect("takes and releases the lock", () =>
    Effect.gen(function* () {
      const home = yield* makeHome({ [dataFile]: sixStructures });
      const result = yield* buildIn(home);

      assert.strictEqual(result.exitCode, 0, result.stderr);
      assert.isUndefined(result.files["pipeline/map/.axonometric/lock"]);
    })
  );
});
