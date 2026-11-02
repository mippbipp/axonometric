import {
  groundOutline,
  groundProjections,
  noteMarkerRadius,
  noteMarkerSpots,
  toPoints,
} from "@axonometric/contracts";
import type { Scene } from "@axonometric/contracts";
import { Array as Arr } from "effect";

import { useReview } from "./review-context.ts";

/**
 * Marks each structure that has a note, without text. A small ring sits in
 * the first spot beside the structure that is clear of boxes, name tags,
 * chips, zone titles and hop labels; where there is none, the structure's
 * own footprint is outlined instead. Rejected notes draw in the refused
 * colour, the rest in the pending colour. The numbers and verdict wording
 * live in the side panel and the Pending tab.
 *
 * This is an editing layer: a file's drawing never includes it.
 */
export function NoteMarkers({ scene }: { readonly scene: Scene }) {
  const review = useReview();

  if (review === null) {
    return null;
  }

  const live = Arr.filter(
    review.notes,
    ({ status }) => !(status.state === "reviewed" && status.dismissed)
  );

  const withNotes = new Set(
    Arr.flatMap(live, ({ item }) =>
      item.kind === "note" ? [item.target.id] : []
    )
  );

  const spots = noteMarkerSpots(scene, withNotes);

  return (
    <g pointerEvents="none">
      {Arr.flatMap(scene.structures, ({ structure, placement }) => {
        if (!withNotes.has(structure.id)) {
          return [];
        }

        const rejected = Arr.some(
          live,
          ({ item, status }) =>
            item.kind === "note" &&
            item.target.id === structure.id &&
            status.state === "reviewed" &&
            status.verdict.verdict === "rejected"
        );

        const colour = rejected ? "stroke-refused" : "stroke-pending";
        const spot = spots.get(structure.id);

        return [
          spot === undefined ? (
            <polygon
              key={structure.id}
              data-note-marker={structure.id}
              data-note-placed="outline"
              data-note-rejected={rejected}
              points={toPoints(
                groundOutline(placement, groundProjections[scene.view])
              )}
              className={`${colour} fill-none`}
              strokeWidth={1.6}
              strokeDasharray="1 3"
            />
          ) : (
            <circle
              key={structure.id}
              data-note-marker={structure.id}
              data-note-placed="ring"
              data-note-rejected={rejected}
              cx={spot.sx}
              cy={spot.sy}
              r={noteMarkerRadius}
              className={`${colour} fill-none`}
              strokeWidth={2}
            />
          ),
        ];
      })}
    </g>
  );
}
