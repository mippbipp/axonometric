import { nudgeMoves } from "@axonometric/contracts";
import type { GridPoint } from "@axonometric/contracts";
import { Option, Record as Rec } from "effect";
import { useEffect, useEffectEvent } from "react";

import { isTyping } from "./chapter-keys.ts";
import { useEditing } from "./editing-context.ts";
import { useSelection } from "./selection-context.ts";

/** How far an arrow key nudges the multi-selection, in grid units. */
export const nudgeStep = 0.5;

/**
 * Which way each arrow key nudges, along the ground axes. Plan view draws x
 * to the right and y down, so the keys point where the structures go. In
 * the Iso view the axes run diagonally, so → and ← move along x, down to
 * the right and up to the left, and ↓ and ↑ move along y, down to the left
 * and up to the right.
 */
const nudges = {
  ArrowRight: { x: nudgeStep, y: 0 },
  ArrowLeft: { x: -nudgeStep, y: 0 },
  ArrowDown: { x: 0, y: nudgeStep },
  ArrowUp: { x: 0, y: -nudgeStep },
} as const satisfies Readonly<Record<string, GridPoint>>;

const stepOf = (key: string): GridPoint | undefined =>
  Rec.get(Rec.fromEntries(Rec.toEntries(nudges)), key).pipe(
    Option.getOrUndefined
  );

/** What the arrow keys do now. */
export type ArrowOwner = "nudge" | "selection" | "chapter";

/**
 * The one place that decides what the arrow keys do:
 *
 * - `nudge` moves the multi-selection, while the page can edit and some
 *   structures are picked.
 * - `selection` takes → inside the pinned structure and ← out of it.
 * - `chapter` changes chapter, when nothing is picked.
 *
 * The chapter, selection and edit keys each act on the arrows only when
 * they are the owner.
 */
export const useArrowOwner = (): ArrowOwner => {
  const editing = useEditing();
  const { selected, multiSelection } = useSelection();

  if (editing?.canEdit === true && multiSelection.size > 0) {
    return "nudge";
  }

  return selected === null ? "chapter" : "selection";
};

const isUndo = (event: KeyboardEvent) =>
  (event.ctrlKey || event.metaKey) &&
  !event.shiftKey &&
  !event.altKey &&
  event.key.toLowerCase() === "z";

const isRedo = (event: KeyboardEvent) =>
  (event.ctrlKey || event.metaKey) &&
  !event.altKey &&
  ((event.shiftKey && event.key.toLowerCase() === "z") ||
    (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "y"));

/**
 * The keys that edit the layout while the page can edit:
 *
 * - While `owner` is `nudge`, the arrow keys nudge the multi-selection by
 *   half a unit. Each press is one change and one undo step. A held key's
 *   repeats are ignored, so holding an arrow doesn't write a change per
 *   repeat; drag to go far.
 * - Ctrl or Cmd+Z undoes, and Ctrl or Cmd+Shift+Z or Ctrl+Y redoes.
 *
 * Keys typed into a field are left alone, so a field keeps its own undo.
 */
export const useEditKeys = (owner: ArrowOwner) => {
  const editing = useEditing();
  const { multiSelection } = useSelection();

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      editing === null ||
      !editing.canEdit ||
      event.defaultPrevented ||
      isTyping(event.target)
    ) {
      return;
    }

    if (isUndo(event)) {
      event.preventDefault();
      editing.undo();

      return;
    }

    if (isRedo(event)) {
      event.preventDefault();
      editing.redo();

      return;
    }

    const step = stepOf(event.key);

    if (
      step === undefined ||
      owner !== "nudge" ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey
    ) {
      return;
    }

    event.preventDefault();

    if (!event.repeat) {
      editing.arrange((placements) =>
        nudgeMoves({ placements, ids: [...multiSelection], delta: step })
      );
    }
  });

  useEffect(() => {
    globalThis.addEventListener("keydown", onKeyDown);

    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, []);
};
