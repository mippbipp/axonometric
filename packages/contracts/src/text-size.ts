import { tagHeight } from "./iso.ts";

/**
 * Each kind of text's size at base scale, in screen units: its font size,
 * the smallest size it's drawn at on screen, the height of the box behind it
 * and where its baseline sits in that box. The scene places text at these
 * sizes, grown, and the editor draws it from the same table.
 */
export const textSizes = {
  /** The baseline sits `baseline` below the tag's top. */
  tag: { font: 12, least: 10, height: tagHeight, baseline: 13 },
  /** The baseline sits `baseline` above the label's bottom. */
  label: { font: 12, least: 9, height: 15, baseline: 4 },
  /** The baseline sits `baseline` below the chip's middle. */
  chip: { font: 10, least: 9, height: 14, baseline: 3.5 },
  /** A zone title's box is drawn with the scene's ascent and descent. */
  title: { font: 10, least: 9 },
} as const;

/**
 * How big each kind of text is drawn, as a multiple of its base size. A
 * view zoomed out grows its text so it stays readable: name tags to 10 px
 * on screen, hop labels, code chips and zone titles to 9 px.
 */
export interface TextGrowth {
  readonly tag: number;
  readonly label: number;
  readonly chip: number;
  readonly title: number;
}

/** How much each kind of text grows in a view drawn at `zoom`. */
export const textGrowthAt = (zoom: number): TextGrowth => {
  const grow = ({ font, least }: { font: number; least: number }) =>
    Math.max(1, least / (font * zoom));

  return {
    tag: grow(textSizes.tag),
    label: grow(textSizes.label),
    chip: grow(textSizes.chip),
    title: grow(textSizes.title),
  };
};
