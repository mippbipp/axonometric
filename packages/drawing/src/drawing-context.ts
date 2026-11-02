import { palette } from "@axonometric/contracts";
import { Record as Rec, String as Str } from "effect";
import { createContext, use } from "react";
import type { ComponentType } from "react";

import type { StructureFrameProps } from "./structure-drawing.ts";

/**
 * The colours a drawing paints with, by the names of `palette`. On the page
 * each is a CSS variable, such as `var(--paper)`, which the stylesheet
 * resolves for the light or dark theme. In a file each is the palette's own
 * hex value.
 */
export type Paint = Readonly<Record<keyof typeof palette.light, string>>;

/** `faceOff` is `--face-off`, as `index.css` writes it. */
const variableOf = (name: string) =>
  `var(--${name.replaceAll(/[A-Z]/gu, (letter) => `-${Str.toLowerCase(letter)}`)})`;

/** The page's paint: one CSS variable for each colour in the palette. */
export const pagePaint: Paint = Rec.map(palette.light, (_value, name) =>
  variableOf(name)
);

/** What a drawing needs to know about where it is drawn. */
export interface DrawingEnvironment {
  readonly paint: Paint;
  /**
   * Whether the drawing is on the live page, where a status that hides
   * hatching still keeps the hatching, hidden, and where parts that aren't
   * targets ignore the pointer. A file leaves both out.
   */
  readonly live: boolean;
  /** The group one structure's parts are drawn in. */
  readonly Frame: ComponentType<StructureFrameProps>;
  /**
   * What starts the `id` of a part of a file, such as `chapter-3-`, or
   * `undefined` on the page, where parts have no ids.
   */
  readonly idPrefix: string | undefined;
}

/** The `id` of a map part, or `undefined` where the drawing has no ids. */
export const partId = (
  { idPrefix }: DrawingEnvironment,
  kind: "structure" | "hop" | "zone",
  id: string
) => (idPrefix === undefined ? undefined : `${idPrefix}${kind}-${id}`);

export const DrawingContext = createContext<DrawingEnvironment | null>(null);

/**
 * Where this drawing is drawn. The page installs its own at the root; a file
 * installs one per render. Drawing outside either is a mistake.
 */
export const useDrawing = (): DrawingEnvironment => {
  const value = use(DrawingContext);

  if (value === null) {
    throw new Error("A drawing needs a DrawingContext above it.");
  }

  return value;
};
