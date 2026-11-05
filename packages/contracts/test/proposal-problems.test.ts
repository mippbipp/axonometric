import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect } from "effect";
import { vi } from "vitest";

import { proposalProblems } from "../src/index.ts";
import type { BatchItem, CheckScope } from "../src/index.ts";
import { fixture } from "./fixture-maps.ts";

// Seam 3: what the layout checks report for a group or chapter proposal, with
// plain data. The review map has the groups people, loop and outside; its
// chapters reveal engineer and page, then server and proposals, then the rest.

vi.setConfig({ testTimeout: 5000 });

const newGroup: BatchItem = {
  id: "g",
  kind: "group",
  change: { action: "add", group: { id: "data-1", title: "Data layer" } },
};

const into = (structure: string, index: number): BatchItem => ({
  id: `s${index}`,
  kind: "structure",
  change: { action: "group", structure, group: "data-1" },
});

const reveal: BatchItem = {
  id: "c",
  kind: "chapter",
  change: { action: "reveal", chapter: "c-save", structure: "pull-request" },
};

const inChapter = (chapter: string): CheckScope => ({ of: "chapter", chapter });

/** What the proposal adds to the report, as the panel marks it "New from this change". */
const addedBy = (items: readonly BatchItem[], scope: CheckScope) =>
  Effect.gen(function* () {
    const { data, layout } = yield* fixture("review");

    return Arr.flatMap(
      proposalProblems({ before: { data, layout }, items, scope }),
      ({ problem, added }) => (added ? [problem.message] : [])
    );
  });

const groupOfTwo = [newGroup, into("server", 0), into("proposals", 1)];

describe("what a group proposal adds to the layout checks", () => {
  it.effect(
    "is nothing where the new group's zone fits, in the chapter viewed",
    () =>
      Effect.gen(function* () {
        assert.deepStrictEqual(
          yield* addedBy(groupOfTwo, inChapter("c-save")),
          []
        );
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
      assert.deepStrictEqual(
        yield* addedBy([newGroup], inChapter("c-all")),
        []
      );
    })
  );

  it.effect(
    "adds nothing for a longer title that still fits, in any chapter",
    () =>
      Effect.gen(function* () {
        const rename: BatchItem = {
          id: "r",
          kind: "group",
          change: { action: "rename", group: "loop", title: "The save loop" },
        };

        for (const chapter of ["c-page", "c-save", "c-all"]) {
          assert.deepStrictEqual(
            yield* addedBy([rename], inChapter(chapter)),
            [],
            chapter
          );
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
        id: "p",
        kind: "chapter",
        change: { action: "play", chapter: "c-page", hop: "h-store" },
      };

      // The hop's ends are not revealed in c-page, so it is not drawn there and
      // adds nothing to the drawing; review, not the layout checks, says it breaks.
      assert.deepStrictEqual(yield* addedBy([play], inChapter("c-page")), []);
    })
  );

  it.effect(
    "adds nothing for a hide, an unplay or an order that draws nothing new",
    () =>
      Effect.gen(function* () {
        const actions: readonly BatchItem[] = [
          {
            id: "a",
            kind: "chapter",
            change: {
              action: "hide",
              chapter: "c-save",
              structure: "proposals",
            },
          },
          {
            id: "b",
            kind: "chapter",
            change: { action: "unplay", chapter: "c-save", hop: "h-store" },
          },
          {
            id: "c",
            kind: "chapter",
            change: {
              action: "order",
              chapter: "c-save",
              plays: ["h-store", "h-note", "h-save"],
            },
          },
        ];

        for (const item of actions) {
          assert.deepStrictEqual(
            yield* addedBy([item], inChapter("c-save")),
            [],
            item.id
          );
        }
      })
  );
});
