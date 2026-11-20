import type { SceneZone, View } from "@axonometric/contracts";
import type { ComponentType } from "react";

import { PlanStructure } from "./plan-shapes.tsx";
import { IsoStructure } from "./shapes.tsx";
import type { StructureDrawingProps } from "./structure-drawing.ts";
import { IsoPlate, PlanPlate } from "./zones.tsx";

/** Everything the drawing does differently in each view. */
export interface ViewDrawing {
  /** Whether bends get the diamond markers system-atlas draws. */
  readonly markBends: boolean;
  /**
   * Whether a newly revealed structure gets a pulsing ring on the ground,
   * which only the live page draws. Plan view tints the box instead, which
   * shows in a still image, so a file has it too.
   */
  readonly newRing: boolean;
  readonly Plate: ComponentType<{ readonly drawing: SceneZone }>;
  readonly Structure: ComponentType<StructureDrawingProps>;
  /** What the view is called, as `GLOSSARY.md` names it. */
  readonly title: string;
}

export const viewDrawings: Readonly<Record<View, ViewDrawing>> = {
  iso: {
    markBends: true,
    newRing: true,
    Plate: IsoPlate,
    Structure: IsoStructure,
    title: "Iso view",
  },
  plan: {
    Plate: PlanPlate,
    Structure: PlanStructure,
    title: "Plan view",
    // From above a bend is plain to see, and a dot there reads as a
    // junction.
    markBends: false,
    newRing: false,
  },
};
