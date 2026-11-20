import type {
  BatchItem,
  ChangeId,
  CheckScope,
  DraggedProblem,
  Placement,
  ProposedMap,
  StructureChange,
  StructureProposal,
} from "@axonometric/contracts";
import { createContext, use } from "react";

import { useWhileEditOn } from "./edit-context.ts";
import type { ReviewDone } from "./served-store.ts";

/**
 * The structure proposals on the page. The read-only file has none: it shows
 * the accepted map alone, so nothing here reaches an export.
 */
export interface ProposedStructures {
  /** Whether writes can be sent now. False while the server is down. */
  readonly canPropose: boolean;
  /** Removes the open proposal with this id. */
  readonly discard: (id: ChangeId, done: ReviewDone<ChangeId>) => void;
  /** Whether `id` is a structure the engineer proposed and hasn't sent yet. */
  readonly isOpenAdd: (id: string) => boolean;
  /**
   * A structure's name before any proposal renames it, or the name a new
   * structure was proposed under.
   */
  readonly nameOf: (id: string) => string;
  /** The open proposals: those not in a batch yet. */
  readonly open: ReadonlyArray<StructureProposal>;
  /** Puts the structure the engineer proposed at `next`. */
  readonly place: (
    id: string,
    next: Placement,
    done: ReviewDone<ChangeId>
  ) => string | undefined;
  /**
   * What `check` would report for the map as proposed with `items` added,
   * each marked new when the map as proposed now didn't have it. `items` are
   * open items of any kind, built by the control that proposes them; each
   * says through the kind table what it does to the map. `scope` is the whole
   * map, or the chapter being viewed, for a proposal that changes how a
   * chapter draws.
   */
  readonly problemsOf: (
    items: ReadonlyArray<BatchItem>,
    options?: {
      /** Structures moved first, such as the one a drop just moved, by id. */
      readonly moved?: Readonly<Record<string, Placement>>;
      readonly scope?: CheckScope;
    }
  ) => ReadonlyArray<DraggedProblem>;
  /** Proposes `change`; `done` gets the proposal's id, or why it was refused. */
  readonly propose: (
    change: StructureChange,
    done: ReviewDone<ChangeId>
  ) => void;
  /** The map as proposed; see `proposedMap`. */
  readonly proposed: ProposedMap;
  /** Why `change` would be refused, or `undefined`. */
  readonly refusalOf: (change: StructureChange) => string | undefined;
  /** Why putting the proposed structure `id` at `next` would be refused. */
  readonly refusalOfPlace: (id: string, next: Placement) => string | undefined;
}

export const ProposedContext = createContext<ProposedStructures | null>(null);

/**
 * The structure proposals, or `null` on a page that can't propose or while
 * Edit is off. Controls read this one.
 */
export const useProposed = (): ProposedStructures | null =>
  useWhileEditOn(use(ProposedContext));

/**
 * The map as proposed, whether or not Edit is on, for the marks the page
 * draws on proposed structures and groups. It gives no reason to draw a
 * control.
 */
export const useProposedMapIgnoringEdit = (): ProposedMap | undefined =>
  use(ProposedContext)?.proposed;
