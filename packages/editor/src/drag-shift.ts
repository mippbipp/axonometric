import { groundProjections } from "@axonometric/contracts";
import type { GridPoint, View } from "@axonometric/contracts";
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
  by,
}: {
  readonly root: ParentNode;
  readonly view: View;
  readonly ids?: readonly string[];
  readonly groups?: readonly string[];
  readonly by?: GridPoint | undefined;
}) => {
  for (const element of root.querySelectorAll<SVGElement>(
    "[data-drag-shifted]"
  )) {
    element.removeAttribute("transform");
    delete element.dataset.dragShifted;
  }

  if (by === undefined || (ids.length === 0 && groups.length === 0)) {
    return;
  }

  const ground = groundProjections[view];
  const from = ground.toScreen({ x: 0, y: 0 });
  const to = ground.toScreen(by);
  const transform = `translate(${to.sx - from.sx} ${to.sy - from.sy})`;

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

  for (const element of root.querySelectorAll<SVGElement>(selector)) {
    element.setAttribute("transform", transform);
    element.dataset.dragShifted = "";
  }
};
