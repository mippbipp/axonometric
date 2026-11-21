import { groundProjections } from "@axonometric/contracts";
import type { GridPoint, HopEnds, Scene, View } from "@axonometric/contracts";
import { Array as Arr } from "effect";
import { createContext, use, useEffect } from "react";
import type { RefObject } from "react";

/**
 * How a drag in progress shifts the drawing: the boxes follow the pointer
 * without rerouting every hop on each step, and the routes follow on drop.
 */
export interface DragShift {
  /** The groups whose zone plates shift. */
  readonly groups: ReadonlyArray<string>;
  /**
   * The hops with an end on a structure whose footprint is changing. They
   * stay where they were while their structures move, so each would point
   * at an empty outline, and its label would lie on whatever the structure
   * is dragged over. They are hidden, line, head and label, until the drop
   * routes them again.
   */
  readonly hiddenHops: ReadonlySet<string>;
  /** How far the shifted parts move, in drawing units. */
  readonly offset: { readonly x: number; readonly y: number };
  /** The structures whose drawing and name tag shift. A resize shifts none. */
  readonly structures: ReadonlySet<string>;
}

/**
 * The shift of a drag that moves `ids` by the ground move `by`. Both views
 * project the ground linearly, so one offset moves the whole drawing.
 * `undefined` while nothing is dragged.
 */
export const dragShiftOf = ({
  by,
  ids = [],
  changing = ids,
  groups = [],
  hops,
  view,
}: {
  readonly by: GridPoint | undefined;
  /**
   * The structures whose footprint is changing, which `hops` are matched
   * against. A resize changes one without shifting it. Defaults to `ids`.
   */
  readonly changing?: ReadonlyArray<string> | undefined;
  readonly groups?: ReadonlyArray<string>;
  readonly hops: ReadonlyArray<HopEnds>;
  readonly ids?: ReadonlyArray<string>;
  readonly view: View;
}): DragShift | undefined => {
  if (by === undefined || changing.length === 0) {
    return undefined;
  }

  const ground = groundProjections[view];
  const from = ground.toScreen({ x: 0, y: 0 });
  const to = ground.toScreen(by);

  return {
    groups,
    hiddenHops: new Set(
      Arr.map(
        Arr.filter(
          hops,
          (hop) => changing.includes(hop.from) || changing.includes(hop.to)
        ),
        ({ id }) => id
      )
    ),
    offset: { x: to.sx - from.sx, y: to.sy - from.sy },
    structures: new Set(ids),
  };
};

/**
 * Draws `shift` on the canvas `root`. Anything an earlier call shifted is
 * put back first, so `undefined` clears it.
 */
const shiftDrawing = (root: ParentNode, shift: DragShift | undefined) => {
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

  if (shift === undefined) {
    return;
  }

  // The hop's line and head, its dashed stretches over boxes, and its label.
  // The packet walking it hides itself as it draws (see `Packet`).
  for (const id of shift.hiddenHops) {
    const hop = CSS.escape(id);

    for (const element of root.querySelectorAll<SVGElement>(
      `[data-hop="${hop}"], [data-hidden-hop="${hop}"], [data-hop-label="${hop}"], [data-hop-pending="${hop}"]`
    )) {
      element.dataset.dragHidden = "";
    }
  }

  const selector = Arr.join(
    [
      ...Arr.map([...shift.structures], (moving) => {
        const id = CSS.escape(moving);

        return `[data-structure="${id}"], [data-name-tag="${id}"]`;
      }),
      ...Arr.map(shift.groups, (group) => `[data-zone="${CSS.escape(group)}"]`),
    ],
    ", "
  );

  // A resize shifts nothing, and an empty selector isn't one.
  const shifted =
    selector === "" ? [] : root.querySelectorAll<SVGElement>(selector);

  for (const element of shifted) {
    element.setAttribute(
      "transform",
      `translate(${shift.offset.x} ${shift.offset.y})`
    );
    element.dataset.dragShifted = "";
  }
};

/**
 * The shift the canvas draws now. `MapView` holds it for `read_view`; a
 * ref, because it changes on every drag step, which must not redraw the map.
 */
export const DrawnShiftContext = createContext<RefObject<
  DragShift | undefined
> | null>(null);

/**
 * Draws `shift` on the canvas around `root`, and keeps it as the drawn
 * shift until the drag ends or the editor unmounts. Hop labels are drawn
 * outside an editor's group, so it shifts from the canvas.
 */
export const useShiftDrawing = ({
  root,
  shift,
}: {
  readonly root: RefObject<SVGGElement | null>;
  readonly shift: DragShift | undefined;
}) => {
  const drawnRef = use(DrawnShiftContext);

  useEffect(() => {
    const canvas = root.current?.ownerSVGElement;

    if (canvas !== null && canvas !== undefined) {
      shiftDrawing(canvas, shift);
    }

    if (drawnRef !== null && shift !== undefined) {
      drawnRef.current = shift;
    }

    // The layout and group editors both call this, so each clears only the
    // shift it set.
    return () => {
      if (drawnRef !== null && drawnRef.current === shift) {
        drawnRef.current = undefined;
      }
    };
  }, [root, shift, drawnRef]);
};

/**
 * `scene` as the canvas draws it under `shift`: the shifted structures'
 * boxes moved by its offset, and the hops it hides left out.
 */
export const shiftedSceneOf = ({
  scene,
  shift,
}: {
  readonly scene: Scene;
  readonly shift: DragShift | undefined;
}): Scene => {
  if (shift === undefined) {
    return scene;
  }

  const { x, y } = shift.offset;

  return {
    ...scene,
    hops: Arr.filter(scene.hops, ({ hop }) => !shift.hiddenHops.has(hop.id)),
    structures: Arr.map(scene.structures, (placed) =>
      shift.structures.has(placed.structure.id)
        ? {
            ...placed,
            bounds: {
              bottom: placed.bounds.bottom + y,
              left: placed.bounds.left + x,
              right: placed.bounds.right + x,
              top: placed.bounds.top + y,
            },
          }
        : placed
    ),
  };
};
