import { arrowPolygon, groundProjections } from "@axonometric/contracts";
import type {
  CompareMarks,
  Placement,
  SceneHop,
  SceneStructure,
  View,
} from "@axonometric/contracts";
import { Array as Arr } from "effect";

import { looks } from "./compare-looks.ts";
import { groundOutline, toPoints } from "./projection.ts";

// The compare's layers. Each takes the scene's parts and the marks as props
// and reads no context, so the page's drawing can place them as it places
// any other layer. They draw outlines only: no text, so nothing here can
// clash with a name tag or a label.

/** How far the first ring reaches past the footprint, in grid units. */
const firstGap = 0.25;

/** How much further each further ring reaches. */
const ringStep = 0.3;

const grown = (placement: Placement, gap: number): Placement => ({
  x: placement.x - gap,
  y: placement.y - gap,
  w: placement.w + gap * 2,
  d: placement.d + gap * 2,
});

/**
 * A ring on the ground around each structure the compare marks, one for
 * each kind that applies, in its kind's colour and dash, and a dotted ink
 * outline where the accepted map has a moved or resized structure. Drawn
 * under the structures.
 */
export function CompareRings({
  structures,
  view,
  marks,
}: {
  readonly structures: readonly SceneStructure[];
  readonly view: View;
  readonly marks: CompareMarks | null;
}) {
  if (marks === null) {
    return null;
  }

  const ground = groundProjections[view];

  return (
    <g aria-hidden="true" className="pointer-events-none">
      {Arr.flatMap(structures, ({ structure, placement }) => {
        const kinds = marks.structures.get(structure.id) ?? [];
        const origin = marks.origins.get(structure.id);

        return [
          ...(origin === undefined
            ? []
            : [
                <polygon
                  key={`${structure.id}-origin`}
                  data-compare-origin={structure.id}
                  points={toPoints(groundOutline(origin, ground))}
                  className={`${looks.origin.stroke} fill-none`}
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeDasharray={looks.origin.dash}
                />,
              ]),
          ...Arr.map(kinds, (kind, index) => (
            <polygon
              key={`${structure.id}-${kind}`}
              data-compare-ring={kind}
              data-compare-structure={structure.id}
              points={toPoints(
                groundOutline(
                  grown(placement, firstGap + ringStep * index),
                  ground
                )
              )}
              className={`${looks[kind].stroke} fill-none`}
              strokeWidth={2}
              strokeDasharray={looks[kind].dash}
            />
          )),
        ];
      })}
    </g>
  );
}

/**
 * A halo under each hop the compare marks: a wide line in its kind's colour
 * and dash along the hop's route, with the arrowhead's outline. It is drawn
 * under the hops, so the hop stays on top. A screen reader hears the hop's
 * label and its kind.
 */
export function CompareHops({
  hops,
  marks,
}: {
  readonly hops: readonly SceneHop[];
  readonly marks: CompareMarks | null;
}) {
  if (marks === null) {
    return null;
  }

  return (
    <g className="pointer-events-none">
      {Arr.flatMap(hops, ({ hop, points }) => {
        const kind = marks.hops.get(hop.id);
        const head = arrowPolygon(points);

        return kind === undefined
          ? []
          : [
              <g
                key={hop.id}
                data-compare-hop={hop.id}
                data-compare-kind={kind}
                role="graphics-symbol"
                aria-label={`Hop ${hop.label}, ${looks[kind].spoken}`}
                className={`${looks[kind].stroke} fill-none`}
              >
                <polyline
                  points={toPoints(points)}
                  strokeWidth={6}
                  strokeLinejoin="round"
                  strokeDasharray={looks[kind].dash}
                />
                {head === undefined ? null : (
                  <polygon
                    points={toPoints(head)}
                    strokeWidth={4}
                    strokeLinejoin="round"
                  />
                )}
              </g>,
            ];
      })}
    </g>
  );
}
