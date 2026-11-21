import { maxGroupTitleLength } from "@axonometric/contracts";
import type { BatchItem, CheckScope, Group } from "@axonometric/contracts";
import { Button } from "@axonometric/ui/components/button";
import { Input } from "@axonometric/ui/components/input";
import { Array as Arr } from "effect";
import { useMemo, useState } from "react";

import { uiControlClass } from "./control-class.ts";
import { LabelledField } from "./labelled-field.tsx";
import { groupItem } from "./proposal-items.ts";
import { useGroupOps } from "./proposal-ops-context.ts";
import { useSelection } from "./selection-context.ts";
import { useItemPreview } from "./use-propose-item.ts";
import { useSending } from "./use-sending.ts";
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
  const { stop } = useWalkthrough();
  const [typed, setTyped] = useState<string | undefined>();
  const { clear, failure, run } = useSending();

  const members = Arr.filter(
    state.data.structures,
    (structure) => structure.group === group.id
  );

  const title = typed ?? group.title;

  // While the title is edited the panel shows what the rename would add to
  // `check`'s report, judged on the chapter being viewed.
  const wanted = typed?.trim();

  const preview = useMemo(
    (): ReadonlyArray<BatchItem> =>
      wanted === undefined || wanted === "" || wanted === group.title
        ? []
        : [groupItem({ action: "rename", group: group.id, title: wanted })],
    [wanted, group.id, group.title]
  );

  const scope = useMemo(
    (): CheckScope => ({ chapter: stop.id, of: "chapter" }),
    [stop.id]
  );

  const { keep } = useItemPreview(preview, scope);

  const canSubmit =
    ops?.canPropose === true &&
    title.trim() !== "" &&
    title.trim() !== group.title;

  return (
    <section
      className="flex flex-col gap-3"
      data-group-panel={group.id}
      data-pinned
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
          className="flex flex-col gap-2"
          data-rename-group
          onSubmit={(event) => {
            event.preventDefault();

            if (!canSubmit) {
              return;
            }

            keep();
            run((finish) => {
              ops.propose(
                { action: "rename", group: group.id, title: title.trim() },
                [],
                finish
              );
            });
          }}
        >
          <LabelledField
            disabled={!ops.canPropose}
            failure={failure}
            failureProps={{ "data-group-failure": "" }}
            label="Title"
          >
            <div className="flex gap-1.5">
              <Input
                autoComplete="off"
                data-group-title
                maxLength={maxGroupTitleLength}
                onValueChange={(next) => {
                  clear();
                  setTyped(next);
                }}
                value={title}
              />
              <Button
                className={uiControlClass}
                data-group-rename
                disabled={!canSubmit}
                type="submit"
              >
                Rename
              </Button>
            </div>
          </LabelledField>
        </form>
      )}
      <div className="flex gap-1.5">
        <Button
          className={uiControlClass}
          data-control="unpin"
          onClick={() => {
            selectGroup(null);
          }}
        >
          Unpin
        </Button>
      </div>
    </section>
  );
}
