import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect } from "effect";

import { proposalProblems } from "../src/index.ts";
import type { BatchItem, CheckScope } from "../src/index.ts";
import { fixture } from "./fixture-maps.ts";

// Seam 3: what the layout checks report for a group or chapter proposal, with
// plain data. The review map has the groups people, loop and outside; its
// chapters reveal engineer and page, then server and proposals, then the rest.

const newGroup: BatchItem = {
  change: { action: "add", group: { id: "data-1", title: "Data layer" } },
  id: "g",
  kind: "group",
};

const into = (structure: string, index: number): BatchItem => ({
  change: { action: "group", group: "data-1", structure },
  id: `s${index}`,
  kind: "structure",
});

const reveal: BatchItem = {
  change: { action: "reveal", chapter: "c-save", structure: "pull-request" },
  id: "c",
  kind: "chapter",
};

const inChapter = (chapter: string): CheckScope => ({ chapter, of: "chapter" });

/** What the proposal adds to the report, as the panel marks it "New from this change". */
const addedBy = (items: ReadonlyArray<BatchItem>, scope: CheckScope) =>
  Effect.gen(function* () {
    const { data, layout } = yield* fixture("review");

    return Arr.flatMap(
      proposalProblems({ before: { data, layout }, items, scope }),
      ({ added, problem }) => (added ? [problem.message] : [])
    );
  });

const groupOfTwo = [newGroup, into("server", 0), into("proposals", 1)];

describe("what a group proposal adds to the layout checks", () => {
  it.effect(
    "is nothing where the new group's zone fits, in the chapter viewed",
    () =>
      Effect.gen(function* () {
        const problems = yield* addedBy(groupOfTwo, inChapter("c-save"));
        assert.deepStrictEqual(problems, []);
      })
  );

  it.effect(
    "warns in the chapter where the new zone lands on another group's",
    () =>
      Effect.gen(function* () {
        const added = yield* addedBy(groupOfTwo, inChapter("c-all"));

        assert.strictEqual(added.length, 1);
        assert.include(added[0] ?? "", '"loop" and "data-1" overlap');
        assert.include(added[0] ?? "", 'chapter "c-all"');
      })
  );

  it.effect("adds nothing for an empty group, which has no zone to draw", () =>
    Effect.gen(function* () {
      const problems = yield* addedBy([newGroup], inChapter("c-all"));
      assert.deepStrictEqual(problems, []);
    })
  );

  it.effect(
    "adds nothing for a longer title that still fits, in any chapter",
    () =>
      Effect.gen(function* () {
        const rename: BatchItem = {
          change: { action: "rename", group: "loop", title: "The save loop" },
          id: "r",
          kind: "group",
        };

        for (const chapter of ["c-page", "c-save", "c-all"]) {
          const problems = yield* addedBy([rename], inChapter(chapter));
          assert.deepStrictEqual(problems, [], chapter);
        }
      })
  );
});

describe("what a chapter proposal adds to the layout checks", () => {
  it.effect(
    "warns when showing a structure makes one zone grow round another, in that chapter",
    () =>
      Effect.gen(function* () {
        const added = yield* addedBy(
          [...groupOfTwo, reveal],
          inChapter("c-save")
        );

        assert.strictEqual(added.length, 1);
        assert.include(added[0] ?? "", '"loop" and "data-1" overlap');
        assert.include(added[0] ?? "", 'chapter "c-save"');
      })
  );

  it.effect("says nothing in a chapter the proposal does not change", () =>
    Effect.gen(function* () {
      // c-page reveals only engineer and page, so a reveal in c-save
      // changes nothing it draws.
      const added = yield* addedBy([reveal], inChapter("c-page"));

      assert.deepStrictEqual(added, []);
    })
  );

  it.effect("adds nothing for a hop that is not drawn in that chapter", () =>
    Effect.gen(function* () {
      const play: BatchItem = {
        change: { action: "play", chapter: "c-page", hop: "h-store" },
        id: "p",
        kind: "chapter",
      };

      const problems = yield* addedBy([play], inChapter("c-page"));
      // The hop's ends are not revealed in c-page, so it is not drawn there and
      // adds nothing to the drawing; review, not the layout checks, says it breaks.
      assert.deepStrictEqual(problems, []);
    })
  );

  it.effect(
    "adds nothing for a hide, an unplay or an order that draws nothing new",
    () =>
      Effect.gen(function* () {
        const actions: ReadonlyArray<BatchItem> = [
          {
            change: {
              action: "hide",
              chapter: "c-save",
              structure: "proposals",
            },
            id: "a",
            kind: "chapter",
          },
          {
            change: { action: "unplay", chapter: "c-save", hop: "h-store" },
            id: "b",
            kind: "chapter",
          },
          {
            change: {
              action: "order",
              chapter: "c-save",
              plays: ["h-store", "h-note", "h-save"],
            },
            id: "c",
            kind: "chapter",
          },
        ];

        for (const item of actions) {
          const problems = yield* addedBy([item], inChapter("c-save"));
          assert.deepStrictEqual(problems, [], item.id);
        }
      })
  );
});
