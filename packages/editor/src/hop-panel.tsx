import { Array as Arr, Option, Record as Rec } from "effect";
import { useState } from "react";

import { useProposedHopsIgnoringEdit } from "./connections-context.ts";
import { controlClass } from "./control-class.ts";
import {
  pendingHops,
  useEditing,
  useEditingIgnoringEdit,
} from "./editing-context.ts";
import { HopEdit } from "./hop-edit.tsx";
import { useHopProposals } from "./hop-proposals.ts";
import { NotesSection } from "./notes-section.tsx";
import { useSelection } from "./selection-context.ts";
import { useStructuresById } from "./structures.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/**
 * The pinned hop in the side panel: where it runs, whether its route is
 * automatic or an override, and, while the page can edit, "Reset route"
 * for an override. Dragging a segment of the hop on the map sets the
 * override.
 */
export function HopPanel({ id }: { readonly id: string }) {
  const { state } = useWalkthrough();
  const { selectHop } = useSelection();
  const byId = useStructuresById();
  const editing = useEditing();
  const editingIgnoringEdit = useEditingIgnoringEdit();
  const proposedHops = useProposedHopsIgnoringEdit();
  const proposals = useHopProposals(id);
  const [refusal, setRefusal] = useState<string | undefined>();

  const hops = proposedHops?.state.data.hops ?? state.data.hops;

  const hop = Arr.findFirst(hops, (item) => item.id === id).pipe(
    Option.getOrUndefined
  );

  if (hop === undefined) {
    return null;
  }

  const { from, label, to } = hop;
  const nameOf = (structure: string) => byId.get(structure)?.name ?? structure;
  const overridden = Rec.has(state.layout.routes ?? {}, id);
  const removed = proposals?.deleted === true;
  const pending = pendingHops(editingIgnoringEdit).has(id);

  return (
    <section className="flex flex-col gap-3" data-hop-panel={id}>
      <p className="text-xs tracking-widest uppercase opacity-70">Hop</p>
      <h2 className="text-lg leading-tight font-medium">{label}</h2>
      <p className="text-sm">
        {nameOf(from)} → {nameOf(to)}
      </p>
      <p className="text-sm opacity-80" data-hop-route-kind>
        {overridden
          ? `This route is set by hand${pending ? " and not yet accepted" : ""}.`
          : pending
            ? "This hop is set to route itself, and that is not yet accepted."
            : "This route is worked out from the layout."}
      </p>
      {editing?.canEdit === true && !removed ? (
        <p className="text-xs opacity-70">
          Drag a segment of the arrow to move it. It snaps to half units.
        </p>
      ) : null}
      <HopEdit id={id} label={label} />
      <NotesSection target={{ id, kind: "hop" }} />
      {refusal === undefined ? null : (
        <p
          className="border-refused border-l-2 pl-2 text-xs"
          data-reset-refused
        >
          {refusal}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {editing?.canEdit === true && overridden && !removed ? (
          <button
            className={controlClass}
            data-reset-route={id}
            onClick={() => {
              setRefusal(editing.reroute(id, null));
            }}
            type="button"
          >
            Reset route
          </button>
        ) : null}
        <button
          className={controlClass}
          data-control="close"
          onClick={() => {
            selectHop(null);
          }}
          type="button"
        >
          Close
        </button>
      </div>
    </section>
  );
}
