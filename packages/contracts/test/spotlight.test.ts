import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Order } from "effect";

import { chapterSpotlightOf, defaultFlowChoice } from "../src/index.ts";
import type { FlowChoice, SpotlightTarget } from "../src/index.ts";

// Seam 3: the spotlight, from the map's hops, what's revealed, the chapter's
// play and the hovered and pinned items.

const hop = (id: string, from: string, to: string) => ({
  from,
  id,
  label: id,
  to,
});

// a → b → c → d, a second hop from a to b, and a hop to e, which isn't
// revealed.
const data = {
  flows: [],
  hops: [
    hop("ab", "a", "b"),
    hop("ab2", "a", "b"),
    hop("bc", "b", "c"),
    hop("cd", "c", "d"),
    hop("de", "d", "e"),
  ],
};

const revealed = new Set(["a", "b", "c", "d", "f"]);

interface Choice {
  readonly drawing?: {
    readonly from: string;
    readonly over: string | null;
  } | null;
  readonly hovered: SpotlightTarget | null;
  readonly pinned: SpotlightTarget | null;
  /** The hops the chapter plays, or `"all"` for all flows. */
  readonly play: ReadonlyArray<string> | "all";
}

const nothing: Choice = { hovered: null, pinned: null, play: [] };

const spotlight = (picked: Partial<Choice>) => {
  const { play, ...rest } = { ...nothing, ...picked };

  const result = chapterSpotlightOf({
    choice: play === "all" ? { kind: "all" } : { kind: "chapter" },
    data,
    stop: { plays: play === "all" ? [] : play, revealed },
    ...rest,
  });

  return result === null
    ? null
    : {
        hops: Arr.sort([...result.hops], Order.String),
        structures: Arr.sort([...result.structures], Order.String),
      };
};

const hopTarget = (id: string): SpotlightTarget => ({ id, kind: "hop" });

const structureTarget = (id: string): SpotlightTarget => ({
  id,
  kind: "structure",
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

  it.each([
    ["the chapter plays nothing", []],
    ["none of the played hops is drawn", ["de"]],
  ] as const)("fades nothing when %s", (_why, play) => {
    assert.isNull(spotlight({ play }));
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
      spotlight({ hovered: hopTarget("ab"), pinned, play }),
      { hops: ["ab"], structures: ["a", "b"] }
    );
  });

  it("takes the pinned item over the play when nothing is hovered", () => {
    assert.deepStrictEqual(spotlight({ pinned, play }), {
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
      spotlight({ hovered: structureTarget("e"), pinned, play }),
      { hops: ["ab", "ab2", "bc"], structures: ["a", "b", "c"] }
    );
  });

  it("takes a hovered item over all flows", () => {
    assert.deepStrictEqual(
      spotlight({ hovered: hopTarget("cd"), play: "all" }),
      { hops: ["cd"], structures: ["c", "d"] }
    );
  });
});

describe("the spotlight of a chapter and flow choice", () => {
  const flows = [
    { hops: ["ab", "bc"], id: "f-one", name: "One" },
    { hops: ["cd"], id: "f-two", name: "Two" },
  ];

  const flowData = { ...data, flows };
  const chapter = { plays: ["ab2"], revealed };

  const choose = (choice: FlowChoice) =>
    chapterSpotlightOf({
      choice,
      data: flowData,
      hovered: null,
      pinned: null,
      stop: chapter,
    });

  it("plays the chapter's hops for the chapter choice", () => {
    assert.deepStrictEqual(choose({ kind: "chapter" })?.hops, new Set(["ab2"]));
  });

  it("plays one flow's hops, and fades nothing for all flows", () => {
    assert.deepStrictEqual(
      choose({ id: "f-one", kind: "flow" })?.hops,
      new Set(["ab", "bc"])
    );
    assert.isNull(choose({ kind: "all" }));
  });

  it("fades nothing for a flow that doesn't exist", () => {
    assert.isNull(choose({ id: "f-nope", kind: "flow" }));
  });

  const start = (plays: ReadonlyArray<string>, isLast: boolean) =>
    defaultFlowChoice({ data: flowData, isLast, stop: { plays } }).kind;

  it("starts the last chapter on all flows only when it plays nothing", () => {
    assert.strictEqual(start([], true), "all");
    assert.strictEqual(start(["ab"], true), "chapter");
    assert.strictEqual(start([], false), "chapter");
  });
});

describe("a hop being drawn", () => {
  it("lights its start and the structure under the pointer, over the hover and the pin", () => {
    const lit = spotlight({
      drawing: { from: "a", over: "d" },
      hovered: hopTarget("ab"),
      pinned: structureTarget("c"),
    });

    assert.deepStrictEqual(lit, { hops: [], structures: ["a", "d"] });
  });

  it("lights the start alone while the pointer is over empty space", () => {
    const lit = spotlight({ drawing: { from: "a", over: null } });

    assert.deepStrictEqual(lit, { hops: [], structures: ["a"] });
  });

  it("changes nothing when no hop is being drawn", () => {
    assert.deepStrictEqual(
      spotlight({ drawing: null, pinned: structureTarget("c") }),
      spotlight({ pinned: structureTarget("c") })
    );
  });
});
