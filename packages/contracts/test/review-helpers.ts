import { assert } from "@effect/vitest";
import { Array as Arr, Option, Result, String as Str } from "effect";

import { freezeOpen, reviewPrompt } from "../src/index.ts";
import type {
  AcceptedItem,
  PartialNames,
  Proposals,
  Verdict,
} from "../src/index.ts";

/** The value inside a success, failing the test with the failure if not. */
export const unwrap = <A, E>(result: Result.Result<A, E>): A => {
  assert.isTrue(Result.isSuccess(result), JSON.stringify(Result.merge(result)));

  return Result.getOrThrow(result);
};

/** The prompt's lines for a batch of `proposals`, frozen now. */
export const promptLines = (proposals: Proposals, names: PartialNames) => {
  const { batch } = unwrap(
    freezeOpen({ proposals, at: "2026-11-01T09:00:00.000Z" })
  );

  return Str.split("\n")(reviewPrompt({ home: "/maps/t", batch, names }));
};

/** The prompt's line for the first item `proposals` holds, once frozen. */
export const promptLine = (proposals: Proposals, names: PartialNames) =>
  Arr.findFirst(promptLines(proposals, names), Str.startsWith("- ")).pipe(
    Option.getOrThrow
  );

/** A "changed" verdict that commits a new item under the id `as`. */
export const changedAs = (as: string): Verdict => ({
  verdict: "changed",
  reason: "Renamed.",
  as,
});

/** The id a taken item was committed as, when the agent chose one. */
export const asOf = (entry: AcceptedItem) =>
  "as" in entry ? entry.as : undefined;

/** Whether a taken item says the agent changed it before taking it. */
export const changedOf = (entry: AcceptedItem) =>
  "changed" in entry ? entry.changed : undefined;
