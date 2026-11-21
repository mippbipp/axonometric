import type {
  GridPoint,
  Placement,
  StructureMove,
} from "@axonometric/contracts";
import type { GroundBox } from "@axonometric/ui/components/ground-drag";
import { Array as Arr } from "effect";

/** The grid drops land on, and how far an arrow moves, in grid units. */
export const step = 0.5;

/**
 * How far Shift with the arrows moves: four steps. Ten, ui-sdk's default,
 * would jump past most neighbours on these maps.
 */
export const largeStep = 2;

/** The footprint `GroundDrag` moves for a placement. */
export const boxOf = ({ d, w, x, y }: Placement): GroundBox => ({
  height: d,
  width: w,
  x,
  y,
});

/** The moves that put each structure in `to` there. */
export const movesTo = (
  to: Readonly<Record<string, GridPoint>>
): ReadonlyArray<StructureMove> =>
  Arr.map(Object.entries(to), ([id, position]) => ({
    position,
    target: { id, kind: "structure" as const },
  }));
