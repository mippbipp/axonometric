import {
  marked,
  maxStructureNameLength,
  removedMark,
} from "@axonometric/contracts";
import type { Structure } from "@axonometric/contracts";
import { Array as Arr, Option } from "effect";
import { useId, useState } from "react";

import { useConnections } from "./connections-context.ts";
import { controlClass } from "./control-class.ts";
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
  const { send, failure, clear, canPropose } = usePropose();
  const renameId = useId();
  const [name, setName] = useState<string | undefined>();

  if (proposing === null) {
    return null;
  }

  const deleted = marked(proposing.proposed, removedMark).has(structure.id);
  const typed = name ?? structure.name;

  const choose = ({
    label,
    value,
    options,
    onChange,
  }: {
    readonly label: string;
    readonly value: string;
    readonly options: readonly { value: string; label: string }[];
    readonly onChange: (next: string) => void;
  }) => (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="opacity-70">{label}</span>
      <select
        data-change={label.toLowerCase()}
        className={fieldClass}
        value={value}
        disabled={!canPropose || deleted}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {Arr.map(options, (option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <section data-change-structure className="flex flex-col gap-2">
      <h3 className="text-xs tracking-widest uppercase opacity-70">
        Propose a change
      </h3>
      {deleted ? (
        <p data-deleting className="border-refused border-l-2 pl-2 text-xs">
          Proposed for deletion. It stays on the map, crossed out, until the
          agent has reviewed it.
        </p>
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
        <label htmlFor={renameId} className="sr-only">
          Name
        </label>
        <input
          id={renameId}
          data-change="name"
          type="text"
          value={typed}
          maxLength={maxStructureNameLength}
          autoComplete="off"
          disabled={!canPropose || deleted}
          className={`${fieldClass} min-w-0 flex-1`}
          onChange={(event) => {
            clear();
            setName(event.target.value);
          }}
        />
        <button
          type="submit"
          data-change="rename"
          className={controlClass}
          disabled={
            !canPropose ||
            deleted ||
            typed.trim() === "" ||
            typed.trim() === structure.name
          }
        >
          Rename
        </button>
      </form>
      {choose({
        label: "Shape",
        value: structure.shape,
        options: shapeChoices,
        onChange: (next) => {
          Option.map(
            Arr.findFirst(shapeChoices, ({ value }) => value === next),
            ({ value }) => {
              send(changeFor.shape(structure, value));
            }
          );
        },
      })}
      {choose({
        label: "Group",
        value: structure.group,
        options: Arr.map(state.data.groups, ({ id, title }) => ({
          value: id,
          label: title,
        })),
        onChange: (next) => {
          send(changeFor.group(structure, next));
        },
      })}
      {choose({
        label: "Status",
        value: structure.status,
        options: statusChoices,
        onChange: (next) => {
          Option.map(
            Arr.findFirst(statusChoices, ({ value }) => value === next),
            ({ value }) => {
              send(changeFor.status(structure, value));
            }
          );
        },
      })}
      {failure === undefined ? null : (
        <p
          role="alert"
          data-change-failure
          className="border-refused border-l-2 pl-2 text-xs"
        >
          {failure}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {connections === null || drafting === null ? null : (
          <button
            type="button"
            data-change="draw-hop"
            className={controlClass}
            disabled={!connections.canPropose || deleted}
            onClick={() => {
              drafting.begin(structure.id);
            }}
          >
            Draw hop from here
          </button>
        )}
        <button
          type="button"
          data-change="delete"
          className={controlClass}
          disabled={!canPropose || deleted}
          onClick={() => {
            send(changeFor.delete(structure));
          }}
        >
          Propose deleting
        </button>
      </div>
    </section>
  );
}
