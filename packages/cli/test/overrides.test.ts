import { LayoutFile } from "@axonometric/contracts";
import type { GridPoint } from "@axonometric/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Schema, String as Str } from "effect";

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

  it.effect.each([
    {
      broken: "too many points",
      // A staircase of 201 right-angled points, one over the cap.
      route: Arr.makeBy(201, (index) => ({
        x: 2 + Math.ceil(index / 2) / 2,
        y: 5 + Math.floor(index / 2) / 2,
      })),
      says: "expected at most 200 points",
    },
    {
      broken: "a point far off the map",
      route: [
        { x: 2, y: 5 },
        { x: 5000, y: 5 },
      ],
      says: "within 1000 units of the origin",
    },
  ])("check rejects an override with $broken", ({ route, says }) =>
    Effect.gen(function* () {
      const result = yield* checkIn(
        yield* withRawRoutes({ "h-update": route })
      );

      assert.notStrictEqual(result.exitCode, 0);
      assert.include(result.stdout, says);
    })
  );

  it.effect("check rejects an override that starts off its structure", () =>
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

        // The Iso view draws a ground unit along x as 36 right and 18 down,
        // and along y as 36 left and 18 down, so a drawn point turns back
        // into ground units this way.
        const ground = Arr.map(Str.split(drawn, " "), (pair) => {
          const [sx, sy] = Arr.map(Str.split(pair, ","), Number);
          const across = (sx ?? 0) / 36;
          const down = (sy ?? 0) / 18;

          return { x: (across + down) / 2, y: (down - across) / 2 };
        });

        assert.deepStrictEqual(ground, goodOverride);
      })
    )
  );
});
