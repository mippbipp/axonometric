import type { HopMark, StructureMark } from "@axonometric/contracts";

/** How one kind of difference is drawn, worded and read aloud. */
export interface Look {
  /** The legend's words. */
  readonly label: string;
  /** The few words on the badge over the drawing. */
  readonly badge: string;
  /** What a screen reader hears after the name. */
  readonly spoken: string;
  /** The stroke colour, as a Tailwind class. */
  readonly stroke: string;
  /** The fill colour, as a Tailwind class. */
  readonly fill: string;
  /** The stroke's dash pattern, so a look never depends on colour alone. */
  readonly dash: string | undefined;
}

/**
 * The looks of a compare. Colour, dashes and the badge's words all differ
 * between kinds. "Added" and "removed" are from the revision's side:
 * restoring would add what only the revision has and remove what only the
 * current map has, which is drawn as a ghost.
 */
export const looks: Readonly<Record<StructureMark | HopMark, Look>> = {
  moved: {
    label: "Moved",
    badge: "moved",
    spoken: "moved",
    stroke: "stroke-moved",
    fill: "fill-moved",
    dash: "7 3",
  },
  resized: {
    label: "Resized",
    badge: "resized",
    spoken: "resized",
    stroke: "stroke-resized",
    fill: "fill-resized",
    dash: "2 2",
  },
  changed: {
    label: "Text changed",
    badge: "text",
    spoken: "text changed",
    stroke: "stroke-changed",
    fill: "fill-changed",
    dash: undefined,
  },
  added: {
    label: "Only in this revision",
    badge: "revision only",
    spoken: "in this revision only",
    stroke: "stroke-added",
    fill: "fill-added",
    dash: "10 2 2 2",
  },
  removed: {
    label: "Only in the current map (ghost)",
    badge: "current only",
    spoken: "in the current map only",
    stroke: "stroke-removed",
    fill: "fill-removed",
    dash: "4 4",
  },
};

/** The order the legend lists the kinds in. */
export const legendOrder: readonly (StructureMark | HopMark)[] = [
  "moved",
  "resized",
  "changed",
  "added",
  "removed",
];
