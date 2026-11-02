import type {
  ChangeId,
  DraggedProblem,
  Placement,
  ProposedMap,
  StructureChange,
  StructureProposal,
} from "@axonometric/contracts";
import { createContext, use } from "react";

import type { ReviewDone } from "./served-store.ts";

/**
 * The structure proposals on the page. The read-only file has none: it shows
 * the accepted map alone, so nothing here reaches an export.
 */
export interface ProposedStructures {
  /** The map as proposed; see `proposedMap`. */
  readonly proposed: ProposedMap;
  /** Whether writes can be sent now. False while the server is down. */
  readonly canPropose: boolean;
  /** The open proposals: those not in a batch yet. */
  readonly open: readonly StructureProposal[];
  /**
   * A structure's name before any proposal renames it, or the name a new
   * structure was proposed under.
   */
  readonly nameOf: (id: string) => string;
  /** Proposes `change`; `done` gets the proposal's id, or why it was refused. */
  readonly propose: (
    change: StructureChange,
    done: ReviewDone<ChangeId>
  ) => void;
  /** Why `change` would be refused, or `undefined`. */
  readonly refusalOf: (change: StructureChange) => string | undefined;
  /**
   * What `check` would report for the map as proposed with `changes` added,
   * each marked new when the map as proposed now didn't have it.
   */
  readonly problemsOf: (
    changes: readonly StructureChange[],
    /** Structures moved first, such as the one a drop just moved, by id. */
    moved?: Readonly<Record<string, Placement>>
  ) => readonly DraggedProblem[];
  /** Whether `id` is a structure the engineer proposed and hasn't sent yet. */
  readonly isOpenAdd: (id: string) => boolean;
  /** Why putting the proposed structure `id` at `next` would be refused. */
  readonly refusalOfPlace: (id: string, next: Placement) => string | undefined;
  /** Puts the structure the engineer proposed at `next`. */
  readonly place: (
    id: string,
    next: Placement,
    done: ReviewDone<ChangeId>
  ) => string | undefined;
  /** Removes the open proposal with this id. */
  readonly discard: (id: ChangeId, done: ReviewDone<ChangeId>) => void;
}

export const ProposedContext = createContext<ProposedStructures | null>(null);

/** The structure proposals, or `null` on a page that can't propose. */
export const useProposed = (): ProposedStructures | null =>
  use(ProposedContext);
