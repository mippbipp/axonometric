import type {
  ChangeId,
  ChapterChange,
  ChapterProposal,
} from "@axonometric/contracts";
import { createContext, use } from "react";

import type { ReviewDone } from "./served-store.ts";

/**
 * Proposing changes to what a chapter reveals and plays. The read-only file
 * has none, so no control shows there.
 */
export interface ChapterOps {
  /** Whether writes can be sent now. False while the server is down. */
  readonly canPropose: boolean;
  /** The open chapter proposals: those not in a batch yet. */
  readonly open: readonly ChapterProposal[];
  /** Proposes `change`; `done` gets the proposal's id, or why it was refused. */
  readonly propose: (change: ChapterChange, done: ReviewDone<ChangeId>) => void;
  /** Removes an open chapter proposal. */
  readonly discard: (id: ChangeId, done: ReviewDone<ChangeId>) => void;
}

export const ChapterOpsContext = createContext<ChapterOps | null>(null);

/** The chapter proposals, or `null` on a page that can't propose. */
export const useChapterOps = (): ChapterOps | null => use(ChapterOpsContext);
