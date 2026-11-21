import {
  hopLabelOf,
  hopsOf,
  layoutChangeKey,
  maxMessageLength,
  pendingRows,
  structuresOf,
} from "@axonometric/contracts";
import type { ChangeId, LayoutChange } from "@axonometric/contracts";
import { Button } from "@axonometric/ui/components/button";
import { Input } from "@axonometric/ui/components/input";
import { Array as Arr, Predicate, Record as Rec } from "effect";
import { useState } from "react";

import { useAccepting } from "./accepting-context.ts";
import { uiControlClass } from "./control-class.ts";
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

  const discardWith = (ids: Arr.NonEmptyReadonlyArray<ChangeId>) => {
    setRefusal(discard(ids));
  };

  const acceptWith = (ids: "all" | Arr.NonEmptyReadonlyArray<ChangeId>) => {
    setRefusal(undefined);
    accepting?.accept(ids, message);
    setMessage("");
  };

  const acceptable = canEdit && accepting?.canAccept === true;

  const changeRow = (change: LayoutChange) => {
    const names = namesOf(change);

    return (
      <li
        className="border-pending flex items-start gap-2 border-l-2 pl-2 text-sm"
        data-pending-by={change.by}
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
          <Button
            aria-label={`Accept the ${change.kind} of ${names}`}
            className={uiControlClass}
            data-accept-change={change.id}
            disabled={accepting.busy}
            onClick={() => {
              acceptWith([change.id]);
            }}
            type="button"
          >
            Accept
          </Button>
        ) : null}
        {canEdit ? (
          <Button
            aria-label={`Discard the ${change.kind} of ${names}`}
            className={uiControlClass}
            onClick={() => {
              discardWith([change.id]);
            }}
            type="button"
          >
            Discard
          </Button>
        ) : null}
      </li>
    );
  };

  const groupRow = (
    changes: Arr.NonEmptyReadonlyArray<LayoutChange>,
    reason: string | undefined
  ) => {
    const ids = Arr.map(changes, ({ id }) => id);
    const heading =
      reason === undefined
        ? "Proposed by the agent"
        : `Proposed by the agent: ${reason}`;
    const subject = reason === undefined ? "" : ` for ${reason}`;

    return (
      <li
        className="border-ink/40 flex flex-col gap-1.5 border-t border-dashed pt-2"
        data-pending-group
        data-pending-reason={reason}
        key={layoutChangeKey(changes[0])}
      >
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="w-full text-xs opacity-70">{heading}</h3>
          {changes.length > 1 && acceptable ? (
            <Button
              aria-label={`Accept the agent's changes${subject}`}
              className={uiControlClass}
              data-accept-group
              disabled={accepting.busy}
              onClick={() => {
                acceptWith(ids);
              }}
            >
              Accept group
            </Button>
          ) : null}
          {changes.length > 1 && canEdit ? (
            <Button
              aria-label={`Discard the agent's changes${subject}`}
              className={uiControlClass}
              data-discard-group
              onClick={() => {
                discardWith(ids);
              }}
            >
              Discard group
            </Button>
          ) : null}
        </div>
        <ul className="flex flex-col gap-2">{Arr.map(changes, changeRow)}</ul>
      </li>
    );
  };

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
              <Button
                className={`${uiControlClass} self-start`}
                data-accept-all
                disabled={accepting.busy}
                onClick={() => {
                  acceptWith("all");
                }}
                type="button"
              >
                Accept all
              </Button>
            </div>
          ) : null}
          <ul className="flex flex-col gap-2">
            {Arr.map(pendingRows(pending), (row) =>
              Predicate.isTagged(row, "Change")
                ? changeRow(row.change)
                : groupRow(row.changes, row.reason)
            )}
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
                <Button
                  aria-label={`Reset the route ${hopName(id)}`}
                  className={uiControlClass}
                  data-reset-route={id}
                  onClick={() => {
                    setRefusal(editing.reroute(id, null));
                  }}
                  type="button"
                >
                  Reset route
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <ReviewList />
    </section>
  );
}
