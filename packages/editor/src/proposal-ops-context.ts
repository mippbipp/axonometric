import type {
  Chapter,
  ChangeId,
  ChapterChange,
  ChapterProposal,
  GroupChange,
  GroupProposal,
  ProposedMap,
} from "@axonometric/contracts";
import { createContext, use } from "react";

import type { ReviewDone } from "./served-store.ts";

/** A structure that moves into a new group, with the id of its group change. */
export interface GroupMember {
  readonly id: ChangeId;
  readonly structure: string;
}

/** Proposing groups. */
export interface GroupOps {
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

/** Proposing changes to what a chapter reveals and plays. */
export interface ChapterOps {
  /** The open chapter proposals: those not in a batch yet. */
  readonly open: readonly ChapterProposal[];
  /** Proposes `change`; `done` gets the proposal's id, or why it was refused. */
  readonly propose: (change: ChapterChange, done: ReviewDone<ChangeId>) => void;
  /** Removes an open chapter proposal. */
  readonly discard: (id: ChangeId, done: ReviewDone<ChangeId>) => void;
}

/**
 * The group and chapter proposals on the page, in one context because they
 * come and go together: the served page has all of them, and the read-only
 * file and a past revision have none, so nothing here reaches an export.
 */
export interface ProposalOps {
  /** Whether writes can be sent now. False while the server is down. */
  readonly canPropose: boolean;
  readonly groups: GroupOps;
  readonly chapters: ChapterOps;
  /** The map as proposed, whose marks say which chapter a proposal looks pending in. */
  readonly proposed: Pick<ProposedMap, "marks">;
  /**
   * The accepted map's chapters, before any proposal reorders or changes
   * them, to tell which rows of a chapter's plays a proposal moved.
   */
  readonly acceptedChapters: readonly Pick<Chapter, "id" | "plays">[];
}

export const ProposalOpsContext = createContext<ProposalOps | null>(null);

/** The group and chapter proposals, or `null` on a page that can't propose. */
export const useProposalOps = (): ProposalOps | null => use(ProposalOpsContext);

/** The group proposals, or `null` on a page that can't propose. */
export const useGroupOps = (): (GroupOps & { canPropose: boolean }) | null => {
  const ops = useProposalOps();

  return ops === null ? null : { ...ops.groups, canPropose: ops.canPropose };
};

/** The chapter proposals, or `null` on a page that can't propose. */
export const useChapterOps = ():
  | (ChapterOps & { canPropose: boolean })
  | null => {
  const ops = useProposalOps();

  return ops === null ? null : { ...ops.chapters, canPropose: ops.canPropose };
};
