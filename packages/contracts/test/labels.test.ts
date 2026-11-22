import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  Option,
  Record as Rec,
  String as Str,
} from "effect";

import {
  groundProjections,
  playSpotlightOf,
  routeRevealed,
  sceneClashes,
  sceneOf,
  views,
} from "../src/index.ts";
import type {
  FlowChoice,
  Layout,
  MapData,
  Scene,
  ScreenRect,
  View,
} from "../src/index.ts";
import allFlowsLabels from "./all-flows-labels.json" with { type: "json" };
import { chaptersOf, everything, fixture } from "./fixture-maps.ts";
import { layoutProblems } from "./layout-problems.ts";
import {
  crossesPolygon,
  labelReach,
  lineDistance,
  rectCorners,
} from "./screen-geometry.ts";

// What a hop label has to satisfy, measured here with the screen geometry
// the tests keep apart from the scene's own.

const throughRect = (
  points: Scene["hops"][number]["points"],
  rect: ScreenRect
) =>
  Arr.some(Arr.zip(points, Arr.drop(points, 1)), ([start, end]) =>
    crossesPolygon({ end, start }, rectCorners(rect))
  );

/** How far a rect is from a route: its nearest corner or edge midpoint. */
const gapTo = (points: Scene["hops"][number]["points"], rect: ScreenRect) => {
  if (throughRect(points, rect)) {
    return 0;
  }

  const { bottom, left, right, top } = rect;
  const middle = { sx: (left + right) / 2, sy: (top + bottom) / 2 };

  return Math.min(
    ...Arr.map(
      [
        ...rectCorners(rect),
        { sx: middle.sx, sy: top },
        { sx: middle.sx, sy: bottom },
        { sx: left, sy: middle.sy },
        { sx: right, sy: middle.sy },
      ],
      (point) => lineDistance(points, point)
    )
  );
};

const rectsOverlap = (a: ScreenRect, b: ScreenRect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * What's wrong with the placed labels of a scene, as readable lines. A label
 * may sit over a faded hop's route, so only labelled hops' routes count.
 */
const labelProblems = (scene: Scene) =>
  Arr.flatMap(scene.hops, ({ hop, label, labelled, points }) => {
    if (label === undefined) {
      return [];
    }

    if (!labelled) {
      return [`${hop.id}: it is faded, and its label is placed`];
    }

    const others = Arr.filter(scene.hops, (other) => other.hop.id !== hop.id);
    const lit = Arr.filter(others, (other) => other.labelled);
    const ownGap = gapTo(points, label);

    const onOwn = throughRect(points, label)
      ? [`${hop.id}: its label sits on its own route`]
      : [];

    const onOther = Arr.flatMap(lit, (other) =>
      throughRect(other.points, label)
        ? [`${hop.id}: its label sits on ${other.hop.id}'s route`]
        : []
    );

    const far =
      ownGap > labelReach[scene.view] * groundProjections[scene.view].unit
        ? [`${hop.id}: its label is ${ownGap.toFixed(1)} from its route`]
        : [];

    // Plan view never puts a label nearer another route than its own.
    const nearer =
      scene.view === "plan"
        ? Arr.flatMap(lit, (other) =>
            gapTo(other.points, label) < ownGap
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

type Chapter = ReturnType<typeof chaptersFor>[number];

/** A chapter's scene, labelled as the page labels it for `choice`. */
const sceneIn = ({
  chapter,
  choice = { kind: "chapter" },
  data,
  layout,
  routes = routeRevealed({ data, layout, revealed: chapter.revealed }),
  view,
  zoom,
}: {
  readonly chapter: Chapter;
  readonly choice?: FlowChoice;
  readonly data: MapData;
  readonly layout: Layout;
  readonly routes?: ReturnType<typeof routeRevealed>;
  readonly view: View;
  readonly zoom: number;
}) =>
  sceneOf({
    data,
    labelFirst: chapter.plays,
    labelled: playSpotlightOf({ choice, data, stop: chapter })?.hops,
    layout,
    revealed: chapter.revealed,
    routes,
    view,
    zoom,
  });

/** The flow picker's choices besides the chapter's own: each flow, and all. */
const flowChoicesOf = (data: MapData): ReadonlyArray<FlowChoice> => [
  ...Arr.map(data.flows, ({ id }): FlowChoice => ({ id, kind: "flow" })),
  { kind: "all" },
];

const choiceName = (choice: FlowChoice) =>
  choice.kind === "flow" ? `flow ${choice.id}` : choice.kind;

/** Every chapter with its own plays, then the last with each flow choice. */
const chapterChoicesOf = (data: MapData) => {
  const chapters = chaptersFor(data);
  const last = Arr.last(chapters);

  return [
    ...Arr.map(chapters, (chapter) => ({
      chapter,
      choice: { kind: "chapter" } as FlowChoice,
    })),
    ...(Option.isSome(last)
      ? Arr.map(flowChoicesOf(data), (choice) => ({
          chapter: last.value,
          choice,
        }))
      : []),
  ];
};

/** Plan view at full size, and zoomed out so the map fits a 1280 × 800 page. */
const zooms = [1, 0.6, 0.4241];

/** A map of two structures and the hop `h` between them, with `chapters`. */
const mapWith = (chapters: MapData["chapters"]): MapData => ({
  chapters,
  flows: [],
  format: 1,
  groups: [{ id: "main", title: "Main" }],
  hops: [
    {
      from: "a",
      id: "h",
      label: "a label too wide for the gap",
      payload: {},
      to: "b",
    },
  ],
  overview: { summary: "A map.", title: "Map" },
  revision: 0,
  structures: Arr.map(["a", "b"], (id) => ({
    code: "S",
    group: "main",
    howItsBuilt: "Built.",
    id,
    name: id,
    oneLiner: "One line.",
    shape: "box" as const,
    status: "live" as const,
    whatItDoes: "Does.",
  })),
});

const chapterOf = (id: string, plays: ReadonlyArray<string>) => ({
  id,
  lede: "Lede.",
  plays,
  reveals: ["a", "b"],
  story: "Story.",
  title: id,
});

/** What `check` says of a hop whose label has no spot, where it is in Plan view. */
const warningText = (where: string) =>
  `the label of hop "h" has no clear spot beside its route${where} in Plan view, so the drawing leaves it out and it shows only on hover. Move the structures it passes apart, or shorten the label.`;

// JSON has no -0, so a rounded -0 is written as 0.
const twoPlaces = (value: number) => Number(value.toFixed(2)) + 0;

/** A rect rounded to 2 decimals, as all-flows-labels.json holds it. */
const rounded = (rect: ScreenRect | undefined) =>
  rect === undefined
    ? null
    : {
        bottom: twoPlaces(rect.bottom),
        left: twoPlaces(rect.left),
        right: twoPlaces(rect.right),
        top: twoPlaces(rect.top),
      };

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

            for (const { chapter, choice } of chapterChoicesOf(data)) {
              const routes = routeRevealed({
                data,
                layout,
                revealed: chapter.revealed,
              });

              for (const zoom of zooms) {
                const scene = sceneIn({
                  chapter,
                  choice,
                  data,
                  layout,
                  routes,
                  view,
                  zoom,
                });

                assert.deepStrictEqual(
                  labelProblems(scene),
                  [],
                  `in chapter ${chapter.id}, ${choiceName(choice)}, at zoom ${zoom}`
                );
              }
            }
          })
      );
    }
  }

  // all-flows-labels.json was recorded on main at effd82c, before the
  // labelled set existed, by sceneOf with no labelFirst and no labelled,
  // under Node as the tests run. Bun places one Iso label elsewhere.
  it.effect("All flows draws the labels main drew, on flake-pipeline", () =>
    Effect.gen(function* () {
      const { data, layout } = yield* fixture("flake-pipeline");
      const chapter = Option.getOrThrow(Arr.last(chaptersFor(data)));

      const drawn = Rec.fromEntries(
        Arr.flatMap(views, (view) =>
          Arr.map([1, 0.4241], (zoom) => {
            const scene = sceneOf({
              data,
              layout,
              revealed: chapter.revealed,
              view,
              zoom,
            });

            return [
              `${view} ${zoom}`,
              Rec.fromEntries(
                Arr.map(scene.hops, ({ hop, hoverLabel, label }) => [
                  hop.id,
                  { hoverLabel: rounded(hoverLabel), label: rounded(label) },
                ])
              ),
            ] as const;
          })
        )
      );

      assert.deepStrictEqual(drawn, allFlowsLabels);
    })
  );

  for (const name of ["flake-pipeline", "crowded", "review"]) {
    for (const view of views) {
      it.effect(
        `with a flow picked, clash with nothing, in ${name}, ${view} view`,
        () =>
          Effect.gen(function* () {
            const { data, layout } = yield* fixture(name);
            const chapter = Option.getOrThrow(Arr.last(chaptersFor(data)));

            assert.isNotEmpty(data.flows);

            for (const { id } of data.flows) {
              for (const zoom of zooms) {
                const scene = sceneIn({
                  chapter,
                  choice: { id, kind: "flow" },
                  data,
                  layout,
                  view,
                  zoom,
                });

                const withLabels = Arr.filter(
                  sceneClashes(scene),
                  ({ parts }) => Arr.some(parts, ({ kind }) => kind === "label")
                );

                assert.deepStrictEqual(
                  Arr.map(withLabels, ({ between }) => between),
                  [],
                  `with flow ${id} at zoom ${zoom}`
                );
              }
            }
          })
      );
    }
  }

  // Plan view at about the fit zoom of a 1280 × 800 page. f-repair's four
  // stay hidden even when each is placed first: full-strength routes and
  // fixed text leave them no spot.
  const mostHiddenInPlan = [
    { flow: "f-weekly", most: 1 },
    { flow: "f-repair", most: 4 },
    { flow: "f-review", most: 0 },
    { flow: "f-stale", most: 0 },
  ];

  it.effect(
    "with a flow picked, hide few of its labels, in flake-pipeline's Plan view",
    () =>
      Effect.gen(function* () {
        const { data, layout } = yield* fixture("flake-pipeline");
        const chapter = Option.getOrThrow(Arr.last(chaptersFor(data)));

        for (const { flow, most } of mostHiddenInPlan) {
          const scene = sceneIn({
            chapter,
            choice: { id: flow, kind: "flow" },
            data,
            layout,
            view: "plan",
            zoom: 0.4241,
          });

          const hops = new Set(
            Arr.flatMap(data.flows, ({ hops: ids, id }) =>
              id === flow ? ids : []
            )
          );

          const hidden = Arr.filter(
            scene.hops,
            ({ hop, label }) => hops.has(hop.id) && label === undefined
          );

          assert.isNotEmpty(hops, flow);
          assert.isAtMost(hidden.length, most, `flow ${flow}`);
        }
      })
  );

  it.effect("are reported by sceneClashes when one sits on its own route", () =>
    Effect.gen(function* () {
      const { data, layout } = yield* fixture("plan-labels");

      const chapter = Option.getOrThrow(Arr.head(chaptersFor(data)));
      const scene = sceneIn({ chapter, data, layout, view: "plan", zoom: 1 });

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
                  bottom: at.sy + 7,
                  left: at.sx - 20,
                  right: at.sx + 20,
                  top: at.sy - 7,
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
      routes: {},
      structures: {
        a: { d: 6, w: 2, x: 0, y: 0 },
        b: { d: 6, w: 2, x: 2.5, y: 0 },
      },
    };

    const hiddenLabelWarnings = (data: MapData) =>
      Arr.filter(
        Arr.map(layoutProblems(data, layout), ({ message }) => message),
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
            warningText(' in chapter "c1"'),
          ]);
        })
    );

    it.effect("warns about a hop only a chapter that plays nothing shows", () =>
      Effect.sync(() => {
        const data = mapWith([chapterOf("c-all", [])]);

        assert.deepStrictEqual(hiddenLabelWarnings(data), [
          warningText(' in chapter "c-all"'),
        ]);
      })
    );

    it.effect("warns about a map with no chapters, which draws all of it", () =>
      Effect.sync(() => {
        const data = mapWith([]);

        assert.deepStrictEqual(hiddenLabelWarnings(data), [warningText("")]);
      })
    );
  });
});
