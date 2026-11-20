import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Option, Order } from "effect";

import {
  dropConflicted,
  emptyHistory,
  observeFile,
  pushStep,
  redoStep,
  replayStep,
  stepOf,
  undoStep,
} from "../src/index.ts";
import type { LayoutChange, UndoStep } from "../src/index.ts";

const move = (
  id: string,
  ...at: Arr.NonEmptyReadonlyArray<readonly [string, number]>
): LayoutChange => ({
  by: "engineer",
  id,
  kind: "move",
  moves: Arr.map(at, ([structure, y]) => ({
    position: { x: 0, y },
    target: { id: structure, kind: "structure" as const },
  })),
});

const reroute = (id: string, hop: string): LayoutChange => ({
  by: "engineer",
  id,
  kind: "reroute",
  points: null,
  target: { id: hop, kind: "hop" },
});

const stepFrom = (
  before: ReadonlyArray<LayoutChange>,
  after: ReadonlyArray<LayoutChange>
): UndoStep => Option.getOrThrow(stepOf({ after, before }));

const keysOf = (
  before: ReadonlyArray<LayoutChange>,
  after: ReadonlyArray<LayoutChange>
) => Arr.sort(stepFrom(before, after).keys, Order.String);

describe("an undo step", () => {
  it("is nothing when the edit changed no target", () => {
    const list = [move("a", ["engineer", 1]), reroute("r", "h-pr")];
    const swapped = Arr.reverse(list);

    assert.isTrue(Option.isNone(stepOf({ after: list, before: list })));
    assert.isTrue(Option.isNone(stepOf({ after: swapped, before: list })));
  });

  it("names every structure a group move acts on, and only those", () => {
    const other = reroute("r", "h-pr");

    assert.deepStrictEqual(
      keysOf([other], [other, move("a", ["engineer", 1], ["page", 1])]),
      ["structure:engineer", "structure:page"]
    );
  });

  it("names a structure and a hop with the same id apart", () => {
    assert.deepStrictEqual(keysOf([], [reroute("r", "engineer")]), [
      "hop:engineer",
    ]);
  });

  it("names a target whose changes were only put in another order, and not the others they act on", () => {
    const group = move("g", ["engineer", 1], ["page", 1]);
    const own = move("a", ["engineer", 2]);

    assert.deepStrictEqual(keysOf([own, group], [group, own]), [
      "structure:engineer",
    ]);
  });
});

describe("replaying a step", () => {
  const mine = move("c1", ["engineer", 3]);
  const theirs = move("x", ["upstream", 4]);
  const step = stepFrom([], [mine]);

  it("with nothing written since gives back the list before or after it", () => {
    const earlier = [move("c0", ["engineer", 1]), theirs];
    const later = [theirs, mine];
    const edit = stepFrom(earlier, later);

    assert.deepStrictEqual(
      replayStep({ current: later, direction: "undo", step: edit }),
      Option.some(earlier)
    );
    assert.deepStrictEqual(
      replayStep({ current: earlier, direction: "redo", step: edit }),
      Option.some(later)
    );
  });

  it("keeps a change written since on another target, where it was", () => {
    const first = move("c0", ["page", 1]);
    const edit = stepFrom([first], [first, mine]);

    assert.deepStrictEqual(
      replayStep({
        current: [first, theirs, mine],
        direction: "undo",
        step: edit,
      }),
      Option.some([first, theirs])
    );
  });

  it("puts the step back beside a change written since", () => {
    assert.deepStrictEqual(
      replayStep({ current: [theirs], direction: "redo", step }),
      Option.some([theirs, mine])
    );
  });

  it("keeps a change removed since on another target removed", () => {
    const edit = stepFrom([theirs], [theirs, mine]);

    assert.deepStrictEqual(
      replayStep({ current: [mine], direction: "undo", step: edit }),
      Option.some([])
    );
  });

  it("puts back the change an edit replaced on the same target", () => {
    const was = move("c1", ["engineer", 1]);
    const edit = stepFrom([was, theirs], [theirs, mine]);

    assert.deepStrictEqual(
      replayStep({
        current: [theirs, mine, reroute("r", "h-pr")],
        direction: "undo",
        step: edit,
      }),
      Option.some([was, theirs, reroute("r", "h-pr")])
    );
  });

  it("is nothing when a change on one of its targets was written since", () => {
    const over = move("x", ["engineer", 5]);

    assert.isTrue(
      Option.isNone(
        replayStep({ current: [mine, over], direction: "undo", step })
      )
    );
    assert.isTrue(
      Option.isNone(replayStep({ current: [over], direction: "redo", step }))
    );
  });

  it("is nothing when a group move written since shares one of its targets", () => {
    const group = move("x", ["upstream", 4], ["engineer", 5]);

    assert.isTrue(
      Option.isNone(
        replayStep({ current: [mine, group], direction: "undo", step })
      )
    );
  });
});

describe("the undo history", () => {
  const a = stepFrom([], [move("a", ["engineer", 1])]);
  const b = stepFrom([], [move("b", ["page", 1])]);
  const c = stepFrom([], [move("c", ["server", 1])]);
  const d = stepFrom([], [move("d", ["upstream", 1])]);

  it("a new edit forgets what could be redone", () => {
    assert.deepStrictEqual(
      pushStep({ cap: 10, history: { future: [c], past: [a] }, step: b }),
      { future: [], past: [a, b] }
    );
  });

  it("keeps only the newest steps up to the cap", () => {
    assert.deepStrictEqual(
      pushStep({ cap: 3, history: { future: [], past: [a, b, c] }, step: d })
        .past,
      [b, c, d]
    );
  });

  it("undo takes the latest edit to redo, and redo takes it back", () => {
    const undone = Option.getOrThrow(undoStep({ future: [], past: [a, b] }));

    assert.deepStrictEqual(undone, {
      history: { future: [b], past: [a] },
      step: b,
    });

    const redone = Option.getOrThrow(redoStep(undone.history));

    assert.deepStrictEqual(redone, {
      history: { future: [], past: [a, b] },
      step: b,
    });
  });

  it("has nothing to undo or redo when empty", () => {
    assert.isTrue(Option.isNone(undoStep(emptyHistory)));
    assert.isTrue(Option.isNone(redoStep(emptyHistory)));
  });

  it("a conflicted step goes with the older steps on its targets, and the rest stay", () => {
    const onEngineer = stepFrom([], [move("e0", ["engineer", 2])]);
    const onBoth = stepFrom([], [move("g", ["page", 2], ["server", 2])]);
    const onServer = stepFrom([], [move("s", ["server", 3])]);
    const conflicted = stepFrom([], [move("p", ["page", 3])]);

    assert.deepStrictEqual(
      dropConflicted({
        direction: "undo",
        history: {
          future: [d],
          past: [onServer, onEngineer, onBoth, conflicted],
        },
        step: conflicted,
      }),
      { future: [d], past: [onEngineer] }
    );
  });

  it("a conflicted redo goes with the later undone steps on its targets", () => {
    const later = stepFrom([], [move("e2", ["engineer", 2])]);
    assert.deepStrictEqual(
      dropConflicted({
        direction: "redo",
        history: { future: [b, later, a], past: [c] },
        step: a,
      }),
      { future: [b], past: [c] }
    );
  });

  it("an accept ends the history and says so when it had steps", () => {
    assert.deepStrictEqual(
      observeFile({
        acceptedChanged: true,
        history: { future: [], past: [a] },
      }),
      { cleared: true, history: emptyHistory }
    );
    assert.isFalse(
      observeFile({ acceptedChanged: true, history: emptyHistory }).cleared
    );
  });

  it("hearing of the file without an accept keeps every step", () => {
    const history = { future: [b], past: [a] };

    assert.deepStrictEqual(observeFile({ acceptedChanged: false, history }), {
      cleared: false,
      history,
    });
  });
});
