import { hopsOf, structuresOf } from "@axonometric/contracts";
import type {
  Arrangement,
  ChangeId,
  GridPoint,
  Layout,
  LayoutChange,
  Placement,
  StructureMove,
} from "@axonometric/contracts";
import { Array as Arr } from "effect";
import { createContext, use } from "react";

import { useWhileEditOn } from "./edit-context.ts";

/**
 * Editing the layout, for a page that `serve` serves. The read-only file
 * has no `EditingContext`, so it draws no handles and nothing drags. With
 * Edit off, `useEditing` gives none either.
 */
export interface Editing {
  /** The accepted layout, as `layout.json` holds it. */
  readonly accepted: Layout;
  /**
   * Moves, nudges, aligns or distributes a set as one pending change and one
   * undo step. `plan` gets where the structures sit now and returns the
   * moves. A group drag passes the moves it already knows. Returns why it
   * was refused, or `undefined`.
   */
  readonly arrange: (plan: Arrangement) => string | undefined;
  /** Whether edits can be saved now. False while the server is down. */
  readonly canEdit: boolean;
  /** Whether there is an undone edit to redo. */
  readonly canRedo: boolean;
  /** Whether there is an edit to undo. */
  readonly canUndo: boolean;
  /**
   * Removes the pending changes with `ids`, which restores the accepted
   * values, as one write and one undo step. Returns why it was refused, such
   * as a structure that would land on another pending one, or `undefined`
   * when it went ahead.
   */
  readonly discard: (
    ids: Arr.NonEmptyReadonlyArray<ChangeId>
  ) => string | undefined;
  /**
   * The layout changes frozen in batches that wait for the agent. They stay
   * drawn as pending, and can't be edited or discarded.
   */
  readonly frozen: ReadonlyArray<LayoutChange>;
  /** The pending layout changes the page shows. */
  readonly pending: ReadonlyArray<LayoutChange>;
  /**
   * Puts structure `id` at `next`, as pending changes. A refusal also shows
   * as a notice. Returns why it was refused, such as an overlap, or
   * `undefined` when it went ahead.
   */
  readonly place: (id: string, next: Placement) => string | undefined;
  /** Redoes the edit that `undo` took back. */
  readonly redo: () => void;
  /** Why `place` would refuse `next`, without saving anything. */
  readonly refusalOf: (id: string, next: Placement) => string | undefined;
  /** Why `applyMoves` would refuse `moves`, without saving anything. */
  readonly refusalOfMoves: (
    moves: ReadonlyArray<StructureMove>
  ) => string | undefined;
  /** Why `reroute` would refuse `points` for `hop`, without saving anything. */
  readonly refusalOfReroute: (
    hop: string,
    points: ReadonlyArray<GridPoint> | null
  ) => string | undefined;
  /**
   * Gives hop `hop` the route override `points` as a pending change, or puts
   * it back on automatic routing with `null`. Returns why it was refused, or
   * `undefined`.
   */
  readonly reroute: (
    hop: string,
    points: ReadonlyArray<GridPoint> | null
  ) => string | undefined;
  /** Takes back the last edit, in the pending changes on disk too. */
  readonly undo: () => void;
}

export const EditingContext = createContext<Editing | null>(null);

/**
 * The editing state, or `null` on a page that can't edit or while Edit is
 * off. Controls and handlers read this one.
 */
export const useEditing = (): Editing | null =>
  useWhileEditOn(use(EditingContext));

/**
 * The editing state whether or not Edit is on, for what the page shows of
 * pending changes: their look, their list and their count. It gives no
 * reason to draw a control.
 */
export const useEditingIgnoringEdit = (): Editing | null => use(EditingContext);

/** The ids of the structures the pending and frozen layout changes act on. */
export const pendingStructures = (
  editing: Editing | null
): ReadonlySet<string> =>
  new Set(
    Arr.flatMap(
      [...(editing?.frozen ?? []), ...(editing?.pending ?? [])],
      structuresOf
    )
  );

/** The ids of the hops the pending changes reroute. */
export const pendingHops = (editing: Editing | null): ReadonlySet<string> =>
  new Set(
    Arr.flatMap(
      [...(editing?.frozen ?? []), ...(editing?.pending ?? [])],
      hopsOf
    )
  );

const agentChanges = (editing: Editing | null) =>
  Arr.filter(
    [...(editing?.frozen ?? []), ...(editing?.pending ?? [])],
    (change) => change.by === "agent"
  );

/** The ids of the structures the agent's pending changes act on. */
export const agentStructures = (editing: Editing | null): ReadonlySet<string> =>
  new Set(Arr.flatMap(agentChanges(editing), structuresOf));

/** The ids of the hops the agent's pending changes reroute. */
export const agentHops = (editing: Editing | null): ReadonlySet<string> =>
  new Set(Arr.flatMap(agentChanges(editing), hopsOf));

/** What the agent has proposed to the layout: how many changes, and why. */
export interface AgentProposal {
  readonly count: number;
  /** Each reason the agent gave, once, in the order the changes list them. */
  readonly reasons: ReadonlyArray<string>;
}

/** The agent's pending layout changes, or `undefined` when it has none. */
export const agentProposalOf = (
  editing: Editing | null
): AgentProposal | undefined => {
  const changes = agentChanges(editing);

  return Arr.isArrayNonEmpty(changes)
    ? {
        count: changes.length,
        reasons: Arr.dedupe(
          Arr.flatMap(changes, (change) =>
            change.by === "agent" && change.reason !== undefined
              ? [change.reason]
              : []
          )
        ),
      }
    : undefined;
};
