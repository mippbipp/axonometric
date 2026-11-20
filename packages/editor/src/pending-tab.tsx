import {
  hopLabelOf,
  hopsOf,
  layoutChangeKey,
  maxMessageLength,
  structuresOf,
} from "@axonometric/contracts";
import type { ChangeId, LayoutChange } from "@axonometric/contracts";
import { Input } from "@axonometric/ui/components/input";
import { Array as Arr, Record as Rec } from "effect";
import { useState } from "react";

import { useAccepting } from "./accepting-context.ts";
import { controlClass } from "./control-class.ts";
import { describeChange } from "./describe-change.ts";
import { useEditOn } from "./edit-context.ts";
import { useEditingIgnoringEdit } from "./editing-context.ts";
import { LabelledField } from "./labelled-field.tsx";
import { listedEntries, useReview } from "./review-context.ts";
import { ReviewList } from "./review-list.tsx";
import { useStructuresById } from "./structures.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/**
 * The Pending tab: every pending layout change, with buttons that accept it
 * into layout.json and discard it, which puts the structure back where the
 * accepted layout has it. "Accept all" takes every change. The optional
 * message names the revision that an accept saves. The buttons are hidden
 * while the page can't edit, and while Edit is off.
 */
export function PendingTab() {
  const editing = useEditingIgnoringEdit();
  const editOn = useEditOn();
  const review = useReview();
  const accepting = useAccepting();
  const byId = useStructuresById();
  const { state } = useWalkthrough();
  const [refusal, setRefusal] = useState<string | undefined>();
  const [message, setMessage] = useState("");

  if (editing === null) {
    return null;
  }

  const { accepted, discard, pending } = editing;
  const canEdit = editing.canEdit && editOn;
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
    <section className="flex flex-col gap-3" data-pending-list>
      <p className="text-xs opacity-70" data-pending-intro>
        Layout changes are yours to accept. Accepting one writes it to
        layout.json and saves a revision, and discarding one puts the structure
        or route back as layout.json has it. Proposals are for the agent: notes,
        text suggestions, answers and questions wait here until you press Ready
        for review, then until the agent gives a verdict.
      </p>
      {refusal === undefined ? null : (
        <p
          className="border-refused border-l-2 pl-2 text-xs"
          data-discard-refused
        >
          {refusal}
        </p>
      )}
      {nothingAtAll ? (
        <p className="text-sm" data-pending-empty>
          {editOn
            ? "Nothing is pending. Drag a structure to move it, drag a corner of the selected one to resize it, drag a segment of an arrow to reroute it, or drag a zone title to move its group. Pin a note, suggest new text or answer a question from a structure's panel."
            : "Nothing is pending. Press Edit to move structures, propose changes or pin notes."}
        </p>
      ) : null}
      {pending.length === 0 ? null : (
        <>
          {acceptable ? (
            <div className="flex flex-col gap-1.5">
              <LabelledField
                disabled={accepting.busy}
                label="Revision message (optional)"
              >
                <Input
                  data-accept-message
                  maxLength={maxMessageLength}
                  onValueChange={setMessage}
                  placeholder="Leave empty to write one from the changes"
                  value={message}
                />
              </LabelledField>
              <button
                className={`${controlClass} self-start`}
                data-accept-all
                disabled={accepting.busy}
                onClick={() => {
                  acceptWith("all");
                }}
                type="button"
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
                  className="border-pending flex items-start gap-2 border-l-2 pl-2 text-sm"
                  data-pending-change={change.kind}
                  data-pending-hop={hopsOf(change)[0]}
                  data-pending-id={change.id}
                  data-pending-structure={structuresOf(change)[0]}
                  key={layoutChangeKey(change)}
                >
                  <span className="min-w-0 flex-1">
                    {Arr.join(
                      describeChange(change, accepted, {
                        hop: hopName,
                        structure: nameOf,
                      }),
                      "; "
                    )}
                  </span>
                  {acceptable ? (
                    <button
                      aria-label={`Accept the ${change.kind} of ${names}`}
                      className={controlClass}
                      data-accept-change={change.id}
                      disabled={accepting.busy}
                      onClick={() => {
                        acceptWith([change.id]);
                      }}
                      type="button"
                    >
                      Accept
                    </button>
                  ) : null}
                  {canEdit ? (
                    <button
                      aria-label={`Discard the ${change.kind} of ${names}`}
                      className={controlClass}
                      onClick={() => {
                        discardWith(change);
                      }}
                      type="button"
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
        <section className="flex flex-col gap-2" data-route-overrides>
          <h3 className="text-xs tracking-widest uppercase opacity-70">
            Routes set by hand
          </h3>
          <ul className="flex flex-col gap-2">
            {Arr.map(overridden, ({ id }) => (
              <li
                className="flex items-start gap-2 text-sm"
                data-route-override={id}
                key={id}
              >
                <span className="min-w-0 flex-1">{hopName(id)}</span>
                <button
                  aria-label={`Reset the route ${hopName(id)}`}
                  className={controlClass}
                  data-reset-route={id}
                  onClick={() => {
                    setRefusal(editing.reroute(id, null));
                  }}
                  type="button"
                >
                  Reset route
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <ReviewList />
    </section>
  );
}
