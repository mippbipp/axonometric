import type { MapData, Spotlight } from "@axonometric/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Order, Result } from "effect";

import { flowOptionsOf } from "../../editor/src/chapters.ts";
import {
  agentSpotlightOf,
  chapterIndexOf,
  decodeInput,
  flowOptionOf,
  GoToChapterInput,
  PinInput,
  spotlightNoticeOf,
} from "../../editor/src/view-tools.ts";

const stops = [{ id: "intro" }, { id: "build" }, { id: "ship" }];

const data: Pick<MapData, "flows" | "hops"> = {
  flows: [
    { hops: ["ab"], id: "login", name: "Login" },
    { hops: ["bc"], id: "pay", name: "Pay" },
  ],
  hops: [
    { from: "a", id: "ab", label: "ab", to: "b" },
    { from: "b", id: "bc", label: "bc", to: "c" },
    { from: "c", id: "cd", label: "cd", to: "d" },
  ],
};

const sorted = (spot: Spotlight | null) => ({
  hops: Arr.sort([...(spot?.hops ?? [])], Order.String),
  structures: Arr.sort([...(spot?.structures ?? [])], Order.String),
});

const revealed = new Set(["a", "b", "c"]);

describe("the chapter an agent names", () => {
  it("counts from 1, as the chapter rail does", () => {
    assert.deepStrictEqual(
      chapterIndexOf({ chapter: 3, stops }),
      Result.succeed(2)
    );
  });

  it("takes a chapter id", () => {
    assert.deepStrictEqual(
      chapterIndexOf({ chapter: "build", stops }),
      Result.succeed(1)
    );
  });

  it("says how many chapters there are for a number past the end", () => {
    assert.deepStrictEqual(
      chapterIndexOf({ chapter: 4, stops }),
      Result.fail("There is no chapter 4. The map has 3 chapters.")
    );
  });

  it("lists the ids for an id that isn't one", () => {
    assert.deepStrictEqual(
      chapterIndexOf({ chapter: "nope", stops }),
      Result.fail(
        'There is no chapter with the id "nope". The chapter ids are "intro", "build", "ship".'
      )
    );
  });
});

describe("a tool's input", () => {
  it("refuses a chapter number of 0", () => {
    assert.isTrue(
      Result.isFailure(decodeInput(GoToChapterInput, { chapter: 0 }))
    );
  });

  it("refuses a missing field with a reason an agent can read", () => {
    const decoded = decodeInput(PinInput, {});

    assert.isTrue(Result.isFailure(decoded));
    assert.match(
      Result.getOrElse(Result.flip(decoded), () => ""),
      /structure/u
    );
  });

  it("takes null to unpin", () => {
    assert.deepStrictEqual(
      decodeInput(PinInput, { structure: null }),
      Result.succeed({ structure: null })
    );
  });
});

describe("the flow an agent picks", () => {
  const options = flowOptionsOf({ flows: data.flows, stop: { plays: [] } });

  it("lists every flow and all of them, and the chapter's own only when it plays", () => {
    assert.deepStrictEqual(
      Arr.map(options, ({ key }) => key),
      ["flow:login", "flow:pay", "all"]
    );
    assert.deepStrictEqual(
      Arr.map(
        flowOptionsOf({ flows: data.flows, stop: { plays: ["ab"] } }),
        ({ key }) => key
      ),
      ["chapter", "flow:login", "flow:pay", "all"]
    );
  });

  it("finds an option by its key", () => {
    const found = flowOptionOf({
      flow: "flow:pay",
      flowCount: 2,
      isLast: true,
      options,
    });

    assert.deepStrictEqual(
      Result.map(found, ({ label }) => label),
      Result.succeed("Pay")
    );
  });

  it("refuses outside the last chapter", () => {
    assert.isTrue(
      Result.isFailure(
        flowOptionOf({ flow: "all", flowCount: 2, isLast: false, options })
      )
    );
  });

  it("names the choices when the key isn't one", () => {
    assert.deepStrictEqual(
      flowOptionOf({ flow: "flow:x", flowCount: 2, isLast: true, options }),
      Result.fail(
        'There is no flow choice "flow:x". The choices are "flow:login" (Login), "flow:pay" (Pay), "all" (All flows).'
      )
    );
  });
});

describe("the agent's spotlight", () => {
  it("lights a structure with its hops and their other ends", () => {
    const lit = agentSpotlightOf({ data, revealed, structures: ["a"] });

    assert.deepStrictEqual(
      Result.map(lit, sorted),
      Result.succeed({ hops: ["ab"], structures: ["a", "b"] })
    );
  });

  it("joins what each target would light", () => {
    const lit = agentSpotlightOf({
      data,
      hops: ["bc"],
      revealed,
      structures: ["a"],
    });

    assert.deepStrictEqual(
      Result.map(lit, sorted),
      Result.succeed({ hops: ["ab", "bc"], structures: ["a", "b", "c"] })
    );
  });

  it("clears with no targets", () => {
    assert.deepStrictEqual(
      agentSpotlightOf({ data, hops: [], revealed, structures: [] }),
      Result.succeed(null)
    );
  });

  it("refuses a structure that isn't shown, naming it", () => {
    assert.deepStrictEqual(
      agentSpotlightOf({ data, revealed, structures: ["d"] }),
      Result.fail('The structure "d" is not shown in this chapter.')
    );
  });

  it("refuses a hop with an end that isn't shown, or that doesn't exist", () => {
    assert.deepStrictEqual(
      agentSpotlightOf({ data, hops: ["cd"], revealed }),
      Result.fail('The hop "cd" is not drawn in this chapter.')
    );
    assert.deepStrictEqual(
      agentSpotlightOf({ data, hops: ["zz"], revealed }),
      Result.fail('The hop "zz" is not drawn in this chapter.')
    );
  });

  it("words its notice with the right plurals", () => {
    assert.strictEqual(
      spotlightNoticeOf({ hops: ["x"], structures: ["a", "b"] }),
      "Agent spotlit 2 structures and 1 hop"
    );
    assert.strictEqual(
      spotlightNoticeOf({ structures: ["a"] }),
      "Agent spotlit 1 structure"
    );
    assert.strictEqual(spotlightNoticeOf({}), "Agent cleared the spotlight");
  });
});
