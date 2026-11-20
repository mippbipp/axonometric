import { maxStructureNameLength } from "@axonometric/contracts";
import type { GridPoint } from "@axonometric/contracts";
import { Toggle } from "@axonometric/ui/components/toggle";
import { Array as Arr, Option } from "effect";
import { useId } from "react";

import { addChangeOf, previewId, sentId } from "./add-change.ts";
import { controlClass, uiControlClass } from "./control-class.ts";
import { useDraftSpot } from "./draft-spot.ts";
import type { DraftSpot } from "./draft-spot.ts";
import { fieldClass } from "./field-class.ts";
import { newStructureFootprint } from "./new-structure.ts";
import { usePlacing } from "./place-context.ts";
import { useProposed } from "./proposed-context.ts";
import { snap } from "./snap.ts";
import { shapeChoices, statusChoices } from "./structure-actions.ts";
import { useDraftPreview } from "./use-draft-preview.ts";
import { usePropose } from "./use-propose.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

const footprintWords = `Footprint ${newStructureFootprint.w} × ${newStructureFootprint.d}`;

/** What the form says about where the structure goes. */
const spotHint = (picked: GridPoint | null, drafted: DraftSpot | null) => {
  if (picked !== null) {
    return `${footprintWords} at ${picked.x}, ${picked.y}.`;
  }

  const added = drafted?.added ?? 0;

  return added === 0
    ? `${footprintWords}, in the nearest spot to the group where check finds nothing new. Click the map to move it.`
    : `${footprintWords}. No spot near the group is clear: this one adds ${added === 1 ? "1 warning" : `${added} warnings`}, the fewest found. Click the map to move it.`;
};

/**
 * The form that adds a structure: its name, shape, group, status and
 * position. It lives in the side panel, beside the warnings it can raise,
 * and never over the drawing.
 *
 * The position starts at the first free slot beside the chosen group's zone
 * and follows the group and shape until the engineer clicks the map, with
 * "Pick on map", or types a spot. The new structure is a proposal and shows
 * in the pending look at once. As the fields change, the panel shows what
 * `check` would report for the map as proposed with the structure added.
 */
export function AddStructureForm() {
  const placing = usePlacing();
  const proposing = useProposed();
  const { state } = useWalkthrough();
  const { canPropose, clear, failure, send, sending } = usePropose();
  const drafted = useDraftSpot();
  const spot = drafted?.spot ?? null;
  const id = useId();

  const draft = placing?.draft;

  const draftChange =
    draft === undefined
      ? undefined
      : addChangeOf({ draft, id: previewId, spot });

  useDraftPreview(draftChange);

  if (placing === null || proposing === null || draft === undefined) {
    return null;
  }

  const setCoordinate = (axis: "x" | "y", text: string) => {
    const value = Number(text);

    if (text.trim() !== "" && Number.isFinite(value)) {
      placing.setSpot({
        x: spot?.x ?? 0,
        y: spot?.y ?? 0,
        // The typed axis comes last so it overrides x and y.
        [axis]: snap(value),
      });
    }
  };

  const close = () => {
    placing.setOpen(false);
  };

  return (
    <form
      aria-label="Add a structure"
      className="flex flex-col gap-2 text-xs"
      data-add-structure
      onSubmit={(event) => {
        event.preventDefault();

        const made =
          draft === undefined
            ? undefined
            : addChangeOf({ draft, id: sentId, spot });

        if (made !== undefined && !sending) {
          send(made, close);
        }
      }}
    >
      <label className="flex flex-col gap-1" htmlFor={`${id}-name`}>
        <span className="opacity-70">Name</span>
        <input
          autoComplete="off"
          className={fieldClass}
          data-add="name"
          id={`${id}-name`}
          maxLength={maxStructureNameLength}
          onChange={(event) => {
            clear();
            placing.setDraft({ ...draft, name: event.target.value });
          }}
          type="text"
          value={draft.name}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="opacity-70">Shape</span>
          <select
            className={fieldClass}
            data-add="shape"
            onChange={(event) => {
              Option.map(
                Arr.findFirst(
                  shapeChoices,
                  ({ value }) => value === event.target.value
                ),
                ({ value }) => {
                  placing.setDraft({ ...draft, shape: value });
                }
              );
            }}
            value={draft.shape}
          >
            {Arr.map(shapeChoices, ({ label, value }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="opacity-70">Status</span>
          <select
            className={fieldClass}
            data-add="status"
            onChange={(event) => {
              Option.map(
                Arr.findFirst(
                  statusChoices,
                  ({ value }) => value === event.target.value
                ),
                ({ value }) => {
                  placing.setDraft({ ...draft, status: value });
                }
              );
            }}
            value={draft.status}
          >
            {Arr.map(statusChoices, ({ label, value }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="opacity-70">Group</span>
        <select
          className={fieldClass}
          data-add="group"
          onChange={(event) => {
            placing.setDraft({ ...draft, group: event.target.value });
          }}
          value={draft.group}
        >
          {Arr.map(state.data.groups, ({ id: groupId, title }) => (
            <option key={groupId} value={groupId}>
              {title}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="flex flex-col gap-1">
        <legend className="opacity-70">Position</legend>
        <div className="flex items-end gap-1.5">
          <label className="flex w-14 flex-col gap-1">
            <span className="opacity-70">x</span>
            <input
              className={fieldClass}
              data-add="x"
              onChange={(event) => {
                setCoordinate("x", event.target.value);
              }}
              step={0.5}
              type="number"
              value={spot?.x ?? ""}
            />
          </label>
          <label className="flex w-14 flex-col gap-1">
            <span className="opacity-70">y</span>
            <input
              className={fieldClass}
              data-add="y"
              onChange={(event) => {
                setCoordinate("y", event.target.value);
              }}
              step={0.5}
              type="number"
              value={spot?.y ?? ""}
            />
          </label>
          <Toggle
            className={uiControlClass}
            data-add="pick"
            onPressedChange={(on) => {
              placing.pick(on);
            }}
            pressed={placing.picking}
          >
            {placing.picking ? "Click the map…" : "Pick on map"}
          </Toggle>
        </div>
        <p className="opacity-70" data-add-hint>
          {spotHint(placing.spot, drafted)}
        </p>
      </fieldset>
      {failure === undefined ? null : (
        <p
          className="border-refused border-l-2 pl-2"
          data-add-failure
          role="alert"
        >
          {failure}
        </p>
      )}
      <div className="flex gap-1.5">
        <button
          className={controlClass}
          data-add="submit"
          disabled={!canPropose || sending || draftChange === undefined}
          type="submit"
        >
          {sending ? "Saving…" : "Propose"}
        </button>
        <button
          className={controlClass}
          data-add="cancel"
          onClick={close}
          type="button"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
