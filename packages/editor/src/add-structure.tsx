import { maxStructureNameLength } from "@axonometric/contracts";
import { Button } from "@axonometric/ui/components/button";
import {
  Field,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@axonometric/ui/components/field";
import { Input } from "@axonometric/ui/components/input";
import {
  NumberInput,
  NumberInputControl,
} from "@axonometric/ui/components/number-input";
import { Toggle } from "@axonometric/ui/components/toggle";
import { Array as Arr, Option } from "effect";

import { addChangeOf, previewId, sentId } from "./add-change.ts";
import { ChoiceSelect } from "./choice-select.tsx";
import { uiControlClass } from "./control-class.ts";
import { spotShown, useDraftSpot } from "./draft-spot.ts";
import type { DraftSpot } from "./draft-spot.ts";
import { LabelledField } from "./labelled-field.tsx";
import { newStructureFootprint } from "./new-structure.ts";
import { usePlacing } from "./place-context.ts";
import { useProposed } from "./proposed-context.ts";
import { snap } from "./snap.ts";
import { shapeChoices, statusChoices } from "./structure-actions.ts";
import { usePropose } from "./use-propose.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

const footprintWords = `Footprint ${newStructureFootprint.w} × ${newStructureFootprint.d}`;

/** What the form says about where the structure goes. */
const spotHint = (drafted: DraftSpot) => {
  if (drafted.kind === "finding") {
    return "Finding a spot near the group…";
  }

  if (drafted.kind === "picked") {
    return `${footprintWords} at ${drafted.spot.x}, ${drafted.spot.y}.`;
  }

  return drafted.added === 0
    ? `${footprintWords}, in the nearest spot to the group where check finds nothing new. Click the map to move it.`
    : `${footprintWords}. No spot near the group is clear: this one adds ${drafted.added === 1 ? "1 warning" : `${drafted.added} warnings`}, the fewest found. Click the map to move it.`;
};

/**
 * The form that adds a structure: its name, shape, group, status and
 * position. It lives in the side panel, beside the warnings it can raise,
 * and never over the drawing.
 *
 * The position starts at the nearest clear spot beside the chosen group's
 * zone and follows the group, shape and name until the engineer clicks the
 * map, with "Pick on map", or types a spot. Finding it takes seconds on a big
 * map, so it happens off the main thread: meanwhile the hint says so, the map
 * keeps the last spot found, and Propose waits. The new structure is a
 * proposal and shows in the pending look at once. As the fields change, the
 * panel shows what `check` would report for the map as proposed with the
 * structure added.
 */
export function AddStructureForm() {
  const placing = usePlacing();
  const proposing = useProposed();
  const { state } = useWalkthrough();
  const { canPropose, clear, failure, send, sending } = usePropose();
  const drafted = useDraftSpot();

  if (placing === null || proposing === null || drafted === null) {
    return null;
  }

  const { draft } = placing;
  const finding = drafted.spot.kind === "finding";
  const shownSpot = spotShown(drafted.spot);
  // A structure is only sent to a spot found for the name as it stands.
  const spot = finding ? null : (shownSpot ?? null);

  const setCoordinate = (axis: "x" | "y", value: number | null) => {
    if (value !== null && Number.isFinite(value)) {
      placing.setSpot({
        x: shownSpot?.x ?? 0,
        y: shownSpot?.y ?? 0,
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
      aria-busy={drafted.checking}
      aria-label="Add a structure"
      className="flex flex-col gap-2 text-xs"
      data-add-structure
      data-checking={drafted.checking ? "" : undefined}
      onSubmit={(event) => {
        event.preventDefault();

        const made = addChangeOf({ draft, id: sentId, spot });

        if (made !== undefined && !sending) {
          send(made, close);
        }
      }}
    >
      <LabelledField label="Name">
        <Input
          autoComplete="off"
          data-add="name"
          maxLength={maxStructureNameLength}
          onValueChange={(next) => {
            clear();
            placing.setDraft({ ...draft, name: next });
          }}
          value={draft.name}
        />
      </LabelledField>
      <div className="grid grid-cols-2 gap-2">
        <ChoiceSelect
          choices={shapeChoices}
          className="flex flex-col gap-1"
          label="Shape"
          onChange={(next) => {
            Option.map(
              Arr.findFirst(shapeChoices, ({ value }) => value === next),
              ({ value }) => {
                placing.setDraft({ ...draft, shape: value });
              }
            );
          }}
          trigger={{ "data-add": "shape" }}
          value={draft.shape}
        />
        <ChoiceSelect
          choices={statusChoices}
          className="flex flex-col gap-1"
          label="Status"
          onChange={(next) => {
            Option.map(
              Arr.findFirst(statusChoices, ({ value }) => value === next),
              ({ value }) => {
                placing.setDraft({ ...draft, status: value });
              }
            );
          }}
          trigger={{ "data-add": "status" }}
          value={draft.status}
        />
      </div>
      <ChoiceSelect
        choices={Arr.map(state.data.groups, ({ id: groupId, title }) => ({
          label: title,
          value: groupId,
        }))}
        className="flex flex-col gap-1"
        label="Group"
        onChange={(next) => {
          placing.setDraft({ ...draft, group: next });
        }}
        trigger={{ "data-add": "group" }}
        value={draft.group}
      />
      <FieldSet className="flex flex-col gap-1">
        <FieldLegend className="opacity-70">Position</FieldLegend>
        <div className="flex items-end gap-1.5">
          <Field className="flex w-16 flex-col gap-1">
            <FieldLabel className="opacity-70">x</FieldLabel>
            <NumberInput
              onValueChange={(next) => {
                setCoordinate("x", next);
              }}
              step={0.5}
              value={shownSpot?.x ?? null}
            >
              <NumberInputControl data-add="x" />
            </NumberInput>
          </Field>
          <Field className="flex w-16 flex-col gap-1">
            <FieldLabel className="opacity-70">y</FieldLabel>
            <NumberInput
              onValueChange={(next) => {
                setCoordinate("y", next);
              }}
              step={0.5}
              value={shownSpot?.y ?? null}
            >
              <NumberInputControl data-add="y" />
            </NumberInput>
          </Field>
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
        <p
          className="opacity-70"
          data-add-hint
          data-finding={finding ? "" : undefined}
        >
          {spotHint(drafted.spot)}
        </p>
      </FieldSet>
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
        <Button
          className={uiControlClass}
          data-add="submit"
          disabled={
            !canPropose ||
            sending ||
            addChangeOf({ draft, id: previewId, spot }) === undefined
          }
          type="submit"
        >
          {sending ? "Saving…" : "Propose"}
        </Button>
        <Button className={uiControlClass} data-add="cancel" onClick={close}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
