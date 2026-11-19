import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Option, String as Str } from "effect";

import {
  checkLayout,
  groundProjections,
  routeRevealed,
  sceneClashes,
  sceneOf,
  views,
} from "../src/index.ts";
import type { MapData, Layout, Scene, ScreenRect, View } from "../src/index.ts";
import { chaptersOf, everything, fixture } from "./fixture-maps.ts";
import {
  crossesPolygon,
  lineDistance,
  rectCorners,
} from "./screen-geometry.ts";

// What a hop label has to satisfy, measured here with the screen geometry
// the tests keep apart from the scene's own.

/** The farthest a label's box may sit from its own route, in grid units. */
const reach: Readonly<Record<View, number>> = { iso: 1.5, plan: 2.5 };

/** How far a rect is from a route: its nearest corner or edge midpoint. */
const gapTo = (
  points: Scene["hops"][number]["points"],
  { left, right, top, bottom }: ScreenRect
) => {
  const box = { left, right, top, bottom };

  if (
    Arr.some(Arr.zip(points, Arr.drop(points, 1)), ([start, end]) =>
      crossesPolygon({ start, end }, rectCorners(box))
    )
  ) {
    return 0;
  }

  const middle = { sx: (left + right) / 2, sy: (top + bottom) / 2 };

  return Math.min(
    ...Arr.map(
      [
        ...rectCorners(box),
        { sx: middle.sx, sy: top },
        { sx: middle.sx, sy: bottom },
        { sx: left, sy: middle.sy },
        { sx: right, sy: middle.sy },
      ],
      (point) => lineDistance(points, point)
    )
  );
};

const throughRect = (
  points: Scene["hops"][number]["points"],
  rect: ScreenRect
) =>
  Arr.some(Arr.zip(points, Arr.drop(points, 1)), ([start, end]) =>
    crossesPolygon({ start, end }, rectCorners(rect))
  );

const rectsOverlap = (a: ScreenRect, b: ScreenRect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** What's wrong with the placed labels of a scene, as readable lines. */
const labelProblems = (scene: Scene) =>
  Arr.flatMap(scene.hops, ({ hop, points, label }) => {
    if (label === undefined) {
      return [];
    }

    const others = Arr.filter(scene.hops, (other) => other.hop.id !== hop.id);
    const own = gapTo(points, label);

    const onOwn = throughRect(points, label)
      ? [`${hop.id}: its label sits on its own route`]
      : [];

    const onOther = Arr.flatMap(others, (other) =>
      throughRect(other.points, label)
        ? [`${hop.id}: its label sits on ${other.hop.id}'s route`]
        : []
    );

    const far =
      own > reach[scene.view] * groundProjections[scene.view].unit
        ? [`${hop.id}: its label is ${own.toFixed(1)} from its route`]
        : [];

    // Plan view never puts a label nearer another route than its own.
    const nearer =
      scene.view === "plan"
        ? Arr.flatMap(others, (other) =>
            gapTo(other.points, label) < own
              ? [`${hop.id}: its label is nearer ${other.hop.id}'s route`]
              : []
          )
        : [];

    const over = Arr.flatMap(others, (other) =>
      other.label !== undefined &&
      other.hop.id > hop.id &&
      rectsOverlap(label, other.label)
        ? [`${hop.id}: its label overlaps ${other.hop.id}'s`]
        : []
    );

    return [...onOwn, ...onOther, ...far, ...nearer, ...over];
  });

const chaptersFor = (data: MapData) =>
  Arr.isReadonlyArrayNonEmpty(data.chapters)
    ? chaptersOf(data)
    : [{ id: "all", plays: [], revealed: everything(data) }];

const sceneIn = ({
  data,
  layout,
  chapter,
  routes = routeRevealed({ data, layout, revealed: chapter.revealed }),
  view,
  zoom,
}: {
  readonly data: MapData;
  readonly layout: Layout;
  readonly chapter: ReturnType<typeof chaptersFor>[number];
  readonly routes?: ReturnType<typeof routeRevealed>;
  readonly view: View;
  readonly zoom: number;
}) =>
  sceneOf({
    data,
    layout,
    revealed: chapter.revealed,
    routes,
    labelFirst: chapter.plays,
    view,
    zoom,
  });

/** Plan view at full size, and zoomed out so the map fits a 1280 × 800 page. */
const zooms = [1, 0.6, 0.4241];

/** A map of two structures and the hop `h` between them, with `chapters`. */
const mapWith = (chapters: MapData["chapters"]): MapData => ({
  format: 1,
  revision: 0,
  overview: { title: "Map", summary: "A map." },
  groups: [{ id: "main", title: "Main" }],
  structures: Arr.map(["a", "b"], (id) => ({
    id,
    code: "S",
    name: id,
    shape: "box" as const,
    group: "main",
    status: "live" as const,
    oneLiner: "One line.",
    whatItDoes: "Does.",
    howItsBuilt: "Built.",
  })),
  hops: [
    {
      id: "h",
      from: "a",
      to: "b",
      label: "a label too wide for the gap",
      payload: {},
    },
  ],
  flows: [],
  chapters,
});

const chapterOf = (id: string, plays: readonly string[]) => ({
  id,
  title: id,
  lede: "Lede.",
  story: "Story.",
  reveals: ["a", "b"],
  plays,
});

describe("hop labels", () => {
  for (const name of [
    "plan-labels",
    "flake-pipeline",
    "review",
    "crowded",
    "shapes",
    "pipeline",
  ]) {
    for (const view of views) {
      it.effect(
        `sit near their own routes, off every route and each other, in ${name}, ${view} view`,
        () =>
          Effect.gen(function* () {
            const { data, layout } = yield* fixture(name);

            for (const chapter of chaptersFor(data)) {
              const routes = routeRevealed({
                data,
                layout,
                revealed: chapter.revealed,
              });

              for (const zoom of zooms) {
                const scene = sceneIn({
                  data,
                  layout,
                  chapter,
                  routes,
                  view,
                  zoom,
                });

                assert.deepStrictEqual(
                  labelProblems(scene),
                  [],
                  `in chapter ${chapter.id} at zoom ${zoom}`
                );
              }
            }
          }),
        60_000
      );
    }
  }

  it.effect("are reported by sceneClashes when one sits on its own route", () =>
    Effect.gen(function* () {
      const { data, layout } = yield* fixture("plan-labels");

      const chapter = Option.getOrThrow(Arr.head(chaptersFor(data)));
      const scene = sceneIn({ data, layout, chapter, view: "plan", zoom: 1 });

      const first = Option.getOrThrow(
        Arr.findFirst(scene.hops, ({ label }) => label !== undefined)
      );

      const [start, end] = Option.getOrThrow(
        Option.all([Arr.head(first.points), Arr.get(first.points, 1)])
      );

      const at = {
        sx: (start.sx + end.sx) / 2,
        sy: (start.sy + end.sy) / 2,
      };

      const moved = {
        ...scene,
        hops: Arr.map(scene.hops, (hop) =>
          hop === first
            ? {
                ...hop,
                label: {
                  left: at.sx - 20,
                  right: at.sx + 20,
                  top: at.sy - 7,
                  bottom: at.sy + 7,
                },
              }
            : hop
        ),
      };

      assert.deepStrictEqual(
        Arr.map(sceneClashes(moved), ({ between }) => between),
        [[`route:${first.hop.id}`, `label:${first.hop.id}`]]
      );
    })
  );

  describe("with no room beside the route", () => {
    // The boxes are tall and half a unit apart, so no spot beside the route
    // is within reach of it and clear of both boxes.
    const layout: Layout = {
      format: 1,
      revision: 0,
      structures: {
        a: { x: 0, y: 0, w: 2, d: 6 },
        b: { x: 2.5, y: 0, w: 2, d: 6 },
      },
      routes: {},
    };

    const hiddenLabelWarnings = (data: MapData) =>
      Arr.filter(
        Arr.map(checkLayout(data, layout), ({ message }) => message),
        Str.includes("has no clear spot beside its route")
      );

    it.effect(
      "warns once per hop in Plan view, whether a chapter plays it",
      () =>
        Effect.sync(() => {
          // The first chapter plays the hop and the second plays nothing but
          // shows it again; the warning comes once, at the first.
          const data = mapWith([chapterOf("c1", ["h"]), chapterOf("c2", [])]);

          assert.deepStrictEqual(hiddenLabelWarnings(data), [
            'the label of hop "h" has no clear spot beside its route in chapter "c1" in Plan view, so the drawing leaves it out and it shows only on hover. Move the structures it passes apart, or shorten the label.',
          ]);
        })
    );

    it.effect("warns about a hop only a chapter that plays nothing shows", () =>
      Effect.sync(() => {
        const data = mapWith([chapterOf("c-all", [])]);

        assert.deepStrictEqual(hiddenLabelWarnings(data), [
          'the label of hop "h" has no clear spot beside its route in chapter "c-all" in Plan view, so the drawing leaves it out and it shows only on hover. Move the structures it passes apart, or shorten the label.',
        ]);
      })
    );

    it.effect("warns about a map with no chapters, which draws all of it", () =>
      Effect.sync(() => {
        const data = mapWith([]);

        assert.deepStrictEqual(hiddenLabelWarnings(data), [
          'the label of hop "h" has no clear spot beside its route in Plan view, so the drawing leaves it out and it shows only on hover. Move the structures it passes apart, or shorten the label.',
        ]);
      })
    );
  });
});
