import { Array as Arr, Order } from "effect";

import { changedChapterProblems, changedProblems } from "./layout-checks.ts";
import type { Checkable, DraggedProblem } from "./layout-checks.ts";
import type { Placement } from "./layout.ts";
import type { BatchItem } from "./proposals.ts";
import { applyOrder, specOf } from "./review-kinds.ts";
import type { MapShape } from "./review-kinds.ts";

const byKind = Order.mapInput(Order.Number, (item: BatchItem) =>
  applyOrder.indexOf(item.kind)
);

/** Where a proposal's layout checks look: the whole map, or one chapter's drawing. */
export type CheckScope =
  | { readonly of: "map" }
  | { readonly of: "chapter"; readonly chapter: string | undefined };

/**
 * Everything `check` would report for the map as proposed with `items` taken
 * as they stand, each marked `added` when the map as proposed now didn't have
 * it. It is the check a drag runs. `items` are any open items of any kind: each
 * says through the kind table (`whenTaken`, else `appliesToData`) what it does
 * to the data and the layout, so a kind added to the table is checked with no
 * change here.
 *
 * `scope` is the whole map, which `check` reports, or the one chapter the
 * engineer is viewing, for a proposal that changes how a chapter draws, such
 * as a new group or a structure revealed in it.
 *
 * `moved` puts structures where a drop has just put them before the items
 * apply.
 */
export const proposalProblems = ({
  before,
  items,
  scope = { of: "map" },
  moved = {},
}: {
  /** The map as proposed now. */
  readonly before: Checkable;
  readonly items: readonly BatchItem[];
  readonly scope?: CheckScope;
  /** Structures a drop has just moved, by id. */
  readonly moved?: Readonly<Record<string, Placement>>;
}): readonly DraggedProblem[] => {
  const from: Checkable = {
    data: before.data,
    layout: {
      ...before.layout,
      structures: { ...before.layout.structures, ...moved },
    },
  };

  const after = Arr.reduce(
    Arr.sort(items, byKind),
    from satisfies MapShape,
    (map, item): MapShape => {
      const spec = specOf(item);

      return spec.whenTaken === undefined
        ? spec.appliesToData(item, map)
        : spec.whenTaken(item, map);
    }
  );

  return scope.of === "map"
    ? changedProblems(after, from)
    : changedChapterProblems({ after, before: from, chapter: scope.chapter });
};
