import type {
  ChangeId,
  DraggedProblem,
  FlowChange,
  HopChange,
  ProposedMap,
} from "@axonometric/contracts";
import { createContext, use } from "react";

import { useWhileEditOn } from "./edit-context.ts";
import type { ReviewDone } from "./served-store.ts";

/**
 * Hop and flow proposals on the page. The read-only file has none, so
 * nothing here reaches an export.
 */
export interface Connections {
  /** Whether writes can be sent now. False while the server is down. */
  readonly canPropose: boolean;
  /** Removes the open proposal with this id. */
  readonly discard: (id: ChangeId, done: ReviewDone<ChangeId>) => void;
  /** What `check` would report for the proposed map with the hop change added. */
  readonly problemsOfHop: (change: HopChange) => ReadonlyArray<DraggedProblem>;
  /** The map as proposed; see `proposedMap`. */
  readonly proposed: ProposedMap;
  /** Proposes a flow change; `done` gets the proposal's id, or why it was refused. */
  readonly proposeFlow: (
    change: FlowChange,
    done: ReviewDone<ChangeId>
  ) => void;
  /** Proposes a hop change; `done` gets the proposal's id, or why it was refused. */
  readonly proposeHop: (change: HopChange, done: ReviewDone<ChangeId>) => void;
  /** Why `change` would be refused, or `undefined`. */
  readonly refusalOfFlow: (change: FlowChange) => string | undefined;
  /** Why `change` would be refused, or `undefined`. */
  readonly refusalOfHop: (change: HopChange) => string | undefined;
}

export const ConnectionsContext = createContext<Connections | null>(null);

/**
 * The hop and flow proposals, or `null` on a page that can't propose or
 * while Edit is off. Controls read this one.
 */
export const useConnections = (): Connections | null =>
  useWhileEditOn(use(ConnectionsContext));

/**
 * The map as proposed, whether or not Edit is on, for the marks the page
 * draws on proposed hops. It gives no reason to draw a control.
 */
export const useProposedHopsIgnoringEdit = (): ProposedMap | undefined =>
  use(ConnectionsContext)?.proposed;
