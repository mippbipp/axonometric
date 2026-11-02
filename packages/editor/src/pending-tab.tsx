import {
  hopLabelOf,
  hopsOf,
  layoutChangeKey,
  maxMessageLength,
  structuresOf,
} from "@axonometric/contracts";
import type { ChangeId, LayoutChange } from "@axonometric/contracts";
import { Array as Arr, Record as Rec } from "effect";
import { useId, useState } from "react";

import { useAccepting } from "./accepting-context.ts";
import { controlClass } from "./control-class.ts";
import { describeChange } from "./describe-change.ts";
import { useEditing } from "./editing-context.ts";
import { PendingConnections } from "./pending-connections.tsx";
import { PendingStructures } from "./pending-structures.tsx";
import { listedEntries, useReview } from "./review-context.ts";
import { ReviewList } from "./review-list.tsx";
import { useStructuresById } from "./structures.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/**
 * The Pending tab: every pending layout change, with buttons that accept it
 * into layout.json and discard it, which puts the structure back where the
 * accepted layout has it. "Accept all" takes every change. The optional
 * message names the revision that an accept saves. The buttons are hidden
 * while the page can't edit.
 */
export function PendingTab() {
  const editing = useEditing();
  const review = useReview();
  const accepting = useAccepting();
  const byId = useStructuresById();
  const { state } = useWalkthrough();
  const [refusal, setRefusal] = useState<string | undefined>();
  const [message, setMessage] = useState("");
  const messageId = useId();

  if (editing === null) {
    return null;
  }

  const { pending, accepted, canEdit, discard } = editing;
  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  const hopName = hopLabelOf(state.data.hops);

  const namesOf = (change: LayoutChange) =>
    Arr.join(
      [
        ...Arr.map(structuresOf(change), nameOf),
        ...Arr.map(hopsOf(change), hopName),
      ],
      ", "
    );

  const discardWith = (change: LayoutChange) => {
    setRefusal(discard(change.id));
  };

  const acceptWith = (ids: "all" | readonly [ChangeId]) => {
    setRefusal(undefined);
    accepting?.accept(ids, message);
    setMessage("");
  };

  const acceptable = canEdit && accepting?.canAccept === true;

  // Nothing is pending only when no layout change is, and no proposal is
  // either: the review list below shows the proposals.
  const nothingAtAll =
    pending.length === 0 && listedEntries(review?.entries ?? []).length === 0;

  // Hops whose shown route is a hand-drawn override, which Reset route clears.
  const overridden = Arr.filter(state.data.hops, ({ id }) =>
    Rec.has(state.layout.routes ?? {}, id)
  );

  return (
    <section data-pending-list className="flex flex-col gap-3">
      <p data-pending-intro className="text-xs opacity-70">
        Layout changes are yours to accept. Accepting one writes it to
        layout.json and saves a revision, and discarding one puts the structure
        or route back as layout.json has it. Proposals are for the agent: notes,
        text suggestions, answers and questions wait here until you press Ready
        for review, then until the agent gives a verdict.
      </p>
      {refusal === undefined ? null : (
        <p
          data-discard-refused
          className="border-refused border-l-2 pl-2 text-xs"
        >
          {refusal}
        </p>
      )}
      {nothingAtAll ? (
        <p data-pending-empty className="text-sm">
          Nothing is pending. Drag a structure to move it, drag a corner of the
          selected one to resize it, drag a segment of an arrow to reroute it,
          or drag a zone title to move its group. Pin a note, suggest new text
          or answer a question from a structure&rsquo;s panel.
        </p>
      ) : null}
      {pending.length === 0 ? null : (
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
              const names = namesOf(change);

              return (
                <li
                  key={layoutChangeKey(change)}
                  data-pending-change={change.kind}
                  data-pending-id={change.id}
                  data-pending-structure={structuresOf(change)[0]}
                  data-pending-hop={hopsOf(change)[0]}
                  className="border-pending flex items-start gap-2 border-l-2 pl-2 text-sm"
                >
                  <span className="min-w-0 flex-1">
                    {Arr.join(
                      describeChange(change, accepted, {
                        structure: nameOf,
                        hop: hopName,
                      }),
                      "; "
                    )}
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
      {canEdit && overridden.length > 0 ? (
        <section data-route-overrides className="flex flex-col gap-2">
          <h3 className="text-xs tracking-widest uppercase opacity-70">
            Routes set by hand
          </h3>
          <ul className="flex flex-col gap-2">
            {Arr.map(overridden, ({ id }) => (
              <li
                key={id}
                data-route-override={id}
                className="flex items-start gap-2 text-sm"
              >
                <span className="min-w-0 flex-1">{hopName(id)}</span>
                <button
                  type="button"
                  data-reset-route={id}
                  className={controlClass}
                  aria-label={`Reset the route ${hopName(id)}`}
                  onClick={() => {
                    setRefusal(editing.reroute(id, null));
                  }}
                >
                  Reset route
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <PendingStructures />
      <PendingConnections />
      <ReviewList />
    </section>
  );
}
