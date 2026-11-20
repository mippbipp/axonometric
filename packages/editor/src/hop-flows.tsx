import { flowsOfHop } from "@axonometric/contracts";
import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr } from "effect";

import { useConnections } from "./connections-context.ts";
import { useHopProposals } from "./hop-proposals.ts";
import { useHopFlowToggle } from "./use-hop-flow-toggle.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/**
 * The flows a hop is in, as checkboxes: one or more. Ticking a flow adds the
 * hop at the end of its list; clearing one takes it out. Each change
 * proposes the flow's whole ordered list of hops, so the order of the other
 * hops is kept.
 */
export function HopFlows({ hop }: { readonly hop: string }) {
  const connections = useConnections();
  const proposals = useHopProposals(hop);
  const { state } = useWalkthrough();
  const { failure, toggle } = useHopFlowToggle(hop);

  if (connections === null) {
    return null;
  }

  const { flows } = connections.proposed.state.data;

  if (flows.length === 0) {
    return null;
  }

  const inFlows = flowsOfHop(connections.proposed.state.data, hop);

  // A hop proposed for deletion keeps the flows it has until the agent decides.
  const canEdit = connections.canPropose && proposals?.deleted !== true;
  const accepted = new Set(Arr.map(state.data.flows, ({ id }) => id));

  return (
    <fieldset className="flex flex-col gap-1" data-hop-flows={hop}>
      <legend className="text-xs tracking-widest uppercase opacity-70">
        Flows
      </legend>
      <ul className="flex flex-col gap-1">
        {Arr.map(flows, ({ id, name }) => (
          <li key={id}>
            <label
              className={cn(
                "flex items-center gap-2 text-sm",
                canEdit ? "cursor-pointer" : "opacity-60"
              )}
            >
              <input
                checked={inFlows.includes(id)}
                data-hop-flow={id}
                disabled={!canEdit}
                onChange={(event) => {
                  toggle(id, event.target.checked);
                }}
                type="checkbox"
              />
              <span className="min-w-0 break-words">{name}</span>
              {accepted.has(id) ? null : (
                <span className="text-2xs opacity-70">(proposed)</span>
              )}
            </label>
          </li>
        ))}
      </ul>
      {failure === undefined ? null : (
        <p
          className="border-refused border-l-2 pl-2 text-xs"
          data-hop-flows-failure
        >
          {failure}
        </p>
      )}
    </fieldset>
  );
}
