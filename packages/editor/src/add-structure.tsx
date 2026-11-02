import {
  maxStructureNameLength,
  newProvisionalId,
} from "@axonometric/contracts";
import type { StructureChange } from "@axonometric/contracts";
import { Array as Arr, Option } from "effect";
import { useEffect, useId } from "react";

import { controlClass } from "./control-class.ts";
import { useDraftSpot } from "./draft-spot.ts";
import { fieldClass } from "./field-class.ts";
import { newStructureFootprint } from "./new-structure.ts";
import { usePlacing } from "./place-context.ts";
import { useProposed } from "./proposed-context.ts";
import { snap } from "./snap.ts";
import { shapeChoices, statusChoices } from "./structure-actions.ts";
import { usePropose } from "./use-propose.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

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
  const { send, preview, sending, failure, clear, canPropose } = usePropose();
  const spot = useDraftSpot();
  const id = useId();

  const name = placing?.draft.name.trim() ?? "";

  const change = (): StructureChange | undefined =>
    placing === null || spot === null || name === ""
      ? undefined
      : {
          action: "add",
          structure: {
            id: newProvisionalId(name),
            name,
            shape: placing.draft.shape,
            group: placing.draft.group,
            status: placing.draft.status,
          },
          at: spot,
        };

  // The panel shows the warnings for what the form would propose now. The id
  // only has to be unique, so a fixed one stands in until the form is sent.
  const draftChange = (): StructureChange | undefined => {
    const made = change();

    return made?.action === "add"
      ? { ...made, structure: { ...made.structure, id: "draft-structure" } }
      : made;
  };

  const spotKey = `${spot?.x}/${spot?.y}`;
  const draft = placing?.draft;

  useEffect(() => {
    if (placing?.open === true) {
      preview(draftChange());
    }
    // `preview` and `draftChange` are rebuilt every render; what they read is listed.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [
    placing?.open,
    spotKey,
    draft?.name,
    draft?.shape,
    draft?.group,
    draft?.status,
  ]);

  if (placing === null || proposing === null || draft === undefined) {
    return null;
  }

  const setCoordinate = (axis: "x" | "y", text: string) => {
    const value = Number(text);

    if (text.trim() !== "" && Number.isFinite(value)) {
      placing.setSpot({
        x: spot?.x ?? 0,
        y: spot?.y ?? 0,
        [axis]: snap(value),
      });
    }
  };

  const close = () => {
    placing.setOpen(false);
  };

  return (
    <form
      data-add-structure
      aria-label="Add a structure"
      className="flex flex-col gap-2 text-xs"
      onSubmit={(event) => {
        event.preventDefault();

        const made = change();

        if (made !== undefined && !sending) {
          send(made, close);
        }
      }}
    >
      <label className="flex flex-col gap-1" htmlFor={`${id}-name`}>
        <span className="opacity-70">Name</span>
        <input
          id={`${id}-name`}
          data-add="name"
          type="text"
          value={draft.name}
          maxLength={maxStructureNameLength}
          autoComplete="off"
          className={fieldClass}
          onChange={(event) => {
            clear();
            placing.setDraft({ ...draft, name: event.target.value });
          }}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="opacity-70">Shape</span>
          <select
            data-add="shape"
            className={fieldClass}
            value={draft.shape}
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
          >
            {Arr.map(shapeChoices, ({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="opacity-70">Status</span>
          <select
            data-add="status"
            className={fieldClass}
            value={draft.status}
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
          >
            {Arr.map(statusChoices, ({ value, label }) => (
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
          data-add="group"
          className={fieldClass}
          value={draft.group}
          onChange={(event) => {
            placing.setDraft({ ...draft, group: event.target.value });
          }}
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
              data-add="x"
              type="number"
              step={0.5}
              value={spot?.x ?? ""}
              className={fieldClass}
              onChange={(event) => {
                setCoordinate("x", event.target.value);
              }}
            />
          </label>
          <label className="flex w-14 flex-col gap-1">
            <span className="opacity-70">y</span>
            <input
              data-add="y"
              type="number"
              step={0.5}
              value={spot?.y ?? ""}
              className={fieldClass}
              onChange={(event) => {
                setCoordinate("y", event.target.value);
              }}
            />
          </label>
          <button
            type="button"
            data-add="pick"
            aria-pressed={placing.picking}
            className={controlClass}
            onClick={() => {
              placing.pick(!placing.picking);
            }}
          >
            {placing.picking ? "Click the map…" : "Pick on map"}
          </button>
        </div>
        <p data-add-hint className="opacity-70">
          {placing.spot === null
            ? `Footprint ${newStructureFootprint.w} × ${newStructureFootprint.d}, in the first free slot beside the group. Click the map to move it.`
            : `Footprint ${newStructureFootprint.w} × ${newStructureFootprint.d} at ${placing.spot.x}, ${placing.spot.y}.`}
        </p>
      </fieldset>
      {failure === undefined ? null : (
        <p
          role="alert"
          data-add-failure
          className="border-refused border-l-2 pl-2"
        >
          {failure}
        </p>
      )}
      <div className="flex gap-1.5">
        <button
          type="submit"
          data-add="submit"
          className={controlClass}
          disabled={!canPropose || sending || name === "" || spot === null}
        >
          {sending ? "Saving…" : "Propose"}
        </button>
        <button
          type="button"
          data-add="cancel"
          className={controlClass}
          onClick={close}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
