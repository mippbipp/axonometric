import type { BatchItem, CheckScope } from "@axonometric/contracts";
import { useEffect, useRef } from "react";

import { useChangePreview } from "./drag-preview-context.ts";
import { useProposed } from "./proposed-context.ts";

/**
 * Shows what `check` would report for open items, in the warnings panel
 * beside the map, for a proposal that is not a structure change: a group, or a
 * change to a chapter. `item` is what the control would propose, or `undefined`
 * while there is nothing to preview. The panel marks what the change adds as
 * "New from this change", and is cleared when the control goes.
 *
 * `scope` is the chapter being viewed for a proposal that changes how a
 * chapter draws.
 */
// oxlint-disable-next-line effecttsgo/missing-pipeable-signature -- a React hook, called as `useItemPreview(items, scope)`, never piped.
export const useItemPreview = (
  items: readonly BatchItem[],
  scope: CheckScope
) => {
  const proposing = useProposed();
  const panel = useChangePreview();
  const sent = useRef(false);

  useEffect(() => {
    // Once the proposal is sent, what it added stays up for the engineer to
    // read, and the control going away or changing no longer touches it.
    if (sent.current) {
      return;
    }

    if (proposing === null || items.length === 0) {
      panel?.clear();

      return;
    }

    panel?.show({ problems: proposing.problemsOf(items, { scope }) });
  }, [items, scope, panel, proposing]);

  useEffect(
    () => () => {
      if (!sent.current) {
        panel?.clear();
      }
    },
    [panel]
  );

  return {
    /**
     * Shows what the sent items added to `check`'s report, and leaves it up
     * after the control is gone.
     */
    keep: () => {
      sent.current = true;
      panel?.show({
        problems: proposing?.problemsOf(items, { scope }) ?? [],
      });
    },
  };
};

/** Shows what a change adds for the items just sent, and keeps it up. */
export const useShowProblems = () => {
  const proposing = useProposed();
  const panel = useChangePreview();

  return {
    /** Shows what `items` add to `check`'s report. */
    show: (items: readonly BatchItem[], scope: CheckScope) => {
      panel?.show({
        problems: proposing?.problemsOf(items, { scope }) ?? [],
      });
    },
    /** Shows why a change was refused. */
    refuse: (refusal: string) => {
      panel?.show({ refusal, problems: [] });
    },
  };
};
