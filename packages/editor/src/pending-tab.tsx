import { layoutChangeKey, structuresOf } from "@axonometric/contracts";
import type { Layout, LayoutChange } from "@axonometric/contracts";
import { Array as Arr, Option, Record as Rec } from "effect";
import { useState } from "react";

import { controlClass } from "./control-class.ts";
import { useEditing } from "./editing-context.ts";
import { useStructuresById } from "./structures.ts";

const spot = ({ x, y }: { readonly x: number; readonly y: number }) =>
  `${x}, ${y}`;

/** Each structure a change acts on, named, and what happens to it. */
const describe = (
  change: LayoutChange,
  accepted: Layout,
  nameOf: (id: string) => string
) => {
  if (change.kind === "move") {
    return Arr.map(change.moves, ({ target, position }) => {
      const before = Rec.get(accepted.structures, target.id);

      const from = Option.match(before, {
        onNone: () => "",
        onSome: (placement) => ` from ${spot(placement)}`,
      });

      return `${nameOf(target.id)} moved${from} to ${spot(position)}`;
    });
  }

  const { w, d } = change.footprint;
  const before = Rec.get(accepted.structures, change.target.id);

  const from = Option.match(before, {
    onNone: () => "",
    onSome: (placement) => ` from ${placement.w} × ${placement.d}`,
  });

  return [`${nameOf(change.target.id)} resized${from} to ${w} × ${d}`];
};

/**
 * The Pending tab: every pending layout change, with a button that
 * discards it, which puts the structure back where the accepted layout
 * has it. The buttons are hidden while the page can't edit.
 */
export function PendingTab() {
  const editing = useEditing();
  const byId = useStructuresById();
  const [refusal, setRefusal] = useState<string | undefined>();

  if (editing === null) {
    return null;
  }

  const { pending, accepted, canEdit, discard } = editing;
  const nameOf = (id: string) => byId.get(id)?.name ?? id;

  const discardWith = (change: LayoutChange) => {
    setRefusal(discard(change.id));
  };

  return (
    <section data-pending-list className="flex flex-col gap-3">
      <p className="text-xs opacity-70">
        Layout changes saved to proposals.json and not yet accepted. Discarding
        one puts the structure back where layout.json has it.
      </p>
      {refusal === undefined ? null : (
        <p
          data-discard-refused
          className="border-refused border-l-2 pl-2 text-xs"
        >
          {refusal}
        </p>
      )}
      {pending.length === 0 ? (
        <p className="text-sm">
          Nothing is pending. Drag a structure to move it, or drag a corner of
          the selected one to resize it.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {Arr.map(pending, (change) => {
            const names = Arr.join(Arr.map(structuresOf(change), nameOf), ", ");

            return (
              <li
                key={layoutChangeKey(change)}
                data-pending-change={change.kind}
                data-pending-id={change.id}
                data-pending-structure={structuresOf(change)[0]}
                className="border-pending flex items-start gap-2 border-l-2 pl-2 text-sm"
              >
                <span className="min-w-0 flex-1">
                  {Arr.join(describe(change, accepted, nameOf), "; ")}
                </span>
                {canEdit ? (
                  <button
                    type="button"
                    className={controlClass}
                    aria-label={`Discard the ${change.kind} of ${names}`}
                    onClick={() => {
                      discardWith(change);
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
