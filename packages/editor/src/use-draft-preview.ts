import type { StructureChange } from "@axonometric/contracts";
import { sameStructureChange } from "@axonometric/contracts";
import { useEffect, useRef } from "react";

import { useChangePreview } from "./drag-preview-context.ts";
import { useProposed } from "./proposed-context.ts";

/**
 * Shows what `check` would report for the structure change a form holds, in
 * the warnings panel beside the map, and keeps it current as the form
 * changes. With no change, the panel is cleared. The panel is cleared too
 * when the form goes.
 */
export const useDraftPreview = (change: StructureChange | undefined) => {
  const proposing = useProposed();
  const panel = useChangePreview();
  const shown = useRef<StructureChange | undefined>(undefined);

  useEffect(() => {
    const held = shown.current;

    // Nothing to do when the change is the one already shown.
    if (
      change === held ||
      (change !== undefined &&
        held !== undefined &&
        sameStructureChange(change, held))
    ) {
      return;
    }

    shown.current = change;

    if (change === undefined || proposing === null) {
      panel?.clear();

      return;
    }

    panel?.show({
      refusal: proposing.refusalOf(change),
      problems: proposing.problemsOf([change]),
    });
  }, [change, panel, proposing]);

  useEffect(
    () => () => {
      panel?.clear();
    },
    [panel]
  );
};
