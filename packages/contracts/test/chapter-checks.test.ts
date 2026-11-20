import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect } from "effect";

import {
  applyLayoutChanges,
  chapterViews,
  checkLayout,
  draggedProblems,
  draggedProblemsIn,
  layoutAfterChanges,
  withCarriedRoutes,
} from "../src/index.ts";
import type { Layout, LayoutChange, MapData } from "../src/index.ts";
import { fixture } from "./fixture-maps.ts";

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

const idsOf = (data: MapData) => Arr.map(chapterViews(data), ({ id }) => id);

describe("checking a drag a chapter at a time", () => {
  it.effect(
    "with every chapter, lists what draggedProblems lists, in the same order",
    () =>
      Effect.gen(function* () {
        const { data, layout } = yield* fixture("review");
        const after = nudged(layout, { dx: 0, dy: 2.5, id: "server" });
        const chapters = new Set(idsOf(data));

        assert.deepStrictEqual(
          draggedProblemsIn({ after, before: layout, chapters, data }),
          draggedProblems(data, layout, after)
        );
      })
  );

  it.effect("keeps check's order whatever order the chapters come in", () =>
    Effect.gen(function* () {
      const { data, layout } = yield* fixture("review");
      const after = nudged(layout, { dx: 0, dy: -2.5, id: "proposals" });
      const ids = idsOf(data);
      const backwards = new Set(Arr.reverse(ids));
      const forwards = new Set(ids);

      assert.deepStrictEqual(
        draggedProblemsIn({ after, before: layout, chapters: backwards, data }),
        draggedProblemsIn({ after, before: layout, chapters: forwards, data })
      );
    })
  );

  it.effect(
    "with one chapter, lists the whole-layout problems and that chapter's alone",
    () =>
      Effect.gen(function* () {
        const { data, layout } = yield* fixture("review");
        const after = nudged(layout, { dx: 0, dy: -2.5, id: "proposals" });
        const [first, ...others] = idsOf(data);

        const one = draggedProblemsIn({
          after,
          before: layout,
          chapters: new Set([first]),
          data,
        });

        const all = Arr.map(checkLayout(data, after), ({ message }) => message);

        for (const { problem } of one) {
          assert.include(all, problem.message);

          for (const other of others) {
            assert.notInclude(problem.message, `in chapter "${String(other)}"`);
          }
        }
      })
  );

  it.effect("gives the same answer when asked again for a layout", () =>
    Effect.gen(function* () {
      const { data, layout } = yield* fixture("review");
      const right = { dx: 3, dy: 0, id: "server" };
      const after = nudged(layout, right);
      const back = nudged(after, { ...right, dx: -3 });

      assert.deepStrictEqual(
        checkLayout(data, back),
        checkLayout(data, layout)
      );
      assert.deepStrictEqual(
        checkLayout(data, after),
        checkLayout(data, nudged(layout, right))
      );
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
          draggedProblems(data, layout, previewed),
          ({ problem }) => problem
        );

        assert.isAbove(shown.length, 0);
        assert.deepStrictEqual(shown, checkLayout(data, savedLayout));
        // Without the carried override the layout reads differently, so the
        // comparison would notice a preview that left it behind.
        assert.notDeepEqual(
          checkLayout(data, applyLayoutChanges(layout, changes)),
          shown
        );
      })
  );
});
