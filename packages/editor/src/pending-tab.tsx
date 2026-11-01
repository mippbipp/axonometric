import {
  layoutChangeKey,
  maxMessageLength,
  structuresOf,
} from "@axonometric/contracts";
import type { ChangeId, Layout, LayoutChange } from "@axonometric/contracts";
import { Array as Arr, Option, Record as Rec } from "effect";
import { useId, useState } from "react";

import { useAccepting } from "./accepting-context.ts";
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
 * The Pending tab: every pending layout change, with buttons that accept it
 * into layout.json and discard it, which puts the structure back where the
 * accepted layout has it. "Accept all" takes every change. The optional
 * message names the revision that an accept saves. The buttons are hidden
 * while the page can't edit.
 */
export function PendingTab() {
  const editing = useEditing();
  const accepting = useAccepting();
  const byId = useStructuresById();
  const [refusal, setRefusal] = useState<string | undefined>();
  const [message, setMessage] = useState("");
  const messageId = useId();

  if (editing === null) {
    return null;
  }

  const { pending, accepted, canEdit, discard } = editing;
  const nameOf = (id: string) => byId.get(id)?.name ?? id;

  const discardWith = (change: LayoutChange) => {
    setRefusal(discard(change.id));
  };

  const acceptWith = (ids: "all" | readonly [ChangeId]) => {
    setRefusal(undefined);
    accepting?.accept(ids, message);
    setMessage("");
  };

  const acceptable = canEdit && accepting?.canAccept === true;

  return (
    <section data-pending-list className="flex flex-col gap-3">
      <p className="text-xs opacity-70">
        Layout changes saved to proposals.json and not yet accepted. Accepting
        writes them to layout.json and saves a revision. Discarding one puts the
        structure back where layout.json has it.
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
        <>
          {acceptable ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={messageId} className="text-xs opacity-70">
                Revision message (optional)
              </label>
              <input
                id={messageId}
                data-accept-message
                type="text"
                value={message}
                maxLength={maxMessageLength}
                placeholder="Leave empty to write one from the changes"
                disabled={accepting.busy}
                className="border-ink bg-paper text-ink focus-visible:outline-ink border px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-1"
                onChange={(event) => {
                  setMessage(event.target.value);
                }}
              />
              <button
                type="button"
                data-accept-all
                className={`${controlClass} self-start`}
                disabled={accepting.busy}
                onClick={() => {
                  acceptWith("all");
                }}
              >
                Accept all
              </button>
            </div>
          ) : null}
          <ul className="flex flex-col gap-2">
            {Arr.map(pending, (change) => {
              const names = Arr.join(
                Arr.map(structuresOf(change), nameOf),
                ", "
              );

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
                  {acceptable ? (
                    <button
                      type="button"
                      data-accept-change={change.id}
                      className={controlClass}
                      aria-label={`Accept the ${change.kind} of ${names}`}
                      disabled={accepting.busy}
                      onClick={() => {
                        acceptWith([change.id]);
                      }}
                    >
                      Accept
                    </button>
                  ) : null}
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
        </>
      )}
    </section>
  );
}
