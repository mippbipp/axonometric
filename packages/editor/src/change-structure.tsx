import {
  marked,
  maxStructureNameLength,
  removedMark,
} from "@axonometric/contracts";
import type { Structure } from "@axonometric/contracts";
import { Array as Arr, Option } from "effect";
import { useId, useState } from "react";

import { ChoiceSelect } from "./choice-select.tsx";
import { useConnections } from "./connections-context.ts";
import { controlClass } from "./control-class.ts";
import { DeletionNotice } from "./deletion-notice.tsx";
import { fieldClass } from "./field-class.ts";
import { useHopDraft } from "./hop-draft-context.ts";
import { useProposed } from "./proposed-context.ts";
import { changeFor, shapeChoices, statusChoices } from "./structure-actions.ts";
import { usePropose } from "./use-propose.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/**
 * A structure's panel section for proposing changes: rename, and a choice of
 * shape, group and status, and delete. Each is a proposal the agent reviews,
 * so the page shows the structure in the pending look until then. Only a page
 * that can write has it.
 *
 * What the controls show is the structure as proposed, so a structure with a
 * pending rename shows the new name in the box.
 */
export function ChangeStructure({
  structure,
}: {
  readonly structure: Structure;
}) {
  const proposing = useProposed();
  const connections = useConnections();
  const drafting = useHopDraft();
  const { state } = useWalkthrough();
  const { canPropose, clear, failure, send } = usePropose();
  const renameId = useId();
  const [name, setName] = useState<string | undefined>();

  if (proposing === null) {
    return null;
  }

  const deleted = marked(proposing.proposed, removedMark).has(structure.id);

  // The open proposal that deletes it. Once it is in a batch there is none,
  // and the panel only says the structure waits on the agent.
  const openDeletion = Option.getOrUndefined(
    Option.map(
      Arr.findFirst(
        proposing.open,
        ({ change }) =>
          change.action === "delete" && change.structure === structure.id
      ),
      ({ id }) => id
    )
  );

  const typed = name ?? structure.name;

  const choose = ({
    label,
    onChange,
    options,
    value,
  }: {
    readonly label: string;
    readonly onChange: (next: string) => void;
    readonly options: ReadonlyArray<{ label: string; value: string }>;
    readonly value: string;
  }) => (
    <ChoiceSelect
      choices={options}
      className="flex items-center justify-between gap-2 text-xs"
      disabled={!canPropose || deleted}
      label={label}
      onChange={onChange}
      trigger={{ "data-change": label.toLowerCase() }}
      value={value}
    />
  );

  return (
    <section className="flex flex-col gap-2" data-change-structure>
      <h3 className="text-xs tracking-widest uppercase opacity-70">
        Propose a change
      </h3>
      {deleted ? (
        <DeletionNotice
          canWrite={canPropose}
          discard={proposing.discard}
          open={openDeletion}
        />
      ) : null}
      <form
        className="flex gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();

          if (typed.trim() !== structure.name) {
            send(changeFor.rename(structure, typed.trim()));
          }
        }}
      >
        <label className="sr-only" htmlFor={renameId}>
          Name
        </label>
        <input
          autoComplete="off"
          className={`${fieldClass} min-w-0 flex-1`}
          data-change="name"
          disabled={!canPropose || deleted}
          id={renameId}
          maxLength={maxStructureNameLength}
          onChange={(event) => {
            clear();
            setName(event.target.value);
          }}
          type="text"
          value={typed}
        />
        <button
          className={controlClass}
          data-change="rename"
          disabled={
            !canPropose ||
            deleted ||
            typed.trim() === "" ||
            typed.trim() === structure.name
          }
          type="submit"
        >
          Rename
        </button>
      </form>
      {choose({
        label: "Shape",
        onChange: (next) => {
          Option.map(
            Arr.findFirst(shapeChoices, ({ value }) => value === next),
            ({ value }) => {
              send(changeFor.shape(structure, value));
            }
          );
        },
        options: shapeChoices,
        value: structure.shape,
      })}
      {choose({
        label: "Group",
        onChange: (next) => {
          send(changeFor.group(structure, next));
        },
        options: Arr.map(state.data.groups, ({ id, title }) => ({
          label: title,
          value: id,
        })),
        value: structure.group,
      })}
      {choose({
        label: "Status",
        onChange: (next) => {
          Option.map(
            Arr.findFirst(statusChoices, ({ value }) => value === next),
            ({ value }) => {
              send(changeFor.status(structure, value));
            }
          );
        },
        options: statusChoices,
        value: structure.status,
      })}
      {failure === undefined ? null : (
        <p
          className="border-refused border-l-2 pl-2 text-xs"
          data-change-failure
          role="alert"
        >
          {failure}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {connections === null || drafting === null ? null : (
          <button
            className={controlClass}
            data-change="draw-hop"
            disabled={!connections.canPropose || deleted}
            onClick={() => {
              drafting.begin(structure.id);
            }}
            type="button"
          >
            Draw hop from here
          </button>
        )}
        <button
          className={controlClass}
          data-change="delete"
          disabled={!canPropose || deleted}
          onClick={() => {
            send(changeFor.delete(structure));
          }}
          type="button"
        >
          Propose deleting
        </button>
      </div>
    </section>
  );
}
