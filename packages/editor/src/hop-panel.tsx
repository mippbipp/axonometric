import { Array as Arr, Option, Record as Rec } from "effect";
import { useState } from "react";

import { useConnections } from "./connections-context.ts";
import { controlClass } from "./control-class.ts";
import { pendingHops, useEditing } from "./editing-context.ts";
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
  const connections = useConnections();
  const proposals = useHopProposals(id);
  const [refusal, setRefusal] = useState<string | undefined>();

  const hops = connections?.proposed.state.data.hops ?? state.data.hops;

  const hop = Arr.findFirst(hops, (item) => item.id === id).pipe(
    Option.getOrUndefined
  );

  if (hop === undefined) {
    return null;
  }

  const { from, to, label } = hop;
  const nameOf = (structure: string) => byId.get(structure)?.name ?? structure;
  const overridden = Rec.has(state.layout.routes ?? {}, id);
  const removed = proposals?.deleted === true;
  const pending = pendingHops(editing).has(id);

  return (
    <section data-hop-panel={id} className="flex flex-col gap-3">
      <p className="text-xs tracking-widest uppercase opacity-70">Hop</p>
      <h2 className="text-lg leading-tight font-medium">{label}</h2>
      <p className="text-sm">
        {nameOf(from)} → {nameOf(to)}
      </p>
      {removed ? (
        <p data-hop-deleting className="border-refused border-l-2 pl-2 text-sm">
          Proposed for deletion: it stays on the map, crossed out, until the
          agent has reviewed it.
        </p>
      ) : null}
      <p data-hop-route-kind className="text-sm opacity-80">
        {overridden
          ? `This route is set by hand${pending ? " and not yet accepted" : ""}.`
          : pending
            ? "This hop is set to route itself, and that is not yet accepted."
            : "This route is worked out from the layout."}
      </p>
      {editing?.canEdit === true ? (
        <p className="text-xs opacity-70">
          Drag a segment of the arrow to move it. It snaps to half units.
        </p>
      ) : null}
      <HopEdit id={id} label={label} />
      <NotesSection target={{ kind: "hop", id }} />
      {refusal === undefined ? null : (
        <p
          data-reset-refused
          className="border-refused border-l-2 pl-2 text-xs"
        >
          {refusal}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {editing?.canEdit === true && overridden ? (
          <button
            type="button"
            data-reset-route={id}
            className={controlClass}
            onClick={() => {
              setRefusal(editing.reroute(id, null));
            }}
          >
            Reset route
          </button>
        ) : null}
        <button
          type="button"
          data-control="close"
          className={controlClass}
          onClick={() => {
            selectHop(null);
          }}
        >
          Close
        </button>
      </div>
    </section>
  );
}
