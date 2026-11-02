import type { SceneStructure } from "@axonometric/contracts";
import { Array as Arr } from "effect";

import { useReview } from "./review-context.ts";

const markerRadius = 7;

/**
 * A small marker on top-right of each structure that has a note, with the
 * number of notes in it. The marker for a note the agent rejected draws in
 * the refused colour, and one with an open or frozen note in the pending
 * colour, so the map says which structures have something to read.
 */
export function NoteMarkers({
  structures,
}: {
  readonly structures: readonly SceneStructure[];
}) {
  const review = useReview();

  if (review === null) {
    return null;
  }

  return (
    <g className="pointer-events-none">
      {Arr.flatMap(structures, ({ structure, bounds }) => {
        const here = Arr.filter(
          review.notes,
          ({ item, status }) =>
            item.kind === "note" &&
            item.target.id === structure.id &&
            !(status.state === "reviewed" && status.dismissed)
        );

        if (here.length === 0) {
          return [];
        }

        const rejected = Arr.some(
          here,
          ({ status }) =>
            status.state === "reviewed" && status.verdict.verdict === "rejected"
        );

        const cx = bounds.right + markerRadius * 0.4;
        const cy = bounds.top + markerRadius * 0.4;

        return [
          <g
            key={structure.id}
            data-note-marker={structure.id}
            data-note-count={here.length}
            data-note-rejected={rejected}
          >
            <circle
              cx={cx}
              cy={cy}
              r={markerRadius}
              className={rejected ? "fill-refused" : "fill-pending"}
            />
            <text
              x={cx}
              y={cy + 3}
              textAnchor="middle"
              className="fill-paper text-2xs font-mono font-semibold"
            >
              {here.length}
            </text>
          </g>,
        ];
      })}
    </g>
  );
}
