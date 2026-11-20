import { marked, removedHopMark } from "@axonometric/contracts";
import type { SceneHop, ScreenPoint } from "@axonometric/contracts";
import { Array as Arr, Option } from "effect";
import { use } from "react";

import { useProposedHopsIgnoringEdit } from "./connections-context.ts";
import { EditorSceneContext } from "./editor-view.ts";
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
}: {
  readonly hops: ReadonlyArray<SceneHop>;
}) {
  const { outlines, texts } = use(EditorSceneContext);
  const proposed = useProposedHopsIgnoringEdit();

  const removes =
    proposed === undefined ? undefined : marked(proposed, removedHopMark);

  if (removes === undefined || removes.size === 0) {
    return null;
  }

  const struck = Arr.flatMap(hops, ({ hop, points }) =>
    removes.has(hop.id)
      ? Option.match(strikeOnRoute({ outlines, route: points, texts }), {
          onNone: () => [],
          onSome: (strike) => [{ id: hop.id, strike }],
        })
      : []
  );

  return (
    <g aria-hidden="true" className="pointer-events-none">
      {Arr.map(struck, ({ id, strike }) => (
        <Strike id={id} key={id} lines={strike.lines} />
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
  readonly lines: ReadonlyArray<readonly [ScreenPoint, ScreenPoint]>;
}) {
  return (
    <g
      className="stroke-refused fill-none"
      data-removed-hop-mark={id}
      strokeLinecap="butt"
      strokeWidth={2.2}
    >
      {Arr.map(lines, ([from, to]) => (
        <line
          data-hop-strike=""
          key={`${from.sx},${from.sy}`}
          x1={from.sx}
          x2={to.sx}
          y1={from.sy}
          y2={to.sy}
        />
      ))}
    </g>
  );
}
