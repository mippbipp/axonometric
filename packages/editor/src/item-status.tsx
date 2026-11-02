import type { ItemStatus } from "@axonometric/contracts";

import { VerdictBadge } from "./review-list.tsx";

/**
 * Where an item of the engineer's words is in its life: open and going in
 * the next batch, waiting in a batch, or reviewed with the agent's verdict.
 */
export function ItemStatusLine({ status }: { readonly status: ItemStatus }) {
  if (status.state === "open") {
    return (
      <span className="text-xs opacity-70">
        Open. It goes in the next batch.
      </span>
    );
  }

  if (status.state === "frozen") {
    return (
      <span className="text-xs opacity-70">
        In batch {status.batch}, waiting for the agent.
      </span>
    );
  }

  return <VerdictBadge verdict={status.verdict} batch={status.batch} />;
}
