import type { HopMark, StructureMark } from "@axonometric/contracts";

/** The kinds of difference a compare draws: the marks, and the place a structure was. */
export type CompareKind = StructureMark | HopMark | "origin";

/** How one kind of difference is drawn and worded. */
export interface Look {
  /** The legend's words. */
  readonly label: string;
  /** What a screen reader hears after the name. */
  readonly spoken: string;
  /** The stroke colour, as a Tailwind class. */
  readonly stroke: string;
  /** The stroke's dash pattern, so a look never depends on colour alone. */
  readonly dash: string | undefined;
}

/**
 * The looks of a compare, which marks with outlines only: no text sits on
 * the map. Colour and dash both differ between kinds. "Added" and "removed"
 * are as the accepted map sees them: "added" is in the revision only, and
 * "removed" is in the accepted map only, which is drawn as a ghost.
 *
 * "Origin" is the place a moved or resized structure has in the accepted map.
 * It is the ink colour with a dotted line, so it can't be taken for the
 * ghost, which is pink and dashed.
 */
export const looks = {
  moved: {
    label: "Moved",
    spoken: "moved",
    stroke: "stroke-moved",
    dash: "7 3",
  },
  resized: {
    label: "Resized",
    spoken: "resized",
    stroke: "stroke-resized",
    dash: "2 2",
  },
  changed: {
    label: "Text changed",
    spoken: "text changed",
    stroke: "stroke-changed",
    dash: undefined,
  },
  added: {
    label: "Only in this revision",
    spoken: "only in this revision",
    stroke: "stroke-added",
    dash: "10 2 2 2",
  },
  removed: {
    label: "Only in the accepted map (ghost)",
    spoken: "only in the accepted map",
    stroke: "stroke-removed",
    dash: "4 4",
  },
  origin: {
    label: "Where it is in the accepted map",
    spoken: "its place in the accepted map",
    stroke: "stroke-ink",
    dash: "1 4",
  },
} as const satisfies Readonly<Record<CompareKind, Look>>;

/** The order the legend lists the kinds in. */
export const legendOrder: readonly CompareKind[] = [
  "moved",
  "resized",
  "changed",
  "added",
  "removed",
  "origin",
];
