import type { SceneStructure } from "@axonometric/contracts";

/** What a view's drawing of one structure takes. */
export interface StructureDrawingProps {
  /** The structure as the scene lays it out for the view. */
  readonly placed: SceneStructure;
  /** The id of the hatch pattern the drawing fills faces with. */
  readonly hatch: string;
  /** Whether the chapter reveals the structure, so it's drawn as new. */
  readonly isNew: boolean;
}
