import type { DraggedProblem, StructureChange } from "@axonometric/contracts";
import { Result } from "effect";
import { useEffect } from "react";

import { useChangePreview } from "./drag-preview-context.ts";
import { structureItem } from "./proposal-items.ts";
import { useProposed } from "./proposed-context.ts";
import { useSending } from "./use-sending.ts";

/**
 * Sends structure proposals, keeps the reason the last one was refused, and
 * shows what a change would add to `check`'s report in the warnings panel
 * beside the map, the panel a drag uses.
 *
 * `send` shows them for the change it sends, and a refusal in the same panel.
 * The add form shows them as its fields change through `DraftSpotProvider`.
 */
export const usePropose = () => {
  const proposing = useProposed();
  const panel = useChangePreview();
  const { clear, failure, refuse, run, sending } = useSending();

  // The panel is the page's, not this control's: it clears when the control goes.
  useEffect(
    () => () => {
      panel?.clear();
    },
    [panel]
  );

  const problemsOf = (change: StructureChange): ReadonlyArray<DraggedProblem> =>
    proposing?.problemsOf([structureItem(change)]) ?? [];

  const send = (change: StructureChange, done?: () => void) => {
    if (proposing === null) {
      return;
    }

    const refusal = proposing.refusalOf(change);

    if (refusal !== undefined) {
      refuse(refusal);
      panel?.show({ problems: [], refusal });

      return;
    }

    // What the change adds to check's report stays up for the engineer to read.
    panel?.show({ problems: problemsOf(change) });
    run(
      (finish) => {
        proposing.propose(change, (outcome) => {
          if (Result.isFailure(outcome)) {
            panel?.show({ problems: [], refusal: outcome.failure });
          }

          finish(outcome);
        });
      },
      () => {
        done?.();
      }
    );
  };

  return {
    canPropose: proposing?.canPropose === true,
    clear,
    failure,
    send,
    sending,
  };
};
