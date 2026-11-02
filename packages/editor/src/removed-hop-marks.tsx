import { marked, removedHopMark } from "@axonometric/contracts";
import type { SceneHop, ScreenPoint, ScreenRect } from "@axonometric/contracts";
import { Array as Arr, Option } from "effect";

import { useConnections } from "./connections-context.ts";
import { strikeOnRoute } from "./hop-strike.ts";

/**
 * A hop proposed for deletion, struck: a small cross across its route, in the
 * refused colour, where no text is. The hop itself is drawn dashed (see
 * `index.css`). It draws no text of its own.
 *
 * This is an editing layer: a file's drawing never includes it.
 */
export function RemovedHopMarks({
  hops,
  texts,
}: {
  readonly hops: readonly SceneHop[];
  /** The box of every name tag, code chip and hop label drawn. */
  readonly texts: readonly ScreenRect[];
}) {
  const proposed = useConnections()?.proposed;

  const removes =
    proposed === undefined ? undefined : marked(proposed, removedHopMark);

  if (removes === undefined || removes.size === 0) {
    return null;
  }

  const struck = Arr.flatMap(hops, ({ hop, points }) =>
    removes.has(hop.id)
      ? Option.match(strikeOnRoute({ route: points, texts }), {
          onNone: () => [],
          onSome: (strike) => [{ id: hop.id, strike }],
        })
      : []
  );

  return (
    <g aria-hidden="true" className="pointer-events-none">
      {Arr.map(struck, ({ id, strike }) => (
        <Strike key={id} id={id} lines={strike.lines} />
      ))}
    </g>
  );
}

/** The cross across one hop. */
function Strike({
  id,
  lines,
}: {
  readonly id: string;
  readonly lines: readonly (readonly [ScreenPoint, ScreenPoint])[];
}) {
  return (
    <g
      data-removed-hop-mark={id}
      className="stroke-refused fill-none"
      strokeWidth={2.2}
      strokeLinecap="butt"
    >
      {Arr.map(lines, ([from, to]) => (
        <line
          key={`${from.sx},${from.sy}`}
          data-hop-strike=""
          x1={from.sx}
          y1={from.sy}
          x2={to.sx}
          y2={to.sy}
        />
      ))}
    </g>
  );
}
