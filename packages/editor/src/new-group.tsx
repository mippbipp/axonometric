import {
  maxGroupTitleLength,
  newChangeId,
  newProvisionalGroupId,
} from "@axonometric/contracts";
import { Array as Arr, Option, Result } from "effect";
import { useId, useState } from "react";

import { controlClass } from "./control-class.ts";
import { fieldClass } from "./field-class.ts";
import { useGroupOps } from "./group-ops-context.ts";
import { useSelection } from "./selection-context.ts";
import { useStructuresById } from "./structures.ts";

/**
 * The form that creates a group, in the side panel. With structures in the
 * multi-selection it proposes the group and moves each of them into it, as
 * one write. With none it proposes an empty group, which the agent adds to
 * data.mjs and which gets a zone once a structure is in it.
 */
export function NewGroupForm({ onDone }: { readonly onDone: () => void }) {
  const ops = useGroupOps();
  const { multiSelection } = useSelection();
  const byId = useStructuresById();
  const titleId = useId();
  const [title, setTitle] = useState("");
  const [failure, setFailure] = useState<string | undefined>();
  const [sending, setSending] = useState(false);

  const members = Arr.filter(
    Arr.map([...multiSelection], (id) => byId.get(id)),
    (found) => found !== undefined
  );

  const trimmed = title.trim();

  return (
    <form
      data-new-group
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();

        if (ops === null || trimmed === "" || sending) {
          return;
        }

        setSending(true);
        setFailure(undefined);
        ops.propose(
          {
            action: "add",
            group: { id: newProvisionalGroupId(trimmed), title: trimmed },
          },
          Arr.map(members, ({ id }) => ({ id: newChangeId(), structure: id })),
          (outcome) => {
            setSending(false);

            const why = Option.getOrUndefined(Result.getFailure(outcome));

            setFailure(why);

            if (why === undefined) {
              onDone();
            }
          }
        );
      }}
    >
      <label htmlFor={titleId} className="text-xs opacity-70">
        Group title
      </label>
      <input
        id={titleId}
        data-new-group-title
        type="text"
        value={title}
        maxLength={maxGroupTitleLength}
        autoComplete="off"
        className={fieldClass}
        onChange={(event) => {
          setFailure(undefined);
          setTitle(event.target.value);
        }}
      />
      <p data-new-group-members className="text-xs opacity-70">
        {members.length === 0
          ? "No structures are selected, so the group starts empty."
          : `Moves ${Arr.join(
              Arr.map(members, ({ name }) => name),
              ", "
            )} into it.`}
      </p>
      {failure === undefined ? null : (
        <p
          role="alert"
          data-new-group-failure
          className="border-refused border-l-2 pl-2 text-xs"
        >
          {failure}
        </p>
      )}
      <div className="flex gap-1.5">
        <button
          type="submit"
          data-new-group-submit
          className={controlClass}
          disabled={trimmed === "" || sending || ops?.canPropose !== true}
        >
          {members.length === 0 ? "Create empty group" : "Create group"}
        </button>
        <button type="button" className={controlClass} onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
