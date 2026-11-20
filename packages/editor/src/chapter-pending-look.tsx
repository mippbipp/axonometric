import {
  groundOutline,
  groundProjections,
  textBoxesOf,
} from "@axonometric/contracts";
import type { Scene, View } from "@axonometric/contracts";
import { Array as Arr } from "effect";
import { useMemo } from "react";

import { useChapterMarks } from "./chapter-marks-context.ts";
import { OutlineLines } from "./outline-paths.tsx";
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
 * each hop it would play, a refused-colour dotted one along each it would stop
 * playing. They are outlines and tints only, and every one is drawn as separate
 * lines that stop short of the scene's text, so none crosses a name tag, a code
 * chip, a zone title or a hop label.
 *
 * It is an editing layer: a file's drawing never includes it.
 */
export function ChapterPendingLook({
  scene,
  view,
}: {
  readonly scene: Scene;
  readonly view: View;
}) {
  const { stop } = useWalkthrough();
  const revealing = useChapterMarks(stop.id, "reveal");
  const hiding = useChapterMarks(stop.id, "hide");
  const playing = useChapterMarks(stop.id, "play");
  const stopping = useChapterMarks(stop.id, "unplay");
  const ground = groundProjections[view];
  const text = useMemo(() => textBoxesOf(scene), [scene]);

  return (
    <g aria-hidden="true" className="pointer-events-none">
      {Arr.flatMap(scene.structures, ({ placement, structure }) => {
        const reveals = revealing.has(structure.id);
        const hides = hiding.has(structure.id);

        if (!reveals && !hides) {
          return [];
        }

        const { d, w, x, y } = placement;

        return [
          <OutlineLines
            className={reveals ? "stroke-pending" : "stroke-refused"}
            closed
            dash={reveals ? "5 3" : undefined}
            id={structure.id}
            key={structure.id}
            mark={{
              "data-chapter-mark": reveals ? "reveal" : "hide",
              "data-chapter-mark-of": structure.id,
            }}
            points={groundOutline(
              {
                d: d + ringGap * 2,
                w: w + ringGap * 2,
                x: x - ringGap,
                y: y - ringGap,
              },
              ground
            )}
            text={text}
            width={1.6}
          />,
        ];
      })}
      {Arr.flatMap(scene.hops, ({ hop, points }) => {
        const plays = playing.has(hop.id);
        const stops = stopping.has(hop.id);

        if (!plays && !stops) {
          return [];
        }

        return [
          <OutlineLines
            className={plays ? "stroke-pending" : "stroke-refused"}
            closed={false}
            dash={plays ? undefined : "2 4"}
            id={hop.id}
            key={hop.id}
            mark={{
              "data-chapter-mark": plays ? "play" : "unplay",
              "data-chapter-mark-of": hop.id,
            }}
            points={points}
            text={text}
            width={plays ? 2.4 : 3}
          />,
        ];
      })}
    </g>
  );
}
