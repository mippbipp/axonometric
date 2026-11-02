import { hopOf, removedHopMark, marked } from "@axonometric/contracts";
import type { HopChange, HopProposal } from "@axonometric/contracts";
import type { Option } from "effect";
import { Array as Arr } from "effect";

import { useConnections } from "./connections-context.ts";
import { useReview } from "./review-context.ts";

/** What the page knows about the proposals on one hop. */
export interface HopProposals {
  /** The open proposals that draw, relabel or delete the hop. */
  readonly open: readonly HopProposal[];
  /** Whether the hop is proposed for deletion, open or waiting in a batch. */
  readonly deleted: boolean;
  /** Whether the hop is only proposed: data.mjs has no such hop yet. */
  readonly drawn: boolean;
  /** The open proposal that deletes the hop, if any. */
  readonly deletion: Option.Option<HopProposal>;
  /** The open proposal that relabels the hop, if any. */
  readonly relabel: Option.Option<HopProposal>;
}

const actsOn = (id: string) => (change: HopChange) => hopOf(change) === id;

/** The proposals on hop `id`, from the open list and the frozen batches. */
export const useHopProposals = (id: string): HopProposals | null => {
  const connections = useConnections();
  const review = useReview();

  if (connections === null) {
    return null;
  }

  const open = Arr.filter(
    Arr.flatMap(review?.entries ?? [], ({ item, status }) =>
      item.kind === "hop" && status.state === "open"
        ? [{ id: item.id, change: item.change }]
        : []
    ),
    ({ change }) => actsOn(id)(change)
  );

  return {
    open,
    deleted: marked(connections.proposed, removedHopMark).has(id),
    drawn: Arr.some(open, ({ change }) => change.action === "add"),
    deletion: Arr.findFirst(open, ({ change }) => change.action === "delete"),
    relabel: Arr.findFirst(open, ({ change }) => change.action === "relabel"),
  };
};
