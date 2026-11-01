import { isoHeights, tagDrop } from "@axonometric/contracts";
import type {
  SceneStructure,
  SceneZone,
  ScreenPoint,
  View,
} from "@axonometric/contracts";
import type { ComponentType } from "react";

import { PlanStructure } from "./plan-shapes.tsx";
import { corners } from "./projection.ts";
import { IsoStructure } from "./shapes.tsx";
import type { StructureDrawingProps } from "./structure-drawing.ts";
import { IsoPlate, PlanPlate } from "./zones.tsx";

/** Everything the editor draws differently in each view. */
export interface ViewDrawing {
  /** What the view is called, as `GLOSSARY.md` names it. */
  readonly title: string;
  readonly Structure: ComponentType<StructureDrawingProps>;
  readonly Plate: ComponentType<{ readonly drawing: SceneZone }>;
  /** Whether bends get the diamond markers system-atlas draws. */
  readonly markBends: boolean;
  /**
   * Whether a newly revealed structure gets a pulsing ring on the ground.
   * Plan view tints the box instead, which shows in a still image.
   */
  readonly newRing: boolean;
  /** The screen points a structure's drawing reaches, tag included. */
  readonly extentOf: (placed: SceneStructure) => readonly ScreenPoint[];
}

export const viewDrawings: Readonly<Record<View, ViewDrawing>> = {
  iso: {
    title: "Iso view",
    Structure: IsoStructure,
    Plate: IsoPlate,
    markBends: true,
    newRing: true,
    extentOf: ({ structure, placement, tag }) => {
      const ground = corners(placement, 0);
      const top = corners(placement, isoHeights[structure.shape]);

      return [
        top.back,
        top.left,
        top.right,
        ground.left,
        ground.right,
        { sx: tag.left, sy: ground.front.sy + tagDrop },
        { sx: tag.right, sy: ground.front.sy + tagDrop },
      ];
    },
  },
  plan: {
    title: "Plan view",
    Structure: PlanStructure,
    Plate: PlanPlate,
    // From above a bend is plain to see, and a dot there reads as a
    // junction.
    markBends: false,
    newRing: false,
    extentOf: ({ outline, tag }) => [
      ...outline,
      { sx: tag.left, sy: tag.top },
      { sx: tag.right, sy: tag.bottom },
    ],
  },
};
