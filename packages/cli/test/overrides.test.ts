import { LayoutFile, project } from "@axonometric/contracts";
import type { GridPoint } from "@axonometric/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Schema } from "effect";

import { minimalMap } from "./fixtures.ts";
import type { HomeFiles } from "./harness.ts";
import { buildAndOpen, makeHome, runCli } from "./harness.ts";

const layoutFile = "pipeline/map/layout.json";

const decodeLayout = Schema.decodeUnknownEffect(LayoutFile);

const encodeLayout = Schema.encodeEffect(LayoutFile);

/** JSON text for any value, with no layout schema in the way. */
const encodeRaw = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

/**
 * A route override for h-update from the updater (x 0–2, y 4–6) to the
 * gate (x 4–6, y 0–1.5): out of the updater's +x face, up, and into the
 * gate's -x face. The router wouldn't take it, so drawing it shows the
 * override was followed.
 */
const goodOverride: readonly GridPoint[] = [
  { x: 2, y: 5 },
  { x: 3, y: 5 },
  { x: 3, y: 1 },
  { x: 4, y: 1 },
];

/** The minimal map with `routes` written into its layout.json. */
const withRoutes = Effect.fnUntraced(function* (
  routes: Readonly<Record<string, readonly GridPoint[]>>
) {
  const files = yield* minimalMap;
  const saved = yield* decodeLayout(files[layoutFile] ?? "");

  const changed: HomeFiles = {
    ...files,
    [layoutFile]: yield* encodeLayout({ ...saved, routes }),
  };

  return changed;
});

/**
 * The minimal map with `routes` written into layout.json as text, the way a
 * person might write it. `withRoutes` encodes through the schema, which
 * refuses what these tests need to write.
 */
const withRawRoutes = Effect.fnUntraced(function* (
  routes: Readonly<Record<string, readonly GridPoint[]>>
) {
  const files = yield* minimalMap;
  const saved = yield* decodeLayout(files[layoutFile] ?? "");

  const changed: HomeFiles = {
    ...files,
    [layoutFile]: `${yield* encodeRaw({ ...saved, routes })}\n`,
  };

  return changed;
});

const checkIn = Effect.fnUntraced(function* (files: HomeFiles) {
  const home = yield* makeHome(files);

  return yield* runCli(home, ["check", `${home}/pipeline/map`]);
});

describe("route overrides", () => {
  it.effect("check passes an override that runs edge to edge", () =>
    Effect.gen(function* () {
      const result = yield* checkIn(
        yield* withRoutes({ "h-update": goodOverride })
      );

      assert.strictEqual(result.exitCode, 0, result.stdout + result.stderr);
      assert.include(result.stdout, ": 0 errors, 0 warnings.");
    })
  );

  it.effect("check rejects an override with too many points", () =>
    Effect.gen(function* () {
      // A staircase of 201 right-angled points, one over the cap.
      const many = Arr.makeBy(201, (index) => ({
        x: 2 + Math.ceil(index / 2) / 2,
        y: 5 + Math.floor(index / 2) / 2,
      }));

      const result = yield* checkIn(yield* withRawRoutes({ "h-update": many }));

      assert.notStrictEqual(result.exitCode, 0);
      assert.include(result.stdout, "expected at most 200 points");
    })
  );

  it.effect("check rejects an override that lies far off the map", () =>
    Effect.gen(function* () {
      const result = yield* checkIn(
        yield* withRawRoutes({
          "h-update": [
            { x: 2, y: 5 },
            { x: 5000, y: 5 },
          ],
        })
      );

      assert.notStrictEqual(result.exitCode, 0);
      assert.include(result.stdout, "within 1000 units of the origin");
    })
  );

  it.effect("check rejects an override whose end is off its structure", () =>
    Effect.gen(function* () {
      const result = yield* checkIn(
        yield* withRoutes({
          "h-update": [
            { x: 1, y: 5 },
            { x: 3, y: 5 },
            { x: 3, y: 1 },
            { x: 4, y: 1 },
          ],
        })
      );

      assert.notStrictEqual(result.exitCode, 0);
      assert.include(
        result.stdout,
        'error layout.json routes["h-update"]: hop "h-update"\'s route override starts at (1, 5), which isn\'t on the edge of "updater" at x 0–2, y 4–6. Move its first point onto that footprint\'s edge.'
      );
    })
  );

  it.live("build draws a hop along its override", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* buildAndOpen(
          yield* withRoutes({ "h-update": goodOverride }),
          "pipeline"
        );

        const drawn = yield* Effect.promise((): Promise<string> =>
          page.evaluate(
            `document.querySelector('[data-hop="h-update"]').dataset.route`
          )
        );

        const expected = Arr.join(
          Arr.map(goodOverride, (point) => {
            const { sx, sy } = project(point);

            return `${sx},${sy}`;
          }),
          " "
        );

        assert.strictEqual(drawn, expected);
      })
    )
  );
});
