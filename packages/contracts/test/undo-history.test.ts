import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";

import {
  emptyHistory,
  observeFile,
  pushStep,
  redoStep,
  undoStep,
  wroteFile,
} from "../src/index.ts";

// Lists stand in for pending-change lists: "a" is a list with one change.
const start = emptyHistory<string>(0);

describe("the undo history", () => {
  it("push remembers the list before an edit and forgets what could be redone", () => {
    const edited = pushStep({
      before: "b",
      cap: 10,
      fileRevision: 2,
      history: { future: ["z"], past: ["a"], revision: 2 },
    });

    assert.deepStrictEqual(edited, {
      future: [],
      past: ["a", "b"],
      revision: 2,
    });
  });

  it("push keeps only the newest steps up to the cap", () => {
    const edited = pushStep({
      before: "d",
      cap: 3,
      fileRevision: 0,
      history: { future: [], past: ["a", "b", "c"], revision: 0 },
    });

    assert.deepStrictEqual(edited.past, ["b", "c", "d"]);
  });

  it("undo gives the last list back and moves the current one to redo", () => {
    const undone = undoStep({
      current: "c",
      history: { future: [], past: ["a", "b"], revision: 1 },
    });

    assert.deepStrictEqual(Option.getOrNull(undone), {
      history: { future: ["c"], past: ["a"], revision: 1 },
      target: "b",
    });
  });

  it("redo reverses an undo", () => {
    const undone = Option.getOrThrow(
      undoStep({
        current: "b",
        history: { future: [], past: ["a"], revision: 1 },
      })
    );

    const redone = Option.getOrThrow(
      redoStep({ current: undone.target, history: undone.history })
    );

    assert.strictEqual(redone.target, "b");
    assert.deepStrictEqual(redone.history, {
      future: [],
      past: ["a"],
      revision: 1,
    });
  });

  it("has nothing to undo or redo when empty", () => {
    assert.isTrue(Option.isNone(undoStep({ current: "a", history: start })));
    assert.isTrue(Option.isNone(redoStep({ current: "a", history: start })));
  });

  it("a write by someone else clears the history when the next edit is pushed", () => {
    // The history is good for file revision 2, and the file is at 3.
    const edited = pushStep({
      before: "d",
      cap: 10,
      fileRevision: 3,
      history: { future: ["c"], past: ["a", "b"], revision: 2 },
    });

    assert.deepStrictEqual(edited, { future: [], past: ["d"], revision: 3 });
  });

  it("wroteFile moves the revision the history is good for", () => {
    const history = wroteFile({
      history: { future: [], past: ["a"], revision: 1 },
      revision: 2,
    });

    assert.strictEqual(history.revision, 2);
    assert.deepStrictEqual(history.past, ["a"]);
  });

  it("observing a file with an empty history follows its revision", () => {
    const seen = observeFile({
      acceptedChanged: false,
      fileRevision: 5,
      history: start,
    });

    assert.deepStrictEqual(seen, { cleared: false, history: emptyHistory(5) });
  });

  it("observing a file keeps a history that has steps, even at another revision", () => {
    const history = { future: [], past: ["a"], revision: 1 };

    assert.deepStrictEqual(
      observeFile({ acceptedChanged: false, fileRevision: 4, history }),
      { cleared: false, history }
    );
  });

  it("a change to the accepted layout clears the history and says so when it had steps", () => {
    const seen = observeFile({
      acceptedChanged: true,
      fileRevision: 2,
      history: { future: [], past: ["a"], revision: 1 },
    });

    assert.deepStrictEqual(seen, { cleared: true, history: emptyHistory(2) });
  });

  it("a change to the accepted layout with no steps to lose says nothing", () => {
    const seen = observeFile({
      acceptedChanged: true,
      fileRevision: 2,
      history: start,
    });

    assert.isFalse(seen.cleared);
  });
});
