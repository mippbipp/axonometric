import type { LayoutChange, Placement } from "@axonometric/contracts";
import { Array as Arr } from "effect";

import { controlClass } from "./control-class.ts";
import { useEditing } from "./editing-context.ts";
import { useStructuresById } from "./structures.ts";

/** What a change does, such as `moved from 4, 0 to 6, 0.5`. */
const describe = (change: LayoutChange, accepted: Placement | undefined) => {
  if (change.kind === "move") {
    const to = `${change.position.x}, ${change.position.y}`;

    return accepted === undefined
      ? `moved to ${to}`
      : `moved from ${accepted.x}, ${accepted.y} to ${to}`;
  }

  const to = `${change.footprint.w} × ${change.footprint.d}`;

  return accepted === undefined
    ? `resized to ${to}`
    : `resized from ${accepted.w} × ${accepted.d} to ${to}`;
};

/**
 * The Pending tab: every pending layout change, with a button that
 * discards it, which puts the structure back where the accepted layout
 * has it. The buttons are hidden while the page can't edit.
 */
export function PendingTab() {
  const editing = useEditing();
  const byId = useStructuresById();

  if (editing === null) {
    return null;
  }

  const { pending, accepted, canEdit, discard } = editing;

  return (
    <section data-pending-list className="flex flex-col gap-3">
      <p className="text-xs opacity-70">
        Layout changes saved to proposals.json and not yet accepted. Discarding
        one puts the structure back where layout.json has it.
      </p>
      {pending.length === 0 ? (
        <p className="text-sm">
          Nothing is pending. Drag a structure to move it, or drag a corner of
          the selected one to resize it.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {Arr.map(pending, (change) => {
            const name =
              byId.get(change.structureId)?.name ?? change.structureId;

            return (
              <li
                key={`${change.kind}:${change.structureId}`}
                data-pending-change={change.kind}
                data-pending-structure={change.structureId}
                className="border-pending flex items-start gap-2 border-l-2 pl-2 text-sm"
              >
                <span className="min-w-0 flex-1">
                  <b className="font-medium">{name}</b>{" "}
                  {describe(change, accepted.structures[change.structureId])}
                </span>
                {canEdit ? (
                  <button
                    type="button"
                    className={controlClass}
                    aria-label={`Discard the ${change.kind} of ${name}`}
                    onClick={() => {
                      discard(change);
                    }}
                  >
                    Discard
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
