import {
  maxStructureNameLength,
  provisionalIdOf,
} from "@axonometric/contracts";
import type { Shape, Status } from "@axonometric/contracts";
import { Array as Arr, Option, String as Str } from "effect";
import { useId, useState } from "react";

import { controlClass } from "./control-class.ts";
import { newStructureFootprint } from "./new-structure.ts";
import { usePlacing } from "./place-context.ts";
import { useProposed } from "./proposed-context.ts";
import { shapeChoices, statusChoices } from "./structure-actions.ts";
import { usePropose } from "./use-propose.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

const fieldClass =
  "border-ink bg-paper text-ink focus-visible:outline-ink border px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-1";

const snap = (value: number) => Math.round(value * 2) / 2;

/** Four hex digits that make a provisional id hard to repeat. */
const suffix = () => {
  const bytes = [...globalThis.crypto.getRandomValues(new Uint8Array(2))];
  const digits = Arr.map(bytes, (byte) => byte.toString(16));

  return Arr.join(
    Arr.map(digits, (hex) => Str.padStart(2, "0")(hex)),
    ""
  );
};

/**
 * The form that adds a structure: its name, shape, group, status and
 * position. The position is where the engineer clicks on the map, which the
 * form says while it waits; the two number fields show it and can correct
 * it. The new structure is a proposal and shows in the pending look at once.
 */
export function AddStructureForm({
  onClose,
}: {
  readonly onClose: () => void;
}) {
  const placing = usePlacing();
  const proposing = useProposed();
  const { state } = useWalkthrough();
  const { send, failure, clear, canPropose } = usePropose();
  const id = useId();
  const [name, setName] = useState("");
  const [shape, setShape] = useState<Shape>("box");
  const [status, setStatus] = useState<Status>("planned");
  const [group, setGroup] = useState(state.data.groups[0]?.id ?? "");
  const [sending, setSending] = useState(false);

  if (placing === null || proposing === null) {
    return null;
  }

  const { spot } = placing;
  const trimmed = name.trim();

  const change = (): Parameters<typeof send>[0] | undefined =>
    spot === null || trimmed === ""
      ? undefined
      : {
          action: "add",
          structure: {
            id: provisionalIdOf(trimmed, suffix()),
            name: trimmed,
            shape,
            group,
            status,
          },
          at: { ...spot, ...newStructureFootprint },
        };

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

  return (
    <form
      data-add-structure
      aria-label="Add a structure"
      className="border-ink bg-paper text-ink pointer-events-auto flex w-72 flex-col gap-2 border p-3 text-xs"
      onSubmit={(event) => {
        event.preventDefault();

        const made = change();

        if (made === undefined) {
          return;
        }

        setSending(true);
        send(made, () => {
          setSending(false);
          placing.setSpot(null);
          onClose();
        });
        setSending(false);
      }}
    >
      <h2 className="tracking-widest uppercase opacity-70">Add a structure</h2>
      <label className="flex flex-col gap-1" htmlFor={`${id}-name`}>
        <span className="opacity-70">Name</span>
        <input
          id={`${id}-name`}
          data-add="name"
          type="text"
          value={name}
          maxLength={maxStructureNameLength}
          autoComplete="off"
          className={fieldClass}
          onChange={(event) => {
            clear();
            setName(event.target.value);
          }}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="opacity-70">Shape</span>
          <select
            data-add="shape"
            className={fieldClass}
            value={shape}
            onChange={(event) => {
              Option.map(
                Arr.findFirst(
                  shapeChoices,
                  ({ value }) => value === event.target.value
                ),
                ({ value }) => {
                  setShape(value);
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
            value={status}
            onChange={(event) => {
              Option.map(
                Arr.findFirst(
                  statusChoices,
                  ({ value }) => value === event.target.value
                ),
                ({ value }) => {
                  setStatus(value);
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
          value={group}
          onChange={(event) => {
            setGroup(event.target.value);
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
          <label className="flex w-16 flex-col gap-1">
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
          <label className="flex w-16 flex-col gap-1">
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
          {spot === null
            ? "Click the map to say where it goes."
            : `Footprint ${newStructureFootprint.w} × ${newStructureFootprint.d} at ${spot.x}, ${spot.y}.`}
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
          disabled={!canPropose || sending || trimmed === "" || spot === null}
        >
          Propose
        </button>
        <button
          type="button"
          data-add="cancel"
          className={controlClass}
          onClick={() => {
            placing.setSpot(null);
            placing.pick(false);
            onClose();
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
