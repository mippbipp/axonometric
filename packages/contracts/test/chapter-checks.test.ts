import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect } from "effect";

import {
  chapterViews,
  checkLayout,
  draggedProblems,
  draggedProblemsIn,
} from "../src/index.ts";
import type { Layout, MapData } from "../src/index.ts";
import { fixture } from "./fixture-maps.ts";

/** How far to move a structure, in grid units. */
interface Nudge {
  readonly id: string;
  readonly dx: number;
  readonly dy: number;
}

/** `layout` with a structure moved by `nudge`. */
const nudged = (layout: Layout, { id, dx, dy }: Nudge): Layout => {
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
        const after = nudged(layout, { id: "server", dx: 0, dy: 2.5 });
        const chapters = new Set(idsOf(data));

        assert.deepStrictEqual(
          draggedProblemsIn({ data, before: layout, after, chapters }),
          draggedProblems(data, layout, after)
        );
      })
  );

  it.effect("keeps check's order whatever order the chapters come in", () =>
    Effect.gen(function* () {
      const { data, layout } = yield* fixture("review");
      const after = nudged(layout, { id: "proposals", dx: 0, dy: -2.5 });
      const ids = idsOf(data);
      const backwards = new Set(Arr.reverse(ids));
      const forwards = new Set(ids);

      assert.deepStrictEqual(
        draggedProblemsIn({ data, before: layout, after, chapters: backwards }),
        draggedProblemsIn({ data, before: layout, after, chapters: forwards })
      );
    })
  );

  it.effect(
    "with one chapter, lists the whole-layout problems and that chapter's alone",
    () =>
      Effect.gen(function* () {
        const { data, layout } = yield* fixture("review");
        const after = nudged(layout, { id: "proposals", dx: 0, dy: -2.5 });
        const [first, ...others] = idsOf(data);

        const one = draggedProblemsIn({
          data,
          before: layout,
          after,
          chapters: new Set([first]),
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
      const right = { id: "server", dx: 3, dy: 0 };
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
