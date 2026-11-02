import { groundProjections } from "@axonometric/contracts";
import type { Placement, View } from "@axonometric/contracts";

import { useHopDraft } from "./hop-draft-context.ts";

/**
 * A dashed line from the structure a hop starts at to the one it ends at,
 * while the label field in the side panel is open. It sits on the ground,
 * centre to centre, clear of the text, and takes no pointer.
 *
 * This is an editing layer: a file's drawing never includes it.
 */
export function HopDraftPreview({
  view,
  placements,
}: {
  readonly view: View;
  readonly placements: Readonly<Partial<Record<string, Placement>>>;
}) {
  const draft = useHopDraft()?.draft;

  if (draft === null || draft === undefined || draft.to === null) {
    return null;
  }

  const from = placements[draft.from];
  const to = placements[draft.to];

  if (from === undefined || to === undefined) {
    return null;
  }

  const ground = groundProjections[view];
  const a = ground.toScreen({ x: from.x + from.w / 2, y: from.y + from.d / 2 });
  const b = ground.toScreen({ x: to.x + to.w / 2, y: to.y + to.d / 2 });

  return (
    <line
      data-hop-draft={draft.from}
      aria-hidden="true"
      x1={a.sx}
      y1={a.sy}
      x2={b.sx}
      y2={b.sy}
      className="stroke-pending pointer-events-none"
      strokeWidth={2.2}
      strokeDasharray="6 3"
    />
  );
}
