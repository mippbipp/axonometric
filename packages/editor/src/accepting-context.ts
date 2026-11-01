import type { ChangeId } from "@axonometric/contracts";
import type { Array as Arr } from "effect";
import { createContext, use } from "react";

/**
 * Accepting pending layout changes, for a page that `serve` serves. The
 * read-only file has no `AcceptingContext`, so it shows no Accept buttons.
 */
export interface Accepting {
  /** Whether an accept can be sent now. False while the server is down. */
  readonly canAccept: boolean;
  /** Whether an accept is waiting for, or on its way to, the server. */
  readonly busy: boolean;
  /**
   * Accepts the pending layout changes with these ids, or all of them, as one
   * revision. An empty `message` has the server write one from the changes.
   * The outcome shows as the revision just saved, or as a notice.
   */
  readonly accept: (
    ids: "all" | Arr.NonEmptyReadonlyArray<ChangeId>,
    message: string
  ) => void;
}

export const AcceptingContext = createContext<Accepting | null>(null);

/** The accepting state, or `null` on a page that can't accept. */
export const useAccepting = (): Accepting | null => use(AcceptingContext);
