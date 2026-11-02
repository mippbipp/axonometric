import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { vi } from "vitest";

import {
  emptyHistory,
  observeFile,
  pushStep,
  redoStep,
  undoStep,
  wroteFile,
} from "../src/index.ts";

vi.setConfig({ testTimeout: 5000 });

// Lists stand in for pending-change lists: "a" is a list with one change.
const start = emptyHistory<string>(0);

describe("the undo history", () => {
  it("starts empty", () => {
    assert.deepStrictEqual(start, { past: [], future: [], revision: 0 });
  });

  it("push remembers the list before an edit and forgets what could be redone", () => {
    const edited = pushStep({
      history: { past: ["a"], future: ["z"], revision: 2 },
      before: "b",
      fileRevision: 2,
      cap: 10,
    });

    assert.deepStrictEqual(edited, {
      past: ["a", "b"],
      future: [],
      revision: 2,
    });
  });

  it("push keeps only the newest steps up to the cap", () => {
    const edited = pushStep({
      history: { past: ["a", "b", "c"], future: [], revision: 0 },
      before: "d",
      fileRevision: 0,
      cap: 3,
    });

    assert.deepStrictEqual(edited.past, ["b", "c", "d"]);
  });

  it("undo gives the last list back and moves the current one to redo", () => {
    const undone = undoStep({
      history: { past: ["a", "b"], future: [], revision: 1 },
      current: "c",
    });

    assert.deepStrictEqual(Option.getOrNull(undone), {
      target: "b",
      history: { past: ["a"], future: ["c"], revision: 1 },
    });
  });

  it("redo reverses an undo", () => {
    const undone = Option.getOrThrow(
      undoStep({
        history: { past: ["a"], future: [], revision: 1 },
        current: "b",
      })
    );

    const redone = Option.getOrThrow(
      redoStep({ history: undone.history, current: undone.target })
    );

    assert.strictEqual(redone.target, "b");
    assert.deepStrictEqual(redone.history, {
      past: ["a"],
      future: [],
      revision: 1,
    });
  });

  it("has nothing to undo or redo when empty", () => {
    assert.isTrue(Option.isNone(undoStep({ history: start, current: "a" })));
    assert.isTrue(Option.isNone(redoStep({ history: start, current: "a" })));
  });

  it("a write by someone else clears the history when the next edit is pushed", () => {
    // The history is good for file revision 2, and the file is at 3.
    const edited = pushStep({
      history: { past: ["a", "b"], future: ["c"], revision: 2 },
      before: "d",
      fileRevision: 3,
      cap: 10,
    });

    assert.deepStrictEqual(edited, { past: ["d"], future: [], revision: 3 });
  });

  it("wroteFile moves the revision the history is good for", () => {
    const history = wroteFile({
      history: { past: ["a"], future: [], revision: 1 },
      revision: 2,
    });

    assert.strictEqual(history.revision, 2);
    assert.deepStrictEqual(history.past, ["a"]);
  });

  it("observing a file with an empty history follows its revision", () => {
    const seen = observeFile({
      history: start,
      fileRevision: 5,
      acceptedChanged: false,
    });

    assert.deepStrictEqual(seen, { cleared: false, history: emptyHistory(5) });
  });

  it("observing a file keeps a history that has steps, even at another revision", () => {
    const history = { past: ["a"], future: [], revision: 1 };

    assert.deepStrictEqual(
      observeFile({ history, fileRevision: 4, acceptedChanged: false }),
      { cleared: false, history }
    );
  });

  it("a change to the accepted layout clears the history and says so when it had steps", () => {
    const seen = observeFile({
      history: { past: ["a"], future: [], revision: 1 },
      fileRevision: 2,
      acceptedChanged: true,
    });

    assert.deepStrictEqual(seen, { cleared: true, history: emptyHistory(2) });
  });

  it("a change to the accepted layout with no steps to lose says nothing", () => {
    const seen = observeFile({
      history: start,
      fileRevision: 2,
      acceptedChanged: true,
    });

    assert.isFalse(seen.cleared);
  });
});
