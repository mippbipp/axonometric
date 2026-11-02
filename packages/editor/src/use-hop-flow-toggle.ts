import { hopsWith } from "@axonometric/contracts";
import { Array as Arr, Option, Result } from "effect";
import { useState } from "react";

import { useConnections } from "./connections-context.ts";

/**
 * Puts hop `hop` in a flow or takes it out, as a proposal of the flow's whole
 * ordered list of hops, so the order of the others is kept. The panel's
 * checkboxes and the context menu's both use it. `failure` is why the last
 * try was refused, in the words of the contracts.
 */
export const useHopFlowToggle = (hop: string) => {
  const connections = useConnections();
  const [failure, setFailure] = useState<string | undefined>();

  const toggle = (flowId: string, wanted: boolean) => {
    const flow = Arr.findFirst(
      connections?.proposed.state.data.flows ?? [],
      ({ id }) => id === flowId
    );

    if (connections === null || Option.isNone(flow)) {
      return;
    }

    const hops = hopsWith({ flow: flow.value, hop, wanted });

    // A flow with no hop left is deleted by the agent, not by a proposal.
    if (Option.isNone(hops)) {
      setFailure(
        `"${flow.value.name}" would be left with no hops. A flow lists at least one.`
      );

      return;
    }

    const change = {
      action: "hops" as const,
      flow: flowId,
      hops: hops.value,
    };

    const refusal = connections.refusalOfFlow(change);

    if (refusal !== undefined) {
      setFailure(refusal);

      return;
    }

    setFailure(undefined);
    connections.proposeFlow(change, (outcome) => {
      setFailure(Option.getOrUndefined(Result.getFailure(outcome)));
    });
  };

  return { toggle, failure };
};
