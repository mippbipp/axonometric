import { dual } from "effect/Function";

import { codeChipsFrom, hopLabelsFrom, tagGrowthAt } from "./readable-text.ts";

/**
 * Publishes what the text needs from the zoom on `svg`: how much tags grow,
 * and whether hop labels and code chips are too small to show.
 */
export const showTextAt: {
  (scale: number): (svg: SVGSVGElement) => void;
  (svg: SVGSVGElement, scale: number): void;
} = dual(2, (svg: SVGSVGElement, scale: number): void => {
  svg.style.setProperty("--tag-grow", String(tagGrowthAt(scale)));
  svg.toggleAttribute("data-hide-hop-labels", scale < hopLabelsFrom);
  svg.toggleAttribute("data-hide-code-chips", scale < codeChipsFrom);
});
