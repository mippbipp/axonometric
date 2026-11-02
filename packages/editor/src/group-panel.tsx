import { maxGroupTitleLength } from "@axonometric/contracts";
import type { Group } from "@axonometric/contracts";
import { Array as Arr, Option, Result } from "effect";
import { useId, useState } from "react";

import { controlClass } from "./control-class.ts";
import { fieldClass } from "./field-class.ts";
import { useGroupOps } from "./group-ops-context.ts";
import { useSelection } from "./selection-context.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/**
 * The pinned group's panel: its title, a form to rename it, and the
 * structures in it. A rename is a proposal the agent reviews, so the zone
 * shows in the pending look until then. Only a page that can write has the
 * form.
 */
export function GroupPanel({ group }: { readonly group: Group }) {
  const ops = useGroupOps();
  const { state } = useWalkthrough();
  const { selectGroup } = useSelection();
  const titleId = useId();
  const [typed, setTyped] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | undefined>();

  const members = Arr.filter(
    state.data.structures,
    (structure) => structure.group === group.id
  );

  const title = typed ?? group.title;

  const canSubmit =
    ops?.canPropose === true &&
    title.trim() !== "" &&
    title.trim() !== group.title;

  return (
    <section
      data-group-panel={group.id}
      data-pinned
      className="flex flex-col gap-3"
    >
      <p className="text-xs tracking-widest uppercase opacity-70">
        Group · Pinned
      </p>
      <h2 className="text-lg leading-tight font-medium">{group.title}</h2>
      <p className="text-sm opacity-80">
        {members.length === 0
          ? "No structures yet. A zone is drawn once a structure is in it."
          : `${members.length} ${members.length === 1 ? "structure" : "structures"}: ${Arr.join(
              Arr.map(members, ({ name }) => name),
              ", "
            )}`}
      </p>
      {ops === null ? null : (
        <form
          data-rename-group
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();

            if (!canSubmit) {
              return;
            }

            setFailure(undefined);
            ops.propose(
              { action: "rename", group: group.id, title: title.trim() },
              [],
              (outcome) => {
                setFailure(Option.getOrUndefined(Result.getFailure(outcome)));
              }
            );
          }}
        >
          <label htmlFor={titleId} className="text-xs opacity-70">
            Title
          </label>
          <div className="flex gap-1.5">
            <input
              id={titleId}
              data-group-title
              type="text"
              value={title}
              maxLength={maxGroupTitleLength}
              autoComplete="off"
              disabled={!ops.canPropose}
              className={`${fieldClass} min-w-0 flex-1`}
              onChange={(event) => {
                setFailure(undefined);
                setTyped(event.target.value);
              }}
            />
            <button
              type="submit"
              data-group-rename
              className={controlClass}
              disabled={!canSubmit}
            >
              Rename
            </button>
          </div>
          {failure === undefined ? null : (
            <p
              role="alert"
              data-group-failure
              className="border-refused border-l-2 pl-2 text-xs"
            >
              {failure}
            </p>
          )}
        </form>
      )}
      <div className="flex gap-1.5">
        <button
          type="button"
          data-control="unpin"
          className={controlClass}
          onClick={() => {
            selectGroup(null);
          }}
        >
          Unpin
        </button>
      </div>
    </section>
  );
}
