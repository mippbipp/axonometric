import { nudgeMoves } from "@axonometric/contracts";
import type {
  GridPoint,
  Placement,
  StructureMove,
} from "@axonometric/contracts";
import type {
  GroundBox,
  GroundInput,
  GroundPress,
} from "@axonometric/ui/components/ground-drag";
import { Array as Arr } from "effect";

import type { Editing } from "./editing-context.ts";

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

/** A Shift-press picks structures or draws a selection box, so it moves nothing. */
export const picks = (press: GroundPress) =>
  press.input === "pointer" && press.event.shiftKey;

/**
 * Saves a drop or a nudge that `GroundDrag` reports, as one change and one
 * undo step. A nudge is planned on the latest list, so quick presses add up.
 * `dropOne` saves a pointer drop of a single structure, where that is more
 * than a move. A refusal shows as a notice. Returns whether it was saved.
 */
export const saveMove = ({
  dropOne,
  editing,
  input,
  placements,
  to,
}: {
  readonly dropOne?: (id: string, next: Placement) => string | undefined;
  readonly editing: Editing | null;
  readonly input: GroundInput;
  /** Where each structure is shown now. */
  readonly placements: Readonly<Partial<Record<string, Placement>>>;
  readonly to: Readonly<Record<string, GridPoint>>;
}) => {
  const ids = Object.keys(to);
  const [id] = ids;
  const start = id === undefined ? undefined : placements[id];
  const at = id === undefined ? undefined : to[id];

  if (
    editing === null ||
    id === undefined ||
    start === undefined ||
    at === undefined
  ) {
    return false;
  }

  if (input === "keyboard") {
    const delta = { x: at.x - start.x, y: at.y - start.y };

    return (
      editing.arrange((latest) =>
        nudgeMoves({ delta, ids, placements: latest })
      ) === undefined
    );
  }

  return (
    (ids.length === 1 && dropOne !== undefined
      ? dropOne(id, { ...start, ...at })
      : editing.arrange(() => movesTo(to))) === undefined
  );
};
