import { groundProjections } from "@axonometric/contracts";
import type { Placement, SceneStructure, View } from "@axonometric/contracts";
import { Array as Arr } from "effect";

import { useCompare } from "./compare-context.ts";
import { looks } from "./compare-looks.ts";
import { groundOutline, toPoints } from "./projection.ts";

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
 * A ring on the ground around each structure the compare marks, one ring
 * for each kind that applies, each in its kind's colour and dash, and a
 * faint outline where the current map has a moved or resized structure.
 * Drawn under the structures.
 */
export function CompareRings({
  structures,
  view,
}: {
  readonly structures: readonly SceneStructure[];
  readonly view: View;
}) {
  const marks = useCompare();

  if (marks === null) {
    return null;
  }

  const ground = groundProjections[view];

  return (
    <g aria-hidden="true" className="pointer-events-none">
      {Arr.flatMap(structures, ({ structure, placement }) => {
        const kinds = marks.structures.get(structure.id) ?? [];
        const origin = marks.origins.get(structure.id);
        const [first] = kinds;

        return [
          ...(origin === undefined || first === undefined
            ? []
            : [
                <polygon
                  key={`${structure.id}-origin`}
                  data-compare-origin={structure.id}
                  points={toPoints(groundOutline(origin, ground))}
                  className={`${looks[kinds.includes("moved") ? "moved" : "resized"].stroke} fill-none opacity-50`}
                  strokeWidth={1.2}
                  strokeDasharray="3 3"
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

/** How wide a badge is for its text: the tag font, and padding. */
const badgeWidth = (text: string) => text.length * 6.2 + 10;

const badgeHeight = 14;

/**
 * A badge above each marked structure that says what differs, such as
 * "moved · text", in the colour of its first kind.
 */
export function CompareBadges({
  structures,
}: {
  readonly structures: readonly SceneStructure[];
}) {
  const marks = useCompare();

  if (marks === null) {
    return null;
  }

  return (
    <g aria-hidden="true" className="pointer-events-none">
      {Arr.flatMap(structures, ({ structure, bounds }) => {
        const kinds = marks.structures.get(structure.id) ?? [];
        const [first] = kinds;

        if (first === undefined) {
          return [];
        }

        const text = Arr.join(
          Arr.map(kinds, (kind) => looks[kind].badge),
          " · "
        );

        const width = badgeWidth(text);
        const middle = (bounds.left + bounds.right) / 2;
        const top = bounds.top - badgeHeight - 4;

        return [
          <g key={structure.id} data-compare-badge={structure.id}>
            <rect
              x={middle - width / 2}
              y={top}
              width={width}
              height={badgeHeight}
              rx={2}
              className={looks[first].fill}
            />
            <text
              x={middle}
              y={top + badgeHeight - 4}
              textAnchor="middle"
              className="fill-paper text-2xs font-mono font-semibold"
            >
              {text}
            </text>
          </g>,
        ];
      })}
    </g>
  );
}
