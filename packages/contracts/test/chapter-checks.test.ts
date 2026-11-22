import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Predicate, String as Str } from "effect";

import {
  applyLayoutChanges,
  changedProblems,
  chapterViews,
  checkMap,
  dragCheckOf,
  drawingProblems,
  layoutAfterChanges,
  withCarriedRoutes,
} from "../src/index.ts";
import type {
  DragCheck,
  DragStep,
  Layout,
  LayoutChange,
  MapData,
  MapProblem,
} from "../src/index.ts";
import { fixture } from "./fixture-maps.ts";
import { layoutProblems } from "./layout-problems.ts";

/** How far to move a structure, in grid units. */
interface Nudge {
  readonly dx: number;
  readonly dy: number;
  readonly id: string;
}

/** `layout` with a structure moved by `nudge`. */
const nudged = (layout: Layout, { dx, dy, id }: Nudge): Layout => {
  const at = layout.structures[id];

  assert.isDefined(at, `${id} has no placement`);

  return {
    ...layout,
    structures: {
      ...layout.structures,
      [id]: { ...at, x: (at?.x ?? 0) + dx, y: (at?.y ?? 0) + dy },
    },
  };
};

const checkOf = ({
  data,
  layout,
}: {
  readonly data: MapData;
  readonly layout: Layout;
}) => dragCheckOf({ before: layout, data });

const idsOf = (data: MapData) => Arr.map(chapterViews(data), ({ id }) => id);

/** The answers a drag check gives for one step, in the order it gives them. */
const answersTo = (check: DragCheck, step: DragStep) => [...check.step(step)];

/** The chapter a drawing warning names, if it names one. */
const chapterOf = ({ message }: MapProblem) =>
  /in chapter "(?<id>[^"]+)"/u.exec(message)?.groups?.id;

/** What `check` reports in layout.json for the layout, in its order. */
const printedFor = (data: MapData, after: Layout) =>
  Arr.filter(
    checkMap(
      { data, layout: after },
      { drawingWarnings: true, linkExists: () => true }
    ),
    ({ file }) => file === "layout.json"
  );

/** The chapter ids of the map, in order. */
const chapterIds = (data: MapData) =>
  Arr.filter(idsOf(data), Predicate.isNotUndefined);

describe("checking a drag a chapter at a time", () => {
  it.effect(
    "on the pipeline map, answers the chapter on screen first, then the rest in order, the last complete",
    () =>
      Effect.gen(function* () {
        const map = yield* fixture("flake-pipeline");
        const after = nudged(map.layout, { dx: 2, dy: 0, id: "updater" });
        const ids = chapterIds(map.data);
        const onScreen = "c-gate";
        const answers = answersTo(checkOf(map), { after, onScreen });

        assert.lengthOf(answers, ids.length);
        assert.deepStrictEqual(
          Arr.map(answers, ({ complete }) => complete),
          Arr.map(ids, (_, index) => index === ids.length - 1)
        );

        // A drawing warning names its chapter. Until the others are in, the
        // only chapter the answers can name is the one on screen.
        const named = (index: number) =>
          new Set(
            Arr.flatMap(answers[index]?.problems ?? [], ({ problem }) =>
              Arr.fromNullishOr(chapterOf(problem))
            )
          );

        assert.deepStrictEqual(
          Arr.filter([...named(0)], (id) => id !== onScreen),
          []
        );
        assert.isAbove(
          named(answers.length - 1).size,
          named(0).size,
          "the other chapters add warnings of their own"
        );
      }),
    60_000
  );

  it.effect(
    "on the pipeline map, ends with what check prints and what every chapter's dragged problems give, whichever chapter is on screen",
    () =>
      Effect.gen(function* () {
        const map = yield* fixture("flake-pipeline");
        const after = nudged(map.layout, { dx: 2, dy: 0, id: "updater" });
        const printed = printedFor(map.data, after);

        const dragged = changedProblems({
          after: { data: map.data, layout: after },
          before: map,
        });

        assert.isAbove(dragged.length, 0);
        assert.isTrue(Arr.some(dragged, ({ added }) => added));

        // One check for every chapter on screen, as one drag has: what an
        // earlier step drew is remembered, and the answers don't depend on it.
        const check = checkOf(map);

        for (const onScreen of chapterIds(map.data)) {
          const [last] = Arr.takeRight(
            answersTo(check, { after, onScreen }),
            1
          );

          assert.isTrue(last?.complete, onScreen);
          assert.deepStrictEqual(last?.problems, dragged, onScreen);
          assert.deepStrictEqual(
            Arr.map(last?.problems ?? [], ({ problem }) => problem),
            printed,
            onScreen
          );
        }
      }),
    90_000
  );

  it.effect(
    "marks what the drag adds, and nothing the layout already had",
    () =>
      Effect.gen(function* () {
        const map = yield* fixture("review");
        const check = dragCheckOf({ before: map.layout, data: map.data });
        const [onScreen] = chapterIds(map.data);

        const [still] = [
          ...check.step({
            after: map.layout,
            onScreen: onScreen ?? "",
          }),
        ];

        assert.isTrue(Arr.every(still?.problems ?? [], ({ added }) => !added));

        const moved = [
          ...check.step({
            after: nudged(map.layout, {
              dx: 0,
              dy: -2.5,
              id: "proposals",
            }),
            onScreen: onScreen ?? "",
          }),
        ].at(-1);

        assert.isTrue(Arr.some(moved?.problems ?? [], ({ added }) => added));
      })
  );

  it.effect("answers the layout before the drag from its own drawing", () =>
    Effect.gen(function* () {
      const map = yield* fixture("review");
      const right = { dx: 3, dy: 0, id: "server" };
      const [onScreen = ""] = chapterIds(map.data);

      const check = checkOf(map);

      const step = (after: Layout) =>
        answersTo(check, { after, onScreen }).at(-1)?.problems;

      const first = step(nudged(map.layout, right));

      step(nudged(map.layout, { ...right, dx: -3 }));
      assert.deepStrictEqual(step(nudged(map.layout, right)), first);
    })
  );
});

describe("the drawing warnings of two maps with one layout", () => {
  it.effect("are each map's own, whichever map was drawn first", () =>
    Effect.gen(function* () {
      const { data, layout } = yield* fixture("crowded");

      // The same chapters, with h-secret's ends swapped, so its warning
      // names them the other way round.
      const swapped: MapData = {
        ...data,
        hops: Arr.map(data.hops, (hop) =>
          hop.id === "h-secret" ? { ...hop, from: hop.to, to: hop.from } : hop
        ),
      };

      const secretOf = (map: MapData) =>
        Arr.filter(
          Arr.map(drawingProblems(map, layout), ({ message }) => message),
          Str.startsWith('hop "h-secret"')
        );

      assert.deepStrictEqual(secretOf(data), [
        'hop "h-secret" from "api" to "vault" runs under "west": no clear route goes around it. Move the structures apart to open a gap, or write a route override.',
      ]);
      assert.include(secretOf(swapped)[0], 'from "vault" to "api"');
    })
  );
});

describe("the drag preview and the layout a drop saves", () => {
  it.effect(
    "report the problems check gives for the layout the served store would save",
    () =>
      Effect.gen(function* () {
        const { data, layout: saved } = yield* fixture("review");

        // h-store takes a detour right of the server and the proposals, past
        // the pull request.
        const layout: Layout = {
          ...saved,
          routes: {
            "h-store": [
              { x: 9, y: 2 },
              { x: 9, y: 4 },
              { x: 13, y: 4 },
              { x: 13, y: 7 },
              { x: 10, y: 7 },
            ],
          },
        };

        // Moving both ends together drags the override with them, as it does
        // when a drop is saved.
        const changes: ReadonlyArray<LayoutChange> = [
          {
            by: "engineer",
            id: "group",
            kind: "move",
            moves: [
              {
                position: { x: 8, y: 2 },
                target: { id: "server", kind: "structure" },
              },
              {
                position: { x: 8, y: 8 },
                target: { id: "proposals", kind: "structure" },
              },
            ],
          },
        ];

        const previewed = layoutAfterChanges({
          changes,
          hops: data.hops,
          layout,
        });

        // What the store saves: the moves, then the reroutes it makes for them.
        const reroutes = Arr.filter(
          withCarriedRoutes({
            changes,
            hops: data.hops,
            id: (hop) => `saved-${hop}`,
            layout,
          }),
          ({ kind }) => kind === "reroute"
        );

        const savedLayout = applyLayoutChanges(layout, [
          ...changes,
          ...reroutes,
        ]);

        assert.lengthOf(reroutes, 1);
        assert.deepStrictEqual(previewed, savedLayout);

        const shown = Arr.map(
          changedProblems({
            after: { data, layout: previewed },
            before: { data, layout },
          }),
          ({ problem }) => problem
        );

        assert.isAbove(shown.length, 0);
        assert.deepStrictEqual(shown, layoutProblems(data, savedLayout));
        // Without the carried override the layout reads differently, so the
        // comparison would notice a preview that left it behind.
        assert.notDeepEqual(
          layoutProblems(data, applyLayoutChanges(layout, changes)),
          shown
        );
      })
  );
});
