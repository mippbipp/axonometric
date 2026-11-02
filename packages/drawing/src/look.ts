import type { Status } from "@axonometric/contracts";
import { dashes } from "@axonometric/contracts";
import { createContext, use } from "react";
import type { SVGProps } from "react";

import { useDrawing } from "./drawing-context.ts";
import type { Paint } from "./drawing-context.ts";

/**
 * How one structure's parts are painted for its status. Live is the plain
 * drawing. Planned is designed but not built: a dashed outline over paper,
 * with no hatching. Off is built but switched off: a faded fill and faint
 * hatching inside a full-strength outline, with a power mark on top.
 */
export interface Look {
  readonly paint: Paint;
  /** The fill of a face. */
  readonly face: string;
  /** The fill of a part drawn in solid ink, such as a gate's band or a code. */
  readonly solid: string;
  /** The outline's dash pattern, or `undefined` for a solid line. */
  readonly dash: string | undefined;
  /** Whether hatching is drawn. */
  readonly hatched: boolean;
  /** The opacity of hatching, or `undefined` for full strength. */
  readonly hatchOpacity: number | undefined;
}

/** How faint a switched-off structure's hatching is. */
const offHatchOpacity = 0.3;

export const lookOf = (status: Status, paint: Paint): Look => {
  switch (status) {
    case "planned":
      return {
        paint,
        face: paint.paper,
        solid: paint.ink,
        dash: dashes.planned,
        hatched: false,
        hatchOpacity: undefined,
      };
    case "off":
      return {
        paint,
        face: paint.faceOff,
        solid: paint.muted,
        dash: undefined,
        hatched: true,
        hatchOpacity: offHatchOpacity,
      };
    case "live":
      return {
        paint,
        face: paint.face,
        solid: paint.ink,
        dash: undefined,
        hatched: true,
        hatchOpacity: undefined,
      };
  }
};

/** The look of the structure being drawn, set by its drawing. */
export const LookContext = createContext<Look | null>(null);

/** The look of the structure being drawn: the live look outside one. */
export const useLook = (): Look => {
  const look = use(LookContext);
  const { paint } = useDrawing();

  return look ?? lookOf("live", paint);
};

/** The fill of a face of the structure being drawn. */
export const useFace = (): string => useLook().face;

/** What every part of a structure inherits from the group around it. */
export const frameAttributes = (look: Look): SVGProps<SVGGElement> => ({
  stroke: look.paint.ink,
  strokeWidth: 1.2,
  strokeLinejoin: "round",
  strokeDasharray: look.dash,
});

/** The attributes of one hatching part. */
export interface Hatching {
  readonly "data-hatch": "";
  readonly fill: string;
  readonly stroke: "none";
  readonly display: "none" | undefined;
  readonly opacity: number | undefined;
}

/**
 * The attributes of one hatching part, or `undefined` for a part to leave
 * out. A planned structure has no hatching: the page keeps the part with
 * `display="none"`, a file leaves it out.
 */
export const useHatching = (
  hatch: string | undefined
): Hatching | undefined => {
  const look = useLook();
  const { live } = useDrawing();

  return hatch !== undefined && (look.hatched || live)
    ? {
        "data-hatch": "",
        fill: `url(#${hatch})`,
        stroke: "none",
        display: look.hatched ? undefined : "none",
        opacity: look.hatchOpacity,
      }
    : undefined;
};
