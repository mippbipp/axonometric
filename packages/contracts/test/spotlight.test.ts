import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Order } from "effect";
import { vi } from "vitest";

import {
  chapterSpotlightOf,
  defaultFlowChoice,
  spotlightOf,
} from "../src/index.ts";
import type {
  FlowChoice,
  SpotlightChoice,
  SpotlightTarget,
} from "../src/index.ts";

vi.setConfig({ testTimeout: 5000 });

// Seam 3: the spotlight, from the map's hops, what's revealed, the chapter's
// play and the hovered and pinned items.

const hop = (id: string, from: string, to: string) => ({
  id,
  from,
  to,
  label: id,
});

// a → b → c → d, a second hop from a to b, and a hop to e, which isn't
// revealed.
const data = {
  hops: [
    hop("ab", "a", "b"),
    hop("ab2", "a", "b"),
    hop("bc", "b", "c"),
    hop("cd", "c", "d"),
    hop("de", "d", "e"),
  ],
};

const revealed = new Set(["a", "b", "c", "d", "f"]);

const nothing: SpotlightChoice = { play: [], hovered: null, pinned: null };

const spotlight = (choice: Partial<SpotlightChoice>) => {
  const result = spotlightOf({ data, revealed, ...nothing, ...choice });

  return result === null
    ? null
    : {
        hops: Arr.sort([...result.hops], Order.String),
        structures: Arr.sort([...result.structures], Order.String),
      };
};

const hopTarget = (id: string): SpotlightTarget => ({ kind: "hop", id });

const structureTarget = (id: string): SpotlightTarget => ({
  kind: "structure",
  id,
});

describe("the spotlight of a chapter's play", () => {
  it("holds the played hops and their ends", () => {
    assert.deepStrictEqual(spotlight({ play: ["bc", "cd"] }), {
      hops: ["bc", "cd"],
      structures: ["b", "c", "d"],
    });
  });

  it("leaves out a played hop whose end isn't revealed", () => {
    assert.deepStrictEqual(spotlight({ play: ["bc", "de"] }), {
      hops: ["bc"],
      structures: ["b", "c"],
    });
  });

  it("fades nothing when the chapter plays nothing", () => {
    assert.isNull(spotlight({ play: [] }));
  });

  it("fades nothing for all flows", () => {
    assert.isNull(spotlight({ play: "all" }));
  });

  it("fades nothing when none of the played hops is drawn", () => {
    assert.isNull(spotlight({ play: ["de"] }));
  });
});

describe("the spotlight of a structure", () => {
  it("holds its hops, in and out, and the structures at their other ends", () => {
    assert.deepStrictEqual(spotlight({ hovered: structureTarget("b") }), {
      hops: ["ab", "ab2", "bc"],
      structures: ["a", "b", "c"],
    });
  });

  it("leaves out a hop to a structure that isn't revealed", () => {
    assert.deepStrictEqual(spotlight({ pinned: structureTarget("d") }), {
      hops: ["cd"],
      structures: ["c", "d"],
    });
  });

  it("holds only itself when it has no hops", () => {
    assert.deepStrictEqual(spotlight({ hovered: structureTarget("f") }), {
      hops: [],
      structures: ["f"],
    });
  });

  it("is ignored when the structure isn't revealed", () => {
    assert.isNull(spotlight({ hovered: structureTarget("e") }));
  });
});

describe("the spotlight of a hop", () => {
  it("holds the hop and its two structures, and not a parallel hop", () => {
    assert.deepStrictEqual(spotlight({ hovered: hopTarget("ab") }), {
      hops: ["ab"],
      structures: ["a", "b"],
    });
  });

  it("is ignored when the hop isn't drawn", () => {
    assert.isNull(spotlight({ pinned: hopTarget("de") }));
  });
});

describe("which spotlight wins", () => {
  const play = ["cd"];
  const pinned = structureTarget("b");

  it("takes the hovered item over the pinned one and the play", () => {
    assert.deepStrictEqual(
      spotlight({ play, pinned, hovered: hopTarget("ab") }),
      { hops: ["ab"], structures: ["a", "b"] }
    );
  });

  it("takes the pinned item over the play when nothing is hovered", () => {
    assert.deepStrictEqual(spotlight({ play, pinned }), {
      hops: ["ab", "ab2", "bc"],
      structures: ["a", "b", "c"],
    });
  });

  it("falls back to the play when nothing is hovered or pinned", () => {
    assert.deepStrictEqual(spotlight({ play }), {
      hops: ["cd"],
      structures: ["c", "d"],
    });
  });

  it("skips a hovered item that isn't drawn and takes the pinned one", () => {
    assert.deepStrictEqual(
      spotlight({ play, pinned, hovered: structureTarget("e") }),
      { hops: ["ab", "ab2", "bc"], structures: ["a", "b", "c"] }
    );
  });

  it("takes a hovered item over all flows", () => {
    assert.deepStrictEqual(
      spotlight({ play: "all", hovered: hopTarget("cd") }),
      { hops: ["cd"], structures: ["c", "d"] }
    );
  });
});

describe("the spotlight of a chapter and flow choice", () => {
  const flows = [
    { id: "f-one", name: "One", hops: ["ab", "bc"] },
    { id: "f-two", name: "Two", hops: ["cd"] },
  ];

  const flowData = { ...data, flows };
  const chapter = { revealed, plays: ["ab2"] };

  const choose = (choice: FlowChoice) =>
    chapterSpotlightOf({
      data: flowData,
      stop: chapter,
      choice,
      hovered: null,
      pinned: null,
    });

  it("plays the chapter's hops for the chapter choice", () => {
    assert.deepStrictEqual(choose({ kind: "chapter" })?.hops, new Set(["ab2"]));
  });

  it("plays one flow's hops, and fades nothing for all flows", () => {
    assert.deepStrictEqual(
      choose({ kind: "flow", id: "f-one" })?.hops,
      new Set(["ab", "bc"])
    );
    assert.isNull(choose({ kind: "all" }));
  });

  it("fades nothing for a flow that doesn't exist", () => {
    assert.isNull(choose({ kind: "flow", id: "f-nope" }));
  });

  const start = (plays: readonly string[], isLast: boolean) =>
    defaultFlowChoice({ data: flowData, stop: { plays }, isLast }).kind;

  it("starts the last chapter on all flows only when it plays nothing", () => {
    assert.strictEqual(start([], true), "all");
    assert.strictEqual(start(["ab"], true), "chapter");
    assert.strictEqual(start([], false), "chapter");
  });
});
