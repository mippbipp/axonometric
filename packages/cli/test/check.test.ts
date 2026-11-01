import { LayoutFile, MapProblem } from "@axonometric/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Schema, String as Str } from "effect";

import { fullMap } from "./fixtures.ts";
import type { HomeFiles } from "./harness.ts";
import { makeHome, runCli } from "./harness.ts";

const dataFile = "review/map/data.mjs";

const layoutFile = "review/map/layout.json";

const CheckReport = Schema.Struct({
  home: Schema.String,
  ok: Schema.Boolean,
  errors: Schema.Array(MapProblem),
  warnings: Schema.Array(MapProblem),
});

const encodeLayout = Schema.encodeEffect(LayoutFile);

const decodeReport = Schema.decodeUnknownEffect(
  Schema.fromJsonString(CheckReport)
);

/** Runs `check` on the full map with some of its files replaced. */
const checkWith = Effect.fnUntraced(function* (
  files: HomeFiles,
  flags: readonly string[] = []
) {
  const home = yield* makeHome({ ...(yield* fullMap), ...files });

  return yield* runCli(home, ["check", ...flags, `${home}/review/map`]);
});

/**
 * The full map's data.mjs with `edit` applied to the default export, so a
 * test can break one thing.
 */

/**
 * The full map's data.mjs with `edit` applied to the map before it's
 * exported, so a test can break one thing. `edit` is JS that changes `data`.
 */
const editData = Effect.fnUntraced(function* (edit: string) {
  const original = (yield* fullMap)[dataFile] ?? "";

  return {
    [dataFile]: `${Str.replace("export default {", "const data = {")(original)}
${edit}
export default data;
`,
  };
});

describe("check", () => {
  it.effect("passes the full map and writes nothing", () =>
    Effect.gen(function* () {
      const before = yield* fullMap;
      const result = yield* checkWith({});

      assert.strictEqual(result.exitCode, 0, result.stdout + result.stderr);
      assert.include(result.stdout, ": 0 errors, 0 warnings.");
      assert.deepStrictEqual(result.files, before);
    })
  );

  it.effect("prints errors and warnings as JSON", () =>
    Effect.gen(function* () {
      const result = yield* checkWith(
        yield* editData(`data.groups.push({ id: "spare", title: "Spare" });
data.structures[1].status = "retired";`),
        ["--json"]
      );

      const report = yield* decodeReport(result.stdout);

      assert.strictEqual(result.exitCode, 1);
      assert.isFalse(report.ok);
      assert.deepStrictEqual(
        Arr.map(report.errors, ({ severity, file, path }) => ({
          severity,
          file,
          path,
        })),
        [{ severity: "error", file: "data.mjs", path: "structures[1].status" }]
      );
      assert.include(report.errors[0]?.message ?? "", "live, planned, off");
      assert.deepStrictEqual(report.warnings, []);
    })
  );

  it.effect("exits 0 on warnings alone, and build still writes", () =>
    Effect.gen(function* () {
      const files = yield* editData(
        'data.groups.push({ id: "spare", title: "Spare" });'
      );

      const checked = yield* checkWith(files, ["--json"]);
      const report = yield* decodeReport(checked.stdout);
      const home = yield* makeHome({ ...(yield* fullMap), ...files });
      const built = yield* runCli(home, ["build", `${home}/review/map`]);

      assert.strictEqual(checked.exitCode, 0);
      assert.isTrue(report.ok);
      assert.deepStrictEqual(
        Arr.map(report.warnings, ({ severity, path }) => ({ severity, path })),
        [{ severity: "warning", path: "groups[3]" }]
      );
      assert.strictEqual(built.exitCode, 0, built.stderr);
      assert.include(
        built.stderr,
        'warning data.mjs groups[3]: group "spare" has no structures'
      );
      assert.isString(built.files["review/SYSTEM.md"]);
    })
  );

  it.effect("prints each problem as text with a count, and exits 1", () =>
    Effect.gen(function* () {
      const result = yield* checkWith(
        yield* editData("data.structures[0].ghost = true;")
      );

      assert.strictEqual(result.exitCode, 1);
      assert.include(
        result.stdout,
        "error data.mjs structures[0].ghost: ghost was replaced by status."
      );
      assert.include(result.stdout, ": 1 error, 0 warnings.");
    })
  );

  it.effect("points positions and sizes in data.mjs to layout.json", () =>
    Effect.gen(function* () {
      const result = yield* checkWith(
        yield* editData("data.structures[2].x = 4; data.structures[2].w = 2;")
      );

      assert.strictEqual(result.exitCode, 1);
      assert.include(
        result.stdout,
        "error data.mjs structures[2].x: x doesn't belong in data.mjs. Positions and sizes live in layout.json"
      );
      assert.include(result.stdout, "error data.mjs structures[2].w:");
    })
  );

  it.effect("lists the valid shapes for an unknown one", () =>
    Effect.gen(function* () {
      const result = yield* checkWith(
        yield* editData('data.structures[0].shape = "circle";')
      );

      assert.include(
        result.stdout,
        "error data.mjs structures[0].shape: expected one of box, tall, store, cards, slab, screen, gate, job, person, document, external."
      );
    })
  );

  it.effect("rejects a duplicate question id", () =>
    Effect.gen(function* () {
      const result = yield* checkWith(
        yield* editData('data.structures[2].questions[0].id = "Q-P1";')
      );

      assert.strictEqual(result.exitCode, 1);
      assert.include(
        result.stdout,
        'error data.mjs structures[2].questions[0].id: another question already uses "Q-P1".'
      );
    })
  );

  it.effect("rejects a question id that isn't Q-<code><n>", () =>
    Effect.gen(function* () {
      const result = yield* checkWith(
        yield* editData('data.structures[2].questions[0].id = "Q-s1";')
      );

      assert.include(
        result.stdout,
        "error data.mjs structures[2].questions[0].id: expected an id of the form Q-<code><n>"
      );
    })
  );

  it.effect("rejects a resolved question with no answer, author or date", () =>
    Effect.gen(function* () {
      const result = yield* checkWith(
        yield* editData(`const question = data.structures[1].questions[1];
delete question.answer;
delete question.answeredBy;
delete question.answeredOn;`)
      );

      const at = "error data.mjs structures[1].questions[1]";

      assert.strictEqual(result.exitCode, 1);
      assert.include(result.stdout, `${at}.answer: missing.`);
      assert.include(result.stdout, `${at}.answeredBy: missing.`);
      assert.include(result.stdout, `${at}.answeredOn: missing.`);
    })
  );

  it.effect("names where an unknown hop, structure or group is used", () =>
    Effect.gen(function* () {
      const result = yield* checkWith(
        yield* editData(`data.flows[0].hops.push("h-gone");
data.chapters[2].plays.push("h-missing");
data.chapters[1].reveals.push("nobody");
data.structures[3].group = "elsewhere";`)
      );

      assert.strictEqual(result.exitCode, 1);
      assert.include(
        result.stdout,
        'error data.mjs flows[0].hops[3]: no hop has the id "h-gone".'
      );
      assert.include(
        result.stdout,
        'error data.mjs chapters[2].plays[0]: no hop has the id "h-missing".'
      );
      assert.include(
        result.stdout,
        'error data.mjs chapters[1].reveals[2]: no structure has the id "nobody".'
      );
      assert.include(
        result.stdout,
        'error data.mjs structures[3].group: no group has the id "elsewhere".'
      );
    })
  );

  it.effect(
    "rejects a chapter that plays a hop to a structure not yet revealed",
    () =>
      Effect.gen(function* () {
        const result = yield* checkWith(
          yield* editData('data.chapters[0].plays.push("h-save");')
        );

        assert.strictEqual(result.exitCode, 1);
        assert.include(
          result.stdout,
          'error data.mjs chapters[0].plays[1]: hop "h-save" touches "server", which no chapter has revealed by chapter "c-page".'
        );
      })
  );

  it.effect("counts structures revealed by earlier chapters", () =>
    Effect.gen(function* () {
      const result = yield* checkWith(
        yield* editData('data.chapters[2].plays.push("h-note", "h-pr");')
      );

      assert.strictEqual(result.exitCode, 0, result.stdout);
    })
  );

  it.effect("rejects a walkthrough that never reveals some structures", () =>
    Effect.gen(function* () {
      const result = yield* checkWith(
        yield* editData("data.chapters[2].reveals = [];")
      );

      assert.strictEqual(result.exitCode, 1);
      assert.include(
        result.stdout,
        'error data.mjs chapters[2].reveals: the last chapter must leave every structure revealed, but no chapter reveals "pull-request", "upstream".'
      );
    })
  );

  it.effect("accepts a map with no chapters", () =>
    Effect.gen(function* () {
      const result = yield* checkWith(yield* editData("data.chapters = [];"));

      assert.strictEqual(result.exitCode, 0, result.stdout);
    })
  );

  it.effect("reports ADR and deep dive links that don't resolve", () =>
    Effect.gen(function* () {
      const result = yield* checkWith(
        yield* editData(`data.overview.decisions[0].adr = "docs/adr/0001-local-server.md";
data.overview.deepDives[0].link = "research/missing.md#top";`)
      );

      assert.strictEqual(result.exitCode, 1);
      assert.include(
        result.stdout,
        'error data.mjs overview.decisions[0].adr: "docs/adr/0001-local-server.md" doesn\'t resolve to a file. Links are relative to SYSTEM.md'
      );
      assert.include(
        result.stdout,
        'error data.mjs overview.deepDives[0].link: "research/missing.md#top"'
      );
    })
  );

  it.effect("reports problems in both files", () =>
    Effect.gen(function* () {
      const result = yield* checkWith({
        ...(yield* editData('data.structures[0].status = "ghost";')),
        [layoutFile]: '{ "format": 1, "revision": 0 }',
      });

      assert.strictEqual(result.exitCode, 1);
      assert.include(result.stdout, "error data.mjs structures[0].status:");
      assert.include(result.stdout, "error layout.json structures: missing.");
    })
  );

  it.effect("warns about overlapping footprints and covered name tags", () =>
    Effect.gen(function* () {
      const result = yield* checkWith(
        {
          [layoutFile]: yield* encodeLayout({
            format: 1,
            revision: 0,
            structures: {
              engineer: { x: 0, y: 0, w: 2, d: 2 },
              page: { x: 1, y: 1, w: 2, d: 2 },
              server: { x: 8, y: 0, w: 2, d: 2 },
              proposals: { x: 10, y: 2, w: 2, d: 2 },
              "pull-request": { x: 12, y: 8, w: 2, d: 1.5 },
              upstream: { x: 16, y: 0, w: 2, d: 2 },
            },
          }),
        },
        ["--json"]
      );

      const report = yield* decodeReport(result.stdout);

      assert.strictEqual(result.exitCode, 0, result.stdout);
      assert.deepStrictEqual(
        Arr.map(report.warnings, ({ path, message }) => `${path}: ${message}`),
        [
          'structures.page: footprint overlaps "engineer". Move one of them, for example with axonometric layout <home> page --x <x> --y <y>.',
          'structures.engineer: name tag is drawn on top of "page". Move one of them apart, so the tag under the front corner has room.',
          'structures.server: name tag is drawn on top of "proposals". Move one of them apart, so the tag under the front corner has room.',
          ': the zones of groups "people" and "loop" overlap. Move one group\'s structures away from the other, for example with axonometric layout <home> <id> --x <x> --y <y>.',
        ]
      );
    })
  );

  it.effect("warns when two groups' zones overlap, naming both groups", () =>
    Effect.gen(function* () {
      // upstream, in the outside group, sits one unit from server, in the
      // loop group: the footprints and tags are clear, the zones aren't.
      const result = yield* checkWith({
        [layoutFile]: yield* encodeLayout({
          format: 1,
          revision: 0,
          structures: {
            engineer: { x: 0, y: 0, w: 2, d: 2 },
            page: { x: 6, y: 0, w: 2, d: 2 },
            server: { x: 10, y: 0, w: 2, d: 2 },
            proposals: { x: 10, y: 6, w: 2, d: 2 },
            "pull-request": { x: 14, y: 6, w: 2, d: 1.5 },
            upstream: { x: 15, y: 0, w: 2, d: 2 },
          },
        }),
      });

      assert.strictEqual(result.exitCode, 0, result.stdout);
      assert.include(
        result.stdout,
        'warning layout.json: the zones of groups "loop" and "outside" overlap.'
      );
      assert.include(result.stdout, ": 0 errors, 1 warning.");
    })
  );

  it.effect("stops build on the same errors", () =>
    Effect.gen(function* () {
      const files = yield* editData('data.chapters[0].plays.push("h-save");');
      const home = yield* makeHome({ ...(yield* fullMap), ...files });
      const result = yield* runCli(home, ["build", `${home}/review/map`]);

      assert.strictEqual(result.exitCode, 1);
      assert.include(result.stderr, "build wrote nothing.");
      assert.include(result.stderr, "error data.mjs chapters[0].plays[1]:");
      assert.isUndefined(result.files["review/SYSTEM.md"]);
    })
  );
});
