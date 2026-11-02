import {
  groundOutline,
  groundProjections,
  toPoints,
} from "@axonometric/contracts";
import type { SceneHop, SceneStructure, View } from "@axonometric/contracts";
import { Array as Arr } from "effect";

import { useChapterMarks } from "./chapter-marks-context.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/**
 * How far the ring reaches past a structure's footprint, in grid units. It is
 * wider than the accepted outline's, so a structure that is both moved and
 * revealed by a proposal keeps both rings apart.
 */
const ringGap = 0.45;

/**
 * The chapter proposals' pending look, in the current chapter only: a dashed
 * ring on the ground round each structure the chapter would reveal, a solid
 * refused-colour ring round each it would hide, and a pending-colour line along
 * each hop it would play, a refused-colour one along each it would stop playing.
 * Outlines and tints only, so nothing here can meet a name tag or a label.
 *
 * It is an editing layer: a file's drawing never includes it.
 */
export function ChapterPendingLook({
  structures,
  hops,
  view,
}: {
  readonly structures: readonly SceneStructure[];
  readonly hops: readonly SceneHop[];
  readonly view: View;
}) {
  const { stop } = useWalkthrough();
  const revealing = useChapterMarks(stop.id, "reveal");
  const hiding = useChapterMarks(stop.id, "hide");
  const playing = useChapterMarks(stop.id, "play");
  const stopping = useChapterMarks(stop.id, "unplay");
  const ground = groundProjections[view];

  return (
    <g aria-hidden="true" className="pointer-events-none">
      {Arr.flatMap(structures, ({ structure, placement }) => {
        const reveals = revealing.has(structure.id);
        const hides = hiding.has(structure.id);

        if (!reveals && !hides) {
          return [];
        }

        const { x, y, w, d } = placement;

        return [
          <polygon
            key={structure.id}
            data-chapter-mark={reveals ? "reveal" : "hide"}
            data-chapter-mark-of={structure.id}
            points={toPoints(
              groundOutline(
                {
                  x: x - ringGap,
                  y: y - ringGap,
                  w: w + ringGap * 2,
                  d: d + ringGap * 2,
                },
                ground
              )
            )}
            fill="none"
            className={reveals ? "stroke-pending" : "stroke-refused"}
            strokeWidth={1.6}
            strokeDasharray={reveals ? "5 3" : undefined}
          />,
        ];
      })}
      {Arr.flatMap(hops, ({ hop, points }) => {
        const plays = playing.has(hop.id);
        const stops = stopping.has(hop.id);

        if (!plays && !stops) {
          return [];
        }

        return [
          <polyline
            key={hop.id}
            data-chapter-mark={plays ? "play" : "unplay"}
            data-chapter-mark-of={hop.id}
            points={toPoints(points)}
            fill="none"
            strokeLinejoin="round"
            className={plays ? "stroke-pending" : "stroke-refused"}
            strokeWidth={plays ? 2.4 : 3}
            strokeDasharray={plays ? undefined : "2 4"}
            opacity={0.8}
          />,
        ];
      })}
    </g>
  );
}
