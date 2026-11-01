import { structuresOf } from "@axonometric/contracts";
import type {
  ChangeId,
  Layout,
  LayoutChange,
  Placement,
  StructureMove,
} from "@axonometric/contracts";
import { Array as Arr } from "effect";
import { createContext, use } from "react";

import type { Arrangement } from "./served-store.ts";

/**
 * Editing the layout, for a page that `serve` serves. The read-only file
 * has no `EditingContext`, so it draws no handles and nothing drags.
 */
export interface Editing {
  /** The accepted layout, as `layout.json` holds it. */
  readonly accepted: Layout;
  /** The pending layout changes the page shows. */
  readonly pending: readonly LayoutChange[];
  /** Whether edits can be saved now. False while the server is down. */
  readonly canEdit: boolean;
  /**
   * Puts structure `id` at `next`, as pending changes. Returns why it was
   * refused, such as an overlap, or `undefined` when it went ahead.
   */
  readonly place: (id: string, next: Placement) => string | undefined;
  /** Why `place` would refuse `next`, without saving anything. */
  readonly refusalOf: (id: string, next: Placement) => string | undefined;
  /**
   * Removes the pending change with `id`, which restores the accepted value.
   * Returns why it was refused, such as a structure that would land on
   * another pending one, or `undefined` when it went ahead.
   */
  readonly discard: (id: ChangeId) => string | undefined;
  /** Why `applyMoves` would refuse `moves`, without saving anything. */
  readonly refusalOfMoves: (
    moves: readonly StructureMove[]
  ) => string | undefined;
  /**
   * Moves, nudges, aligns or distributes a set as one pending change and one
   * undo step. `plan` gets where the structures sit now and returns the
   * moves. A group drag passes the moves it already knows. Returns why it
   * was refused, or `undefined`.
   */
  readonly arrange: (plan: Arrangement) => string | undefined;
  /** Whether there is an edit to undo. */
  readonly canUndo: boolean;
  /** Whether there is an undone edit to redo. */
  readonly canRedo: boolean;
  /** Takes back the last edit, in the pending changes on disk too. */
  readonly undo: () => void;
  /** Redoes the edit that `undo` took back. */
  readonly redo: () => void;
}

export const EditingContext = createContext<Editing | null>(null);

/** The editing state, or `null` on a page that can't edit. */
export const useEditing = (): Editing | null => use(EditingContext);

/** The ids of the structures the pending changes act on. */
export const pendingStructures = (
  editing: Editing | null
): ReadonlySet<string> =>
  new Set(Arr.flatMap(editing?.pending ?? [], structuresOf));
