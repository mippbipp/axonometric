import { convexOverlap } from "@axonometric/contracts";
import type {
  Scene,
  SceneStructure,
  ScreenPoint,
  ScreenRect,
} from "@axonometric/contracts";
import { Array as Arr, Option } from "effect";
import { dual } from "effect/Function";

// Text on the map is drawn at base scale and zooms with the drawing. Name
// tags keep a readable size as the view zooms out: each grows about its
// anchor, the edge that faces its structure. Hop labels and code chips show
// only at zooms where they'd be readable. Zoom to fit stops zooming out where
// grown tags would start to collide.

/** The smallest size a name tag draws at on screen, in pixels. */
const tagMinimum = 10;

/** A name tag's font size at base scale, Tailwind's text-xs. */
const tagFont = 12;

/** The smallest size a hop label or code chip shows at, in pixels. */
const detailMinimum = 9;

/** The zoom from which hop labels show: their 12 px font at 9 px. */
export const hopLabelsFrom = detailMinimum / 12;

/** The zoom from which code chips show: their 10 px font at 9 px. */
export const codeChipsFrom = detailMinimum / 10;

/** How much a name tag grows at zoom `scale` to stay readable. */
export const tagGrowthAt = (scale: number) =>
  Math.max(1, tagMinimum / tagFont / scale);

/** A name tag at base scale and the point it grows about. */
export interface GrowingTag {
  readonly rect: ScreenRect;
  readonly anchor: ScreenPoint;
}

/** What the grown tags must stay clear of. */
export interface TagSurroundings {
  readonly tags: readonly GrowingTag[];
  /** Boxes, as convex polygons. */
  readonly shapes: readonly (readonly ScreenPoint[])[];
  /** Other text and the zoom from which it shows. */
  readonly text: readonly {
    readonly polygon: readonly ScreenPoint[];
    readonly shownFrom: number;
  }[];
}

const grown = ({ rect, anchor }: GrowingTag, by: number): ScreenRect => ({
  left: anchor.sx + (rect.left - anchor.sx) * by,
  right: anchor.sx + (rect.right - anchor.sx) * by,
  top: anchor.sy + (rect.top - anchor.sy) * by,
  bottom: anchor.sy + (rect.bottom - anchor.sy) * by,
});

const corners = (rect: ScreenRect): readonly ScreenPoint[] => [
  { sx: rect.left, sy: rect.top },
  { sx: rect.right, sy: rect.top },
  { sx: rect.right, sy: rect.bottom },
  { sx: rect.left, sy: rect.bottom },
];

/** The most a tag is ever checked growing by, past which nothing changes. */
const largestGrowth = 64;

/**
 * The least growth at which `clashes` holds, or none when it holds at
 * no growth or already at full size. Growing a tag about a point inside it
 * only adds to it, so a clash stays once it starts.
 */
const clashFrom = (clashes: (by: number) => boolean): Option.Option<number> => {
  if (clashes(1) || !clashes(largestGrowth)) {
    return Option.none();
  }

  let low = 1;
  let high = largestGrowth;

  for (let round = 0; round < 40; round += 1) {
    const middle = (low + high) / 2;

    if (clashes(middle)) {
      high = middle;
    } else {
      low = middle;
    }
  }

  return Option.some(low);
};

/** A range of zooms at which grown tags would collide. */
interface Blocked {
  readonly from: number;
  readonly to: number;
}

const blockedBy = (growth: Option.Option<number>, shownFrom = 0) =>
  Option.match(growth, {
    onNone: () => [],
    onSome: (by) => [{ from: shownFrom, to: tagMinimum / tagFont / by }],
  });

const blockedRanges = ({ tags, shapes, text }: TagSurroundings) =>
  Arr.flatMap(tags, (tag, index): readonly Blocked[] => {
    const at = (by: number) => corners(grown(tag, by));

    return [
      ...Arr.flatMap(tags.slice(index + 1), (other) =>
        blockedBy(
          clashFrom((by) => convexOverlap(at(by), corners(grown(other, by))))
        )
      ),
      ...Arr.flatMap(shapes, (shape) =>
        blockedBy(clashFrom((by) => convexOverlap(at(by), shape)))
      ),
      ...Arr.flatMap(text, ({ polygon, shownFrom }) =>
        blockedBy(
          clashFrom((by) => convexOverlap(at(by), polygon)),
          shownFrom
        )
      ),
    ];
  });

/**
 * The zoom zoom to fit uses, given the zoom `fitScale` that fits: the
 * smallest zoom from `fitScale` up at which no grown tag overlaps another
 * tag, a box or text that's showing. Overlaps the drawing already has at
 * base size don't count.
 */
export const readableScale: {
  (fitScale: number): (surroundings: TagSurroundings) => number;
  (surroundings: TagSurroundings, fitScale: number): number;
} = dual(2, (surroundings: TagSurroundings, fitScale: number): number => {
  const blocked = blockedRanges(surroundings);
  let scale = fitScale;
  let moved = true;

  while (moved) {
    const current = scale;

    const inside = Arr.filter(
      blocked,
      ({ from, to }) => current >= from && current < to
    );

    moved = inside.length > 0;
    scale = Math.max(scale, ...Arr.map(inside, ({ to }) => to));
  }

  return scale;
});

/** The edge of a name tag that faces its structure, which it grows from. */
export type TagSide = "top" | "bottom" | "left" | "right";

/** The edge of `placed`'s name tag that faces its box. */
export const tagSideOf = ({ tag, bounds }: SceneStructure): TagSide => {
  if (tag.top >= bounds.bottom - 1e-6) {
    return "top";
  }

  if (tag.bottom <= bounds.top + 1e-6) {
    return "bottom";
  }

  return tag.left >= (bounds.left + bounds.right) / 2 ? "left" : "right";
};

/** The middle of a rect's `side`. */
const middleOf = (rect: ScreenRect, side: TagSide): ScreenPoint => {
  const sx = (rect.left + rect.right) / 2;
  const sy = (rect.top + rect.bottom) / 2;

  return {
    top: { sx, sy: rect.top },
    bottom: { sx, sy: rect.bottom },
    left: { sx: rect.left, sy },
    right: { sx: rect.right, sy },
  }[side];
};

/** What a scene's grown name tags must stay clear of. */
export const surroundingsOf = (scene: Scene): TagSurroundings => ({
  tags: Arr.map(scene.structures, (placed) => ({
    rect: placed.tag,
    anchor: middleOf(placed.tag, tagSideOf(placed)),
  })),
  shapes: Arr.map(scene.structures, ({ outline }) => outline),
  text: [
    ...Arr.flatMap(scene.hops, ({ label }) =>
      label === undefined
        ? []
        : [{ polygon: corners(label), shownFrom: hopLabelsFrom }]
    ),
    ...Arr.flatMap(scene.zones, ({ title }) =>
      title === undefined ? [] : [{ polygon: title, shownFrom: 0 }]
    ),
  ],
});
