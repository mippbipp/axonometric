import type {
  ChangeId,
  DraggedProblem,
  FlowChange,
  HopChange,
  ProposedMap,
} from "@axonometric/contracts";
import { createContext, use } from "react";

import type { ReviewDone } from "./served-store.ts";

/**
 * Hop and flow proposals on the page. The read-only file has none, so
 * nothing here reaches an export.
 */
export interface Connections {
  /** The map as proposed; see `proposedMap`. */
  readonly proposed: ProposedMap;
  /** Whether writes can be sent now. False while the server is down. */
  readonly canPropose: boolean;
  /** Proposes a hop change; `done` gets the proposal's id, or why it was refused. */
  readonly proposeHop: (change: HopChange, done: ReviewDone<ChangeId>) => void;
  /** Why `change` would be refused, or `undefined`. */
  readonly refusalOfHop: (change: HopChange) => string | undefined;
  /** Proposes a flow change; `done` gets the proposal's id, or why it was refused. */
  readonly proposeFlow: (
    change: FlowChange,
    done: ReviewDone<ChangeId>
  ) => void;
  /** Why `change` would be refused, or `undefined`. */
  readonly refusalOfFlow: (change: FlowChange) => string | undefined;
  /** What `check` would report for the proposed map with the hop change added. */
  readonly problemsOfHop: (change: HopChange) => readonly DraggedProblem[];
  /** The ids the agent gave hops the engineer drew, by provisional id. */
  readonly hopRenames: ReadonlyMap<string, string>;
  /** Removes the open proposal with this id. */
  readonly discard: (id: ChangeId, done: ReviewDone<ChangeId>) => void;
}

export const ConnectionsContext = createContext<Connections | null>(null);

/** The hop and flow proposals, or `null` on a page that can't propose. */
export const useConnections = (): Connections | null => use(ConnectionsContext);
