import { droppedIntoGroup } from "@axonometric/contracts";
import type { Placement } from "@axonometric/contracts";
import { Option } from "effect";

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
 */
export const useDrop = () => {
  const editing = useEditing();
  const proposing = useProposed();
  const { state, revealed } = useWalkthrough();

  return {
    /** Why dropping structure `id` at `next` would be refused, or `undefined`. */
    refusalOf: (id: string, next: Placement): string | undefined =>
      proposing?.refusalOfPlace(id, next) ?? editing?.refusalOf(id, next),
    /** Drops structure `id` at `next`. */
    drop: (id: string, next: Placement) => {
      if (proposing?.isOpenAdd(id) === true) {
        proposing.place(id, next, () => {});

        return;
      }

      editing?.place(id, next);

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
        proposing?.propose({ action: "group", structure: id, group }, () => {});
      }
    },
  };
};
