import type { MapState, ScreenPoint, View } from "@axonometric/contracts";
import {
  gapAt,
  growRect as grown,
  outsideHoles,
  rectPolygon,
  segmentsOf,
} from "@axonometric/contracts";
import { Array as Arr, Option } from "effect";
import { use, useMemo } from "react";

import { EditorSceneContext } from "./editor-view.ts";
import { useHopDraft } from "./hop-draft-context.ts";
import { previewRoute, straightLine } from "./hop-preview-route.ts";

/**
 * The dashed line of a hop being drawn: while a drag from an edge handle is
 * over a structure, and while the label form is open. Once a target is known
 * it follows the route the hop will have, from the router every hop goes
 * through, in its own lane, so the engineer sees where it will run. Over
 * empty space, where the hop has no target to route to, it is a straight
 * line from the handle to the pointer.
 *
 * It sits in the slot under the structures and their text, so it never draws
 * over a name tag or a box. This is an editing layer: a file's drawing never
 * includes it.
 */
export function HopDraftLine({
  view,
  state,
  revealed,
}: {
  readonly view: View;
  /** The map as shown, proposals included. */
  readonly state: MapState;
  readonly revealed: ReadonlySet<string>;
}) {
  const drafting = useHopDraft();
  const { texts, zoom } = use(EditorSceneContext);
  const gap = gapAt(zoom);
  const stretch = drafting?.stretch ?? null;
  const draft = drafting?.draft ?? null;

  const from = stretch?.from ?? draft?.from ?? null;
  const to = stretch === null ? (draft?.to ?? null) : stretch.over;

  const routed = useMemo(
    () =>
      from === null || to === null
        ? Option.none<readonly ScreenPoint[]>()
        : previewRoute({
            data: state.data,
            layout: state.layout,
            revealed,
            from,
            to,
            view,
          }),
    [from, to, state.data, state.layout, revealed, view]
  );

  if (from === null) {
    return null;
  }

  const straight =
    stretch === null
      ? undefined
      : straightLine({ start: stretch.start, end: stretch.end, view });

  const line = Option.isSome(routed) ? routed.value : straight;

  if (line === undefined || line.length < 2) {
    return null;
  }

  // The scene placed no text around a hop that does not exist yet, so the
  // line is cut where it meets a name tag, chip or label, and clear of them.
  const holes = Arr.map(texts, (rect) => rectPolygon(grown(rect, gap)));

  const pieces = Arr.flatMap(segmentsOf(line), (segment) =>
    outsideHoles(segment, holes, 1)
  );

  return (
    <g
      aria-hidden="true"
      className={
        to === null
          ? "stroke-pending pointer-events-none opacity-60"
          : "stroke-pending pointer-events-none"
      }
      strokeWidth={2.2}
      strokeDasharray="6 3"
    >
      {Arr.map(pieces, ({ start, end }) => (
        <line
          key={`${start.sx},${start.sy},${end.sx},${end.sy}`}
          data-hop-preview={from}
          data-over={to ?? ""}
          data-routed={Option.isSome(routed)}
          x1={start.sx}
          y1={start.sy}
          x2={end.sx}
          y2={end.sy}
        />
      ))}
    </g>
  );
}
