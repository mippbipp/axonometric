import { maxHopLabelLength, newHopId } from "@axonometric/contracts";
import { Array as Arr, Option, Result } from "effect";
import { useEffect, useEffectEvent, useId, useState } from "react";

import { useConnections } from "./connections-context.ts";
import { controlClass } from "./control-class.ts";
import { useChangePreview } from "./drag-preview-context.ts";
import { fieldClass } from "./field-class.ts";
import { useHopDraft } from "./hop-draft-context.ts";
import { useSelection } from "./selection-context.ts";
import { useStructuresById } from "./structures.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/**
 * The form that finishes a hop: the structure it ends at, picked from a list
 * when the hop was started from "Draw hop from here", and its label. It lives
 * in the side panel under the tabs, never over the drawing. Sending proposes
 * the hop and selects it; cancelling, or Escape, draws nothing.
 */
export function DrawHopForm() {
  const drafting = useHopDraft();
  const connections = useConnections();
  const byId = useStructuresById();
  const { revealed } = useWalkthrough();
  const { selectHop } = useSelection();
  const panel = useChangePreview();
  const [label, setLabel] = useState("");
  const [failure, setFailure] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const id = useId();

  const draft = drafting?.draft;

  // Escape drops the draft from anywhere on the page, a field or not.
  const cancelOnEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape" && draft !== null && draft !== undefined) {
      setLabel("");
      setFailure(undefined);
      panel?.clear();
      drafting?.cancel();
    }
  });

  useEffect(() => {
    globalThis.addEventListener("keydown", cancelOnEscape);

    return () => {
      globalThis.removeEventListener("keydown", cancelOnEscape);
    };
  }, []);

  if (
    drafting === null ||
    connections === null ||
    draft === null ||
    draft === undefined
  ) {
    return null;
  }

  const nameOf = (structure: string) => byId.get(structure)?.name ?? structure;
  const targets = Arr.filter([...revealed], (other) => other !== draft.from);

  const close = () => {
    setLabel("");
    setFailure(undefined);
    panel?.clear();
    drafting.cancel();
  };

  const changeOf = (to: string, made: string) => ({
    action: "add" as const,
    hop: {
      id: newHopId(made === "" ? "hop" : made),
      from: draft.from,
      to,
      label: made,
    },
  });

  return (
    <form
      data-draw-hop
      aria-label="Draw a hop"
      className="flex flex-col gap-2 text-xs"
      onSubmit={(event) => {
        event.preventDefault();

        const { to } = draft;
        const made = label.trim();

        if (to === null || made === "" || sending) {
          return;
        }

        const change = changeOf(to, made);
        const refusal = connections.refusalOfHop(change);

        if (refusal !== undefined) {
          setFailure(refusal);
          panel?.show({ refusal, problems: [] });

          return;
        }

        setSending(true);
        panel?.show({ problems: connections.problemsOfHop(change) });
        connections.proposeHop(change, (outcome) => {
          setSending(false);

          if (Result.isSuccess(outcome)) {
            setLabel("");
            setFailure(undefined);
            drafting.cancel();
            selectHop(change.hop.id);

            return;
          }

          const why = Option.getOrUndefined(Result.getFailure(outcome));

          setFailure(why);
          panel?.show({ refusal: why, problems: [] });
        });
      }}
    >
      <p>
        From <b data-draw-from>{nameOf(draft.from)}</b>
        {draft.to === null ? "" : " to "}
        {draft.to === null ? null : <b data-draw-to>{nameOf(draft.to)}</b>}
      </p>
      <label className="flex flex-col gap-1" htmlFor={`${id}-to`}>
        <span className="opacity-70">To</span>
        <select
          id={`${id}-to`}
          data-draw="to"
          value={draft.to ?? ""}
          className={fieldClass}
          onChange={(event) => {
            drafting.pick(
              event.target.value === "" ? null : event.target.value
            );
          }}
        >
          <option value="">Pick a structure…</option>
          {Arr.map(targets, (other) => (
            <option key={other} value={other}>
              {nameOf(other)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1" htmlFor={`${id}-label`}>
        <span className="opacity-70">Label</span>
        <input
          id={`${id}-label`}
          data-draw="label"
          type="text"
          value={label}
          maxLength={maxHopLabelLength}
          autoComplete="off"
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- the form opens because the engineer dropped a hop, and the label is the next thing they type.
          autoFocus
          className={fieldClass}
          onChange={(event) => {
            setFailure(undefined);
            setLabel(event.target.value);
          }}
        />
      </label>
      {failure === undefined ? null : (
        <p data-draw-failure className="border-refused border-l-2 pl-2">
          {failure}
        </p>
      )}
      <div className="flex gap-1.5">
        <button
          type="submit"
          data-draw="submit"
          className={controlClass}
          disabled={
            draft.to === null ||
            label.trim() === "" ||
            sending ||
            !connections.canPropose
          }
        >
          Propose hop
        </button>
        <button
          type="button"
          data-draw="cancel"
          className={controlClass}
          onClick={close}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
