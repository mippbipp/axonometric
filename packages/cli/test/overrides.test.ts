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
