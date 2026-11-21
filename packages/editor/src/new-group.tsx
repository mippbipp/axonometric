import {
  maxGroupTitleLength,
  newChangeId,
  newProvisionalGroupId,
} from "@axonometric/contracts";
import type {
  BatchItem,
  CheckScope,
  GroupChange,
} from "@axonometric/contracts";
import { Button } from "@axonometric/ui/components/button";
import { Input } from "@axonometric/ui/components/input";
import { Array as Arr } from "effect";
import { useMemo, useState } from "react";

import { uiControlClass } from "./control-class.ts";
import { LabelledField } from "./labelled-field.tsx";
import { groupItem, structureItem } from "./proposal-items.ts";
import { useGroupOps } from "./proposal-ops-context.ts";
import { useSelection } from "./selection-context.ts";
import { useStructuresById } from "./structures.ts";
import { useItemPreview } from "./use-propose-item.ts";
import { useSending } from "./use-sending.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

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
  const { stop } = useWalkthrough();
  const [title, setTitle] = useState("");
  const { clear, failure, run, sending } = useSending();

  const members = useMemo(
    () =>
      Arr.filter(
        Arr.map([...multiSelection], (id) => byId.get(id)),
        (found) => found !== undefined
      ),
    [multiSelection, byId]
  );

  const trimmed = title.trim();

  // The id the group will be sent under, made once per title, so the warnings
  // while the form is open read as they do after it is sent.
  const groupId = useMemo(
    () => (trimmed === "" ? "" : newProvisionalGroupId(trimmed)),
    [trimmed]
  );

  // While the form is open the panel shows what the group would add to
  // `check`'s report, judged on the chapter being viewed: a zone round the
  // members, and the new group's own.
  const preview = useMemo((): ReadonlyArray<BatchItem> => {
    const moves = Arr.map(members, ({ id }) =>
      structureItem({ action: "group", group: groupId, structure: id })
    );

    return trimmed === ""
      ? []
      : [
          groupItem({ action: "add", group: { id: groupId, title: trimmed } }),
          ...moves,
        ];
  }, [trimmed, groupId, members]);

  const scope = useMemo(
    (): CheckScope => ({ chapter: stop.id, of: "chapter" }),
    [stop.id]
  );

  const { keep } = useItemPreview(preview, scope);

  return (
    <form
      className="flex flex-col gap-2"
      data-new-group
      onSubmit={(event) => {
        event.preventDefault();

        if (ops === null || trimmed === "" || sending) {
          return;
        }

        const added: GroupChange = {
          action: "add",
          group: { id: groupId, title: trimmed },
        };

        keep();
        run((finish) => {
          ops.propose(
            added,
            Arr.map(members, ({ id }) => ({
              id: newChangeId(),
              structure: id,
            })),
            finish
          );
        }, onDone);
      }}
    >
      <LabelledField
        failure={failure}
        failureProps={{ "data-new-group-failure": "" }}
        label="Group title"
      >
        <Input
          autoComplete="off"
          data-new-group-title
          maxLength={maxGroupTitleLength}
          onValueChange={(next) => {
            clear();
            setTitle(next);
          }}
          value={title}
        />
      </LabelledField>
      <p className="text-xs opacity-70" data-new-group-members>
        {members.length === 0
          ? "No structures are selected, so the group starts empty."
          : `Moves ${Arr.join(
              Arr.map(members, ({ name }) => name),
              ", "
            )} into it.`}
      </p>
      <div className="flex gap-1.5">
        <Button
          className={uiControlClass}
          data-new-group-submit
          disabled={trimmed === "" || sending || ops?.canPropose !== true}
          type="submit"
        >
          {members.length === 0 ? "Create empty group" : "Create group"}
        </Button>
        <Button className={uiControlClass} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
