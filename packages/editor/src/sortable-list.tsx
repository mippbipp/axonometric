import { moveItem } from "@axonometric/contracts";
import { Array as Arr, Option } from "effect";
import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

import { controlClass } from "./control-class.ts";

/** How far a press must move before it drags a row, in pixels. */
const dragThreshold = 4;

/** One row of a sortable list: an id, and what its row shows. */
export interface SortableRow {
  readonly id: string;
  /** What the row is called, for its text and its buttons' names. */
  readonly name: string;
  /** Text before the name, such as its place in the list. */
  readonly prefix?: string;
  /**
   * A note after the name, such as "proposed for deletion". It is drawn muted,
   * the row gets the refused dashed border, and the note joins the name in the
   * row's buttons, so it is heard as well as seen.
   */
  readonly note?: string | undefined;
}

/** A row's name as a screen reader says it, with its note. */
const spoken = ({ name, note }: SortableRow) =>
  note === undefined ? name : `${name}, ${note}`;

/**
 * A list whose rows are reordered two ways. Dragging a row by its grip moves
 * it to where it is dropped, and every row has "Move up" and "Move down"
 * buttons, which are the keyboard way: Alt+↑ and Alt+↓ on a focused grip do
 * the same. `onMove` gets the new order of ids. A list of one row has nothing
 * to move.
 */
export function SortableList({
  label,
  rows,
  disabled,
  onMove,
  dataList,
}: {
  readonly label: string;
  readonly rows: readonly SortableRow[];
  /** Whether reordering is off, such as while the server is down. */
  readonly disabled: boolean;
  /** Called with the ids in their new order. */
  readonly onMove: (order: readonly string[]) => void;
  /** Names the list for tests and for styling. */
  readonly dataList: string;
}) {
  const list = useRef<HTMLOListElement>(null);

  const press = useRef<
    { index: number; pointer: number; y: number } | undefined
  >(undefined);

  const [dragging, setDragging] = useState<
    { readonly from: number; readonly over: number } | undefined
  >();

  const ids = Arr.map(rows, ({ id }) => id);

  const moveTo = (from: number, to: number) => {
    const next = moveItem(ids, from, to);

    if (next !== ids) {
      onMove(next);
    }
  };

  const rowIndexAt = (clientY: number): number => {
    const items =
      list.current?.querySelectorAll<HTMLElement>("[data-sort-row]");

    const rects = Arr.map([...(items ?? [])], (item) =>
      item.getBoundingClientRect()
    );

    const at = Arr.findFirstIndex(
      rects,
      (rect) => clientY < rect.top + rect.height / 2
    );

    return Option.getOrElse(at, () => Math.max(rects.length - 1, 0));
  };

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    if (
      !event.altKey ||
      (event.key !== "ArrowUp" && event.key !== "ArrowDown")
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    moveTo(index, index + (event.key === "ArrowUp" ? -1 : 1));
  };

  const onDown = (event: PointerEvent<HTMLElement>, index: number) => {
    if (disabled || event.button !== 0) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    press.current = { index, pointer: event.pointerId, y: event.clientY };
  };

  const onMoveEvent = (event: PointerEvent<HTMLElement>) => {
    const { current } = press;

    if (current === undefined || event.pointerId !== current.pointer) {
      return;
    }

    if (
      dragging === undefined &&
      Math.abs(event.clientY - current.y) < dragThreshold
    ) {
      return;
    }

    setDragging({ from: current.index, over: rowIndexAt(event.clientY) });
  };

  const end = (event: PointerEvent<HTMLElement>, drop: boolean) => {
    const { current } = press;

    if (current === undefined || event.pointerId !== current.pointer) {
      return;
    }

    press.current = undefined;

    if (drop && dragging !== undefined) {
      moveTo(dragging.from, dragging.over);
    }

    setDragging(undefined);
  };

  return (
    <ol
      ref={list}
      aria-label={label}
      data-sortable={dataList}
      className="flex flex-col gap-1"
    >
      {Arr.map(rows, (row, index) => (
        <li
          key={row.id}
          data-sort-row={row.id}
          data-sort-over={dragging?.over === index && dragging.from !== index}
          data-sort-dragging={dragging?.from === index}
          data-sort-marked={row.note !== undefined}
          className="border-ink/40 data-[sort-over=true]:border-pending data-[sort-marked=true]:border-refused flex items-center gap-1.5 border px-1.5 py-1 text-sm data-[sort-dragging=true]:opacity-50 data-[sort-marked=true]:border-dashed"
        >
          <button
            type="button"
            data-sort-grip={row.id}
            aria-label={`Drag ${spoken(row)} to reorder. Alt plus arrow keys also move it.`}
            disabled={disabled}
            className="focus-visible:outline-ink cursor-grab touch-none px-1 select-none focus-visible:outline-2 disabled:cursor-default disabled:opacity-40"
            onPointerDown={(event) => {
              onDown(event, index);
            }}
            onPointerMove={onMoveEvent}
            onPointerUp={(event) => {
              end(event, true);
            }}
            onPointerCancel={(event) => {
              end(event, false);
            }}
            onLostPointerCapture={(event) => {
              end(event, false);
            }}
            onKeyDown={(event) => {
              onKeyDown(event, index);
            }}
          >
            ⠿
          </button>
          <span
            data-sort-content={row.id}
            className="min-w-0 flex-1 break-words"
          >
            {row.prefix === undefined ? null : (
              <span className="opacity-60">{row.prefix}</span>
            )}
            {row.name}
            {row.note === undefined ? null : (
              <span data-sort-note={row.id} className="opacity-60">
                {` · ${row.note}`}
              </span>
            )}
          </span>
          <button
            type="button"
            data-sort-up={row.id}
            aria-label={`Move ${spoken(row)} up`}
            disabled={disabled || index === 0}
            className={controlClass}
            onClick={() => {
              moveTo(index, index - 1);
            }}
          >
            ↑
          </button>
          <button
            type="button"
            data-sort-down={row.id}
            aria-label={`Move ${spoken(row)} down`}
            disabled={disabled || index === rows.length - 1}
            className={controlClass}
            onClick={() => {
              moveTo(index, index + 1);
            }}
          >
            ↓
          </button>
        </li>
      ))}
    </ol>
  );
}
