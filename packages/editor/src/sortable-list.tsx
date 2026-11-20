import {
  SortableList as UiSortableList,
  SortableListHandle,
  SortableListItem,
} from "@axonometric/ui/components/sortable-list";
import { Array as Arr } from "effect";

/** One row of a sortable list: an id, and what its row shows. */
export interface SortableRow {
  readonly id: string;
  /** What the row is called, for its text and its grip's name. */
  readonly name: string;
  /**
   * A note after the name, such as "proposed for deletion". It is drawn muted,
   * the row gets the refused dashed border, and the note joins the name in the
   * row's grip and announcements, so it is heard as well as seen.
   */
  readonly note?: string | undefined;
  /** Text before the name, such as its place in the list. */
  readonly prefix?: string;
}

/** A row's name as a screen reader says it, with its note. */
const spoken = ({ name, note }: SortableRow) =>
  note === undefined ? name : `${name}, ${note}`;

/**
 * A list whose rows are reordered by their grips. Dragging a grip moves its
 * row to where it is dropped. From the keyboard, Space or Enter on a grip
 * picks the row up, the arrow keys, Home and End move it, and Space or Enter
 * drops it. Escape puts it back, and Tab puts it back and moves on. Each
 * drop is one `onMove` with the new order of ids. A list of one row has
 * nothing to move.
 */
export function SortableList({
  dataList,
  disabled,
  label,
  onMove,
  rows,
}: {
  /** Names the list for tests and for styling. */
  readonly dataList: string;
  /** Whether reordering is off, such as while the server is down. */
  readonly disabled: boolean;
  readonly label: string;
  /** Called once per drop, with the ids in their new order. */
  readonly onMove: (order: ReadonlyArray<string>) => void;
  readonly rows: ReadonlyArray<SortableRow>;
}) {
  const byId = new Map(Arr.map(rows, (row) => [row.id, row] as const));
  const ids = Arr.map(rows, ({ id }) => id);

  return (
    <UiSortableList
      aria-label={label}
      className="gap-1"
      data-sortable={dataList}
      disabled={disabled}
      label={(id) => {
        const row = byId.get(id);

        return row === undefined ? undefined : spoken(row);
      }}
      onValueChange={(order) => {
        onMove(order);
      }}
      value={ids}
    >
      {({ order }) =>
        Arr.flatMap(order, (id) => {
          const row = byId.get(id);

          return row === undefined ? [] : [row];
        }).map((row) => (
          <SortableListItem
            className="border-ink/40 data-[grabbed]:border-ink data-[sort-marked=true]:border-refused data-[grabbed]:outline-ink flex items-center gap-1.5 border px-1.5 py-1 text-sm data-[dragging]:opacity-80 data-[grabbed]:outline-2 data-[sort-marked=true]:border-dashed"
            data-sort-marked={row.note !== undefined}
            data-sort-row={row.id}
            key={row.id}
            value={row.id}
          >
            <SortableListHandle
              aria-label={`Reorder ${spoken(row)}. Press Space to pick up, arrow keys to move, Space to drop.`}
              className="px-1"
              data-sort-grip={row.id}
              value={row.id}
            >
              ⠿
            </SortableListHandle>
            <span
              className="min-w-0 flex-1 break-words"
              data-sort-content={row.id}
            >
              {row.prefix === undefined ? null : (
                <span className="opacity-60">{row.prefix}</span>
              )}
              {row.name}
              {row.note === undefined ? null : (
                <span className="opacity-60" data-sort-note={row.id}>
                  {` · ${row.note}`}
                </span>
              )}
            </span>
          </SortableListItem>
        ))
      }
    </UiSortableList>
  );
}
