import { droppedIntoGroup } from "@axonometric/contracts";
import type { Placement, StructureChange } from "@axonometric/contracts";
import { Option, Result } from "effect";

import { useChangePreview } from "./drag-preview-context.ts";
import { useEditing } from "./editing-context.ts";
import { useProposed } from "./proposed-context.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/**
 * What dropping one structure does.
 *
 * - A structure the engineer proposed and hasn't sent yet moves with its
 *   proposal, because it is not in the layout yet.
 * - Any other structure moves as a layout change. If the drop lands in
 *   another group's zone, the group change is proposed as well. A drop in its
 *   own zone, or in none, is a layout change alone.
 *
 * What the group change would add to `check`'s report, or why it is refused,
 * shows in the warnings panel the drag used. The drop's layout change has
 * landed by then, so a refused group change says so rather than undoing it.
 */
export const useDrop = () => {
  const editing = useEditing();
  const proposing = useProposed();
  const panel = useChangePreview();
  const { state, revealed } = useWalkthrough();

  /** Proposes `change`, and shows in the panel what it adds or why it was refused. */
  const proposeShown = (
    change: StructureChange,
    moved: Readonly<Record<string, Placement>>
  ) => {
    if (proposing === null) {
      return;
    }

    const refusal = proposing.refusalOf(change);

    if (refusal !== undefined) {
      panel?.show({ refusal, problems: [] });

      return;
    }

    panel?.show({ problems: proposing.problemsOf([change], moved) });
    proposing.propose(change, (outcome) => {
      const why = Option.getOrUndefined(Result.getFailure(outcome));

      if (why !== undefined) {
        panel?.show({ refusal: why, problems: [] });
      }
    });
  };

  return {
    /** Why dropping structure `id` at `next` would be refused, or `undefined`. */
    refusalOf: (id: string, next: Placement): string | undefined =>
      proposing?.refusalOfPlace(id, next) ?? editing?.refusalOf(id, next),
    /** Drops structure `id` at `next`. */
    drop: (id: string, next: Placement) => {
      if (proposing?.isOpenAdd(id) === true) {
        proposing.place(id, next, (outcome) => {
          const why = Option.getOrUndefined(Result.getFailure(outcome));

          if (why !== undefined) {
            panel?.show({ refusal: why, problems: [] });
          }
        });

        return;
      }

      editing?.place(id, next);

      // The zones the structure lands in are those of the proposed map with
      // the move applied, so the group is judged where it now stands.
      const group = Option.getOrUndefined(
        droppedIntoGroup({
          data: state.data,
          layout: state.layout,
          id,
          at: next,
          revealed,
        })
      );

      if (group !== undefined) {
        proposeShown({ action: "group", structure: id, group }, { [id]: next });
      }
    },
  };
};
