import { boundsOfPoints } from "@axonometric/contracts";
import type { Scene, ScreenRect, View } from "@axonometric/contracts";
import { Array as Arr } from "effect";

import { viewDrawings } from "./views.tsx";
import type { ViewDrawing } from "./views.tsx";

/** Everything a scene draws, with the structures each belongs to. */
export const drawnIn = ({
  scene,
  drawing,
}: {
  readonly scene: Scene;
  readonly drawing: ViewDrawing;
}) => [
  ...Arr.map(scene.structures, (item) => ({
    ids: [item.structure.id],
    points: drawing.extentOf(item),
  })),
  ...Arr.map(scene.hops, ({ hop, points, label }) => ({
    ids: [hop.from, hop.to],
    points:
      label === undefined
        ? points
        : [
            ...points,
            { sx: label.left, sy: label.top },
            { sx: label.right, sy: label.bottom },
          ],
  })),
  ...Arr.map(scene.zones, ({ zone, plate, title }) => ({
    ids: zone.members,
    points: [...plate, ...(title ?? [])],
  })),
];

/** The smallest rect holding everything the scene draws. */
export const extentOf = ({
  scene,
  view,
}: {
  readonly scene: Scene;
  readonly view: View;
}): ScreenRect =>
  boundsOfPoints(
    Arr.flatMap(
      drawnIn({ scene, drawing: viewDrawings[view] }),
      ({ points }) => points
    )
  );
