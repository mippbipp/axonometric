import type { DraggedProblem, StructureChange } from "@axonometric/contracts";
import { Option, Result } from "effect";
import { useEffect, useState } from "react";

import { useChangePreview } from "./drag-preview-context.ts";
import { useProposed } from "./proposed-context.ts";

/**
 * Sends structure proposals, keeps the reason the last one was refused, and
 * shows what a change would add to `check`'s report in the warnings panel
 * beside the map, the panel a drag uses.
 *
 * `send` shows them for the change it sends, and a refusal in the same panel.
 * A form that shows them as its fields change uses `useDraftPreview`.
 */
export const usePropose = () => {
  const proposing = useProposed();
  const panel = useChangePreview();
  const [failure, setFailure] = useState<string | undefined>();
  const [sending, setSending] = useState(false);

  // The panel is the page's, not this control's: it clears when the control goes.
  useEffect(
    () => () => {
      panel?.clear();
    },
    [panel]
  );

  const problemsOf = (
    changes: readonly StructureChange[]
  ): readonly DraggedProblem[] => proposing?.problemsOf(changes) ?? [];

  const send = (change: StructureChange, done?: () => void) => {
    if (proposing === null) {
      return;
    }

    const refusal = proposing.refusalOf(change);

    if (refusal !== undefined) {
      setFailure(refusal);
      panel?.show({ refusal, problems: [] });

      return;
    }

    setFailure(undefined);
    setSending(true);

    // What the change adds to check's report stays up for the engineer to read.
    panel?.show({ problems: problemsOf([change]) });
    proposing.propose(change, (outcome) => {
      setSending(false);

      const why = Option.getOrUndefined(Result.getFailure(outcome));

      setFailure(why);

      if (why === undefined) {
        // What the proposal added stays up, so the engineer can read it.
        done?.();
      } else {
        panel?.show({ refusal: why, problems: [] });
      }
    });
  };

  return {
    send,
    sending,
    failure,
    clear: () => {
      setFailure(undefined);
    },
    canPropose: proposing?.canPropose === true,
  };
};
