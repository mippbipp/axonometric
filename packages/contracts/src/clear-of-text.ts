import { Array as Arr } from "effect";

import { rectPolygon } from "./geometry.ts";
import type { Segment } from "./geometry.ts";
import type { ScreenPoint, ScreenRect } from "./iso.ts";
import type { Scene } from "./scene.ts";
import { grown, without } from "./strike.ts";

/** How much room an editing outline keeps from text, in screen units. */
export const outlineClearance = 3;

/** The shortest piece of an outline worth drawing, in screen units. */
const minOutlinePiece = 3;

/** The smallest rect holding `points`. */
const boundsOf = (points: readonly ScreenPoint[]): ScreenRect => ({
  left: Math.min(...Arr.map(points, ({ sx }) => sx)),
  top: Math.min(...Arr.map(points, ({ sy }) => sy)),
  right: Math.max(...Arr.map(points, ({ sx }) => sx)),
  bottom: Math.max(...Arr.map(points, ({ sy }) => sy)),
});

/**
 * Every box of text the scene draws: each structure's name tag and code chip,
 * each zone's title and each hop's label. An editing outline stays clear of
 * these boxes, so it never crosses a letter.
 */
export const textBoxesOf = (scene: Scene): readonly ScreenRect[] => [
  ...Arr.flatMap(scene.structures, ({ tag, chip }) =>
    chip === undefined ? [tag] : [tag, chip]
  ),
  ...Arr.flatMap(scene.zones, ({ title }) =>
    title === undefined ? [] : [boundsOf(title)]
  ),
  ...Arr.flatMap(scene.hops, ({ label }) =>
    label === undefined ? [] : [label]
  ),
];

/**
 * The stretches of the path through `points` that lie outside every box in
 * `text`, each as a segment. A `closed` path also joins its last point to its
 * first. This is how an editing outline, such as a ring round a structure or
 * a line along a hop, is drawn without crossing a name tag, a code chip, a zone
 * title or a hop label: the outline has a gap where the text is.
 */
export const clearOfText = ({
  points,
  text,
  closed,
}: {
  readonly points: readonly ScreenPoint[];
  readonly text: readonly ScreenRect[];
  readonly closed: boolean;
}): readonly Segment[] => {
  const holes = Arr.map(text, (rect) =>
    rectPolygon(grown(rect, outlineClearance))
  );

  const legs = Arr.zip(
    points,
    closed
      ? [...Arr.drop(points, 1), ...Arr.take(points, 1)]
      : Arr.drop(points, 1)
  );

  return Arr.flatMap(legs, ([start, end]) =>
    without({ start, end }, holes, minOutlinePiece)
  );
};
