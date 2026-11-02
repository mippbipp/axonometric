import { groundProjections } from "@axonometric/contracts";
import type { GridPoint, HopEnds, View } from "@axonometric/contracts";
import { Array as Arr } from "effect";

/**
 * Shifts the drawing of structures being dragged, their name tags and their
 * pending badges, by the ground move `by`, so the boxes follow the pointer
 * without rerouting every hop on each step. Both views project the ground
 * linearly, so one offset moves the whole drawing. The routes follow on
 * drop.
 *
 * `groups` are zone ids whose plates shift too. Anything shifted by an
 * earlier call is put back first; call it with no `ids` to clear.
 */
export const shiftDrawing = ({
  root,
  view,
  ids = [],
  groups = [],
  hops = [],
  changing = ids,
  by,
}: {
  readonly root: ParentNode;
  readonly view: View;
  readonly ids?: readonly string[];
  /**
   * The map's hops. Hops stay where they were while their structures move,
   * so the label of any hop with an end on a moving structure would lie on
   * whatever the structure is dragged over. Those labels are hidden until
   * the drop routes the hops again.
   */
  readonly hops?: readonly HopEnds[];
  /**
   * The structures whose footprint is changing, which `hops` are matched
   * against. A resize changes one without shifting it. Defaults to `ids`.
   */
  readonly changing?: readonly string[];
  readonly groups?: readonly string[];
  readonly by?: GridPoint | undefined;
}) => {
  for (const element of root.querySelectorAll<SVGElement>(
    "[data-drag-shifted]"
  )) {
    element.removeAttribute("transform");
    delete element.dataset.dragShifted;
  }

  for (const element of root.querySelectorAll<SVGElement>(
    "[data-drag-hidden]"
  )) {
    delete element.dataset.dragHidden;
  }

  if (by === undefined || changing.length === 0) {
    return;
  }

  const ground = groundProjections[view];
  const from = ground.toScreen({ x: 0, y: 0 });
  const to = ground.toScreen(by);
  const transform = `translate(${to.sx - from.sx} ${to.sy - from.sy})`;

  const hidden = Arr.filter(
    hops,
    (hop) => changing.includes(hop.from) || changing.includes(hop.to)
  );

  for (const { id } of hidden) {
    for (const element of root.querySelectorAll<SVGElement>(
      `[data-hop-label="${CSS.escape(id)}"]`
    )) {
      element.dataset.dragHidden = "";
    }
  }

  const selector = Arr.join(
    [
      ...Arr.map(ids, (moving) => {
        const id = CSS.escape(moving);

        return `[data-structure="${id}"], [data-name-tag="${id}"], [data-pending-badge="${id}"]`;
      }),
      ...Arr.map(groups, (group) => `[data-zone="${CSS.escape(group)}"]`),
    ],
    ", "
  );

  // A resize shifts nothing, and an empty selector isn't one.
  const shifted =
    selector === "" ? [] : root.querySelectorAll<SVGElement>(selector);

  for (const element of shifted) {
    element.setAttribute("transform", transform);
    element.dataset.dragShifted = "";
  }
};
