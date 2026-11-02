import type { SceneStructure, Shape, Status } from "@axonometric/contracts";
import type { ReactNode } from "react";

import type { Look } from "./look.ts";

/**
 * The group a structure's parts are drawn in. The page's frame makes it a
 * button with handlers; a file's frame gives it an id and its full name as
 * a title.
 */
export interface StructureFrameProps {
  readonly id: string;
  /** The structure's full name. */
  readonly name: string;
  readonly shape: Shape;
  readonly status: Status;
  /** Whether the chapter reveals the structure, so it's drawn as new. */
  readonly isNew: boolean;
  /**
   * Whether the spotlight fades the structure, or `undefined` when there is
   * no spotlight.
   */
  readonly faded: boolean | undefined;
  /** The paint the frame gives every part by inheritance. */
  readonly look: Look;
  readonly children: ReactNode;
}

/** What a view's drawing of one structure takes. */
export interface StructureDrawingProps {
  /** The structure as the scene lays it out for the view. */
  readonly placed: SceneStructure;
  /** The id of the hatch pattern the drawing fills faces with. */
  readonly hatch: string;
  /** Whether the chapter reveals the structure, so it's drawn as new. */
  readonly isNew: boolean;
  /** As `StructureFrameProps.faded`. */
  readonly faded: boolean | undefined;
}
