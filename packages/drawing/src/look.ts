import type { Status } from "@axonometric/contracts";
import { dashes, fadedOpacity } from "@axonometric/contracts";
import { createContext, use } from "react";
import type { SVGProps } from "react";

import { useDrawing } from "./drawing-context.ts";
import type { Paint } from "./drawing-context.ts";
import { fadeAttributes } from "./fading.ts";
import type { FadeAttributes } from "./fading.ts";

/**
 * How one structure's parts are painted for its status. Live is the plain
 * drawing. Planned is designed but not built: a dashed outline over paper,
 * with no hatching. Off is built but switched off: a faded fill and faint
 * hatching inside a full-strength outline, with a power mark on top.
 */
export interface Look {
  /** The outline's dash pattern, or `undefined` for a solid line. */
  readonly dash: string | undefined;
  /** The fill of a face. */
  readonly face: string;
  /** Whether hatching is drawn. */
  readonly hatched: boolean;
  /** The opacity of hatching, or `undefined` for full strength. */
  readonly hatchOpacity: number | undefined;
  readonly paint: Paint;
  /** The fill of a part drawn in solid ink, such as a gate's band or a code. */
  readonly solid: string;
}

/** How faint a switched-off structure's hatching is. */
const offHatchOpacity = 0.3;

/** The look of each status in `paint`. */
export const looksOf = (paint: Paint): Readonly<Record<Status, Look>> => ({
  live: {
    dash: undefined,
    face: paint.face,
    hatched: true,
    hatchOpacity: undefined,
    paint,
    solid: paint.ink,
  },
  off: {
    dash: undefined,
    face: paint.faceOff,
    hatched: true,
    hatchOpacity: offHatchOpacity,
    paint,
    solid: paint.muted,
  },
  planned: {
    dash: dashes.planned,
    face: paint.paper,
    hatched: false,
    hatchOpacity: undefined,
    paint,
    solid: paint.ink,
  },
});

/** The look of the structure being drawn, set by its drawing. */
export const LookContext = createContext<Look | null>(null);

/** The look of the structure being drawn: the live look outside one. */
export const useLook = (): Look => {
  const look = use(LookContext);
  const { paint } = useDrawing();

  return look ?? looksOf(paint).live;
};

/** The fill of a face of the structure being drawn. */
export const useFace = (): string => useLook().face;

/**
 * What every part of a structure inherits from the group around it,
 * including the fading of a structure outside the spotlight.
 */
export const frameAttributes = ({
  faded,
  look,
}: {
  readonly faded?: boolean | undefined;
  readonly look: Look;
}): SVGProps<SVGGElement> & Pick<FadeAttributes, "data-faded"> => ({
  ...fadeAttributes({ faded, strength: fadedOpacity.structure }),
  stroke: look.paint.ink,
  strokeDasharray: look.dash,
  strokeLinejoin: "round",
  strokeWidth: 1.2,
});

/** The attributes of one hatching part. */
export interface Hatching {
  readonly "data-hatch": "";
  readonly display: "none" | undefined;
  readonly fill: string;
  readonly opacity: number | undefined;
  readonly stroke: "none";
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
        display: look.hatched ? undefined : "none",
        fill: `url(#${hatch})`,
        opacity: look.hatchOpacity,
        stroke: "none",
      }
    : undefined;
};
