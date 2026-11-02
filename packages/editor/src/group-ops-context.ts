import type {
  ChangeId,
  GroupChange,
  GroupProposal,
} from "@axonometric/contracts";
import { createContext, use } from "react";

import type { ReviewDone } from "./served-store.ts";

/** A structure that moves into a new group, with the id of its group change. */
export interface GroupMember {
  readonly id: ChangeId;
  readonly structure: string;
}

/**
 * Proposing groups. The read-only file has none, so no group control shows
 * there and nothing here reaches an export.
 */
export interface GroupOps {
  /** Whether writes can be sent now. False while the server is down. */
  readonly canPropose: boolean;
  /** The open group proposals: those not in a batch yet. */
  readonly open: readonly GroupProposal[];
  /**
   * Proposes a new group, or a new title for one. `members` are the
   * structures that go into a new group, each moved by a group change the
   * server adds in the same write.
   */
  readonly propose: (
    change: GroupChange,
    members: readonly GroupMember[],
    done: ReviewDone<ChangeId>
  ) => void;
  /** Removes an open group proposal, and the moves into it. */
  readonly discard: (id: ChangeId, done: ReviewDone<ChangeId>) => void;
}

export const GroupOpsContext = createContext<GroupOps | null>(null);

/** The group proposals, or `null` on a page that can't propose. */
export const useGroupOps = (): GroupOps | null => use(GroupOpsContext);
