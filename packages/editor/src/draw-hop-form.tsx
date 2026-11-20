import { maxHopLabelLength, newHopId } from "@axonometric/contracts";
import { Input } from "@axonometric/ui/components/input";
import { Array as Arr, Option, Result } from "effect";
import { useEffect, useEffectEvent, useState } from "react";

import { ChoiceSelect } from "./choice-select.tsx";
import { useConnections } from "./connections-context.ts";
import { controlClass } from "./control-class.ts";
import { useChangePreview } from "./drag-preview-context.ts";
import { useHopDraft } from "./hop-draft-context.ts";
import { LabelledField } from "./labelled-field.tsx";
import { useSelection } from "./selection-context.ts";
import { useStructuresById } from "./structures.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/** Focuses the label field when the form opens: the next thing typed is the label. */
const focusOnOpen = (field: HTMLInputElement | null) => {
  field?.focus();
};

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
      from: draft.from,
      id: newHopId(made === "" ? "hop" : made),
      label: made,
      to,
    },
  });

  return (
    <form
      aria-label="Draw a hop"
      className="flex flex-col gap-2 text-xs"
      data-draw-hop
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
          panel?.show({ problems: [], refusal });

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
          panel?.show({ problems: [], refusal: why });
        });
      }}
    >
      <p>
        From <b data-draw-from>{nameOf(draft.from)}</b>
        {draft.to === null ? "" : " to "}
        {draft.to === null ? null : <b data-draw-to>{nameOf(draft.to)}</b>}
      </p>
      <ChoiceSelect
        choices={Arr.map(targets, (other) => ({
          label: nameOf(other),
          value: other,
        }))}
        className="flex flex-col gap-1"
        label="To"
        onChange={(next) => {
          drafting.pick(next === "" ? null : next);
        }}
        placeholder="Pick a structure…"
        trigger={{ "data-draw": "to" }}
        value={draft.to ?? ""}
      />
      <LabelledField
        failure={failure}
        failureProps={{ "data-draw-failure": "" }}
        label="Label"
      >
        <Input
          autoComplete="off"
          data-draw="label"
          maxLength={maxHopLabelLength}
          onValueChange={(next) => {
            setFailure(undefined);
            setLabel(next);
          }}
          ref={focusOnOpen}
          value={label}
        />
      </LabelledField>
      <div className="flex gap-1.5">
        <button
          className={controlClass}
          data-draw="submit"
          disabled={
            draft.to === null ||
            label.trim() === "" ||
            sending ||
            !connections.canPropose
          }
          type="submit"
        >
          Propose hop
        </button>
        <button
          className={controlClass}
          data-draw="cancel"
          onClick={close}
          type="button"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
