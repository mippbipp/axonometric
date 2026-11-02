import { Option } from "effect";

import type { BatchItem, Verdict } from "./proposals.ts";
import type { KindSpec, Touches } from "./review-kinds.ts";

/** An item that draws nothing differently. */
export const touchesNothing: Touches = {
  structures: [],
  hops: [],
  marks: [],
};

/** `--as` names a structure's final id, so it only fits an item that adds one. */
export const asRefusal = (verdict: Verdict): Option.Option<string> =>
  verdict.verdict === "changed" && verdict.as !== undefined
    ? Option.some(
        "--as gives a new structure the id you used for it in data.mjs. This item adds no structure."
      )
    : Option.none();

/**
 * The members of `KindSpec` that a kind with no effect on the map's data,
 * no `--as` and no new structure of its own leaves as they are, and the
 * `diagram` section, which every kind but a chapter change is listed in. A
 * kind spreads `plain<Item>()` and overrides the members it uses, so a member
 * added to `KindSpec` for one kind does not touch the others.
 */
export const plain = <I extends BatchItem>(): Pick<
  KindSpec<I>,
  | "appliesToData"
  | "touches"
  | "commitRefusal"
  | "verdictRefusal"
  | "renames"
  | "retargeted"
  | "section"
> => ({
  section: "diagram",
  appliesToData: (_item, map) => map,
  touches: () => touchesNothing,
  commitRefusal: () => Option.none(),
  verdictRefusal: (_item, verdict) => asRefusal(verdict),
  renames: () => [],
  retargeted: (item) => item,
});

/** The name of the mark for structures proposed for deletion, in `Touches.marks`. */
export const removedMark = "removed";
