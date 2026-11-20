import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Option } from "effect";

import {
  chapterStopsOf,
  edgeSpotsOf,
  fittedViewOf,
  gapBetween,
  handleRadius,
  handleStroke,
  hopStrikeOf,
  previewPieces,
  previewRoute,
  routeRevealed,
  sceneClashes,
  sceneFactsOf,
  sceneOf,
  straightLine,
  structureStrikeOf,
  views,
} from "../src/index.ts";
import type {
  MapData,
  Scene,
  ScreenPoint,
  ScreenRect,
  View,
} from "../src/index.ts";
import { fixture } from "./fixture-maps.ts";
import {
  crossesPolygon,
  lineDistance,
  rectCorners,
} from "./screen-geometry.ts";

// The geometry the editing layers draw on top of a scene, measured in screen
// pixels at the camera Zoom to fit gives. The pixel floors are written out
// here, apart from the constants the code keeps clear with.

const canvas = { height: 800, width: 1280 };

/** The fewest screen pixels an editing mark keeps from text. */
const minScreenClearance = 3;

const fitted = (name: string, view: View) =>
  Effect.gen(function* () {
    const { data, layout } = yield* fixture(name);
    const state = { data, layout, system: name };
    const stops = chapterStopsOf(state);
    const chapter = Arr.lastNonEmpty(stops);

    return {
      chapter,
      data,
      layout,
      view: fittedViewOf({ chapter, size: canvas, state, view }),
    };
  });

/** How far `point` is from `rect`, 0 inside it. */
const distanceToRect = (rect: ScreenRect, { sx, sy }: ScreenPoint) =>
  Math.hypot(
    Math.max(rect.left - sx, 0, sx - rect.right),
    Math.max(rect.top - sy, 0, sy - rect.bottom)
  );

const textOf = (scene: Scene): ReadonlyArray<ScreenRect> => [
  ...sceneFactsOf(scene).texts,
  ...Arr.flatMap(scene.zones, ({ title }) =>
    title === undefined
      ? []
      : [
          {
            bottom: Math.max(...Arr.map(title, ({ sy }) => sy)),
            left: Math.min(...Arr.map(title, ({ sx }) => sx)),
            right: Math.max(...Arr.map(title, ({ sx }) => sx)),
            top: Math.min(...Arr.map(title, ({ sy }) => sy)),
          },
        ]
  ),
];

/** The handles of every structure in `scene`. */
const handlesOf = (scene: Scene) =>
  Arr.flatMap(scene.structures, ({ structure }) =>
    edgeSpotsOf({ scene, structure: structure.id })
  );

/** The handles closer than 3 screen px to text, as readable lines. */
const handlesNearText = (scene: Scene, zoom: number) => {
  const edgePx = (handleRadius + handleStroke / 2) * zoom;

  return Arr.flatMap(handlesOf(scene), (spot) =>
    Arr.flatMap(sceneFactsOf(scene).texts, (rect) => {
      const gap = distanceToRect(rect, spot.at) * zoom - edgePx;

      return gap < minScreenClearance - 0.01
        ? [`${spot.id} is ${gap.toFixed(2)} px from text`]
        : [];
    })
  );
};

/** Where a hop's cross runs over text or a box, as readable lines. */
const strikeOver = (scene: Scene, hop: string) => {
  const strike = hopStrikeOf({ hop, scene });

  if (Option.isNone(strike)) {
    return [];
  }

  return Arr.flatMap(strike.value.lines, ([start, end]) => [
    ...Arr.flatMap(textOf(scene), (rect) =>
      crossesPolygon({ end, start }, rectCorners(rect))
        ? [`${hop} over text`]
        : []
    ),
    ...Arr.flatMap(scene.structures, ({ outline, structure }) =>
      crossesPolygon({ end, start }, outline)
        ? [`${hop} over ${structure.id}`]
        : []
    ),
  ]);
};

/** The structures whose strike runs over their own chip or name tag. */
const structureStrikeOver = (scene: Scene) =>
  Arr.flatMap(scene.structures, ({ chip, structure, tag }) => {
    const own = chip === undefined ? [tag] : [tag, chip];
    const pieces = structureStrikeOf({ scene, structure: structure.id });

    return Arr.some(pieces, (piece) =>
      Arr.some(own, (rect) => crossesPolygon(piece, rectCorners(rect)))
    )
      ? [structure.id]
      : [];
  });

/** The pieces of the preview of `line` that run over text. */
const previewOverText = (scene: Scene, line: ReadonlyArray<ScreenPoint>) =>
  Arr.filter(previewPieces({ line, scene }), (piece) =>
    Arr.some(textOf(scene), (rect) => crossesPolygon(piece, rectCorners(rect)))
  );

/** How far `point` is off the line through `a` and `b`. */
const offLine = (a: ScreenPoint, b: ScreenPoint, point: ScreenPoint) =>
  Math.abs(
    (b.sx - a.sx) * (point.sy - a.sy) - (b.sy - a.sy) * (point.sx - a.sx)
  ) / Math.hypot(b.sx - a.sx, b.sy - a.sy);

describe("edge handles", () => {
  for (const name of ["flake-pipeline", "review", "crowded"]) {
    for (const view of views) {
      it.effect(
        `keep 3 screen px from text on ${name} in the ${view} view`,
        () =>
          Effect.gen(function* () {
            const {
              view: { camera, scene },
            } = yield* fitted(name, view);

            assert.isAbove(handlesOf(scene).length, 0);
            assert.deepStrictEqual(handlesNearText(scene, camera.zoom), []);
          })
      );
    }
  }

  it.effect("are ports: one key each, made of the structure and the side", () =>
    Effect.gen(function* () {
      const {
        view: { scene },
      } = yield* fitted("review", "iso");

      const all = handlesOf(scene);

      assert.isNotEmpty(all);

      assert.lengthOf(
        Arr.dedupeWith(all, (a, b) => a.id === b.id),
        all.length
      );

      assert.deepStrictEqual(
        Arr.filter(all, (spot) => spot.id !== `${spot.owner}:${spot.side}`),
        []
      );
    })
  );

  it.effect("are none for a structure the scene doesn't draw", () =>
    Effect.gen(function* () {
      const {
        view: { scene },
      } = yield* fitted("review", "iso");

      assert.deepStrictEqual(edgeSpotsOf({ scene, structure: "nowhere" }), []);
    })
  );
});

describe("the cross on a hop proposed for deletion", () => {
  for (const name of ["flake-pipeline", "review"]) {
    for (const view of views) {
      it.effect(
        `clears every box and piece of text on ${name} in the ${view} view`,
        () =>
          Effect.gen(function* () {
            const {
              view: { scene },
            } = yield* fitted(name, view);

            const struck = Arr.filter(scene.hops, ({ hop }) =>
              Option.isSome(hopStrikeOf({ hop: hop.id, scene }))
            );

            assert.isNotEmpty(struck);

            assert.deepStrictEqual(
              Arr.flatMap(scene.hops, ({ hop }) => strikeOver(scene, hop.id)),
              []
            );
          })
      );
    }
  }

  it.effect("sits on its own route", () =>
    Effect.gen(function* () {
      const {
        view: { scene },
      } = yield* fitted("review", "plan");

      const far = Arr.flatMap(scene.hops, ({ hop, points }) =>
        Option.match(hopStrikeOf({ hop: hop.id, scene }), {
          onNone: () => [],
          onSome: ({ at }) => (lineDistance(points, at) < 0.01 ? [] : [hop.id]),
        })
      );

      assert.deepStrictEqual(far, []);
    })
  );

  it.effect("is nothing for a hop the scene doesn't draw", () =>
    Effect.gen(function* () {
      const {
        view: { scene },
      } = yield* fitted("review", "iso");

      assert.isTrue(Option.isNone(hopStrikeOf({ hop: "nowhere", scene })));
    })
  );

  it.effect("and the cross on a structure both keep clear of their text", () =>
    Effect.gen(function* () {
      for (const view of views) {
        const {
          view: { scene },
        } = yield* fitted("review", view);

        assert.deepStrictEqual(structureStrikeOver(scene), [], view);
      }
    })
  );
});

/** `data` with a hop from `from` to `to` that no proposal has accepted yet. */
const withPendingHop = (
  data: MapData,
  hop: { readonly from: string; readonly to: string }
): MapData => ({
  ...data,
  hops: [...data.hops, { ...hop, id: "pending", label: "asks" }],
});

describe("a pending hop's label", () => {
  for (const view of views) {
    it.effect(`clears every box and piece of text in the ${view} view`, () =>
      Effect.gen(function* () {
        const { data, layout } = yield* fixture("review");
        const revealed = new Set(Arr.map(data.structures, ({ id }) => id));

        const withHop = withPendingHop(data, {
          from: "engineer",
          to: "server",
        });

        const routes = routeRevealed({ data: withHop, layout, revealed });

        const scene = sceneOf({
          data: withHop,
          layout,
          revealed,
          routes,
          view,
        });

        const label = Arr.findFirst(
          scene.hops,
          ({ hop }) => hop.id === "pending"
        ).pipe(
          Option.flatMap(({ label: placed }) => Option.fromNullishOr(placed))
        );

        assert.isTrue(Option.isSome(label), "the label is placed");

        const over = Arr.filter(scene.structures, ({ outline }) =>
          Option.exists(label, (rect) => gapBetween(rect, outline) === 0)
        );

        assert.deepStrictEqual(
          Arr.map(over, ({ structure }) => structure.id),
          []
        );

        const clashes = Arr.filter(
          Arr.map(sceneClashes(scene), ({ between }) => between),
          (between) => Arr.some(between, (part) => part === "label:pending")
        );

        assert.deepStrictEqual(clashes, []);
      })
    );
  }
});

describe("the preview of a hop being drawn", () => {
  for (const view of views) {
    it.effect(
      `is routed to each structure and cut clear of text in the ${view} view`,
      () =>
        Effect.gen(function* () {
          const {
            chapter,
            data,
            layout,
            view: { scene },
          } = yield* fitted("review", view);

          const others = Arr.filter(
            scene.structures,
            ({ structure }) => structure.id !== "engineer"
          );

          const lines = Arr.getSomes(
            Arr.map(others, ({ structure }) =>
              previewRoute({
                data,
                from: "engineer",
                layout,
                revealed: chapter.revealed,
                to: structure.id,
                view,
              })
            )
          );

          assert.isNotEmpty(lines);

          for (const line of lines) {
            assert.isNotEmpty(previewPieces({ line, scene }));
            assert.deepStrictEqual(previewOverText(scene, line), []);
          }
        })
    );

    it.effect(`is one straight line over empty space in the ${view} view`, () =>
      Effect.gen(function* () {
        const {
          view: { scene },
        } = yield* fitted("review", view);

        const start = { sx: 0, sy: 0 };
        const line = straightLine({ end: { x: 9, y: 9 }, start, view });
        const [, end] = line;

        assert.isDefined(end);

        const pieces = previewPieces({ line, scene });

        assert.isNotEmpty(pieces);

        // Cut where it meets text, every piece still lies on the one line.
        const bent = Arr.filter(
          Arr.flatMap(pieces, (piece) => [piece.start, piece.end]),
          (point) => offLine(start, end ?? start, point) >= 1
        );

        assert.deepStrictEqual(bent, []);
      })
    );
  }
});
