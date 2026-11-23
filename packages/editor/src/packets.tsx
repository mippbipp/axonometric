import { CanvasItem } from "@axonometric/ui/components/canvas-items";
import { Array as Arr } from "effect";
import { use, useMemo } from "react";

import type { PacketRun } from "./chapters.ts";
import { EditorSceneContext } from "./editor-view.ts";
import { useDropOutlines } from "./outlines-context.ts";
import { packetAt } from "./packet-schedule.ts";
import { usePlayback, usePlaybackClock } from "./playback.ts";
import { pointAlong } from "./projection.ts";
import type { ScreenPoint } from "./projection.ts";

/** Each drawn hop's line on screen, as the view draws it. */
type HopLines = ReadonlyMap<string, ReadonlyArray<ScreenPoint>>;

function Packet({
  lines,
  run,
  runIndex,
}: {
  readonly lines: HopLines;
  readonly run: PacketRun;
  readonly runIndex: number;
}) {
  const { selected, selectPacket } = usePlayback();
  const moving = useDropOutlines()?.outlines?.moving;
  const clock = usePlaybackClock();
  const routes = useMemo(
    () => Arr.map(run.hops, (hop) => lines.get(hop.id)),
    [run, lines]
  );
  const at = packetAt({ clock, hops: run.hops.length });
  const hop = run.hops[at.hop];
  const route = routes[at.hop];

  if (hop === undefined || route === undefined) {
    return null;
  }

  const { sx, sy } = pointAlong({ points: route, t: at.t });

  // A packet walks its hop's old route while a structure at either end is
  // dragged, so it would hang in the air. It comes back with the hop. This is
  // worked out as the packet draws, because it moves from hop to hop for as
  // long as its run lasts. It has its own attribute: `shiftDrawing` clears
  // `data-drag-hidden` from the elements it hid, and React owns this one.
  const hidden = Arr.some(
    moving ?? [],
    ({ id }) => id === hop.from || id === hop.to
  );

  const isSelected = selected?.run.id === run.id;

  return (
    <CanvasItem
      aria-label={`Packet: ${hop.label}`}
      className="cursor-pointer outline-none"
      data-packet={hop.id}
      data-packet-hidden={hidden ? "" : undefined}
      data-run={run.id}
      data-selected={isSelected}
      onPress={() => {
        selectPacket(runIndex);
      }}
      value={`packet:${run.id}`}
    >
      {/* A wider, invisible target so the packet is easy to hit. */}
      <circle className="fill-transparent" cx={sx} cy={sy} r={12} />
      {isSelected ? (
        <circle
          className="stroke-ink"
          cx={sx}
          cy={sy}
          fill="none"
          r={11}
          strokeDasharray="2 2"
          strokeWidth={1.2}
        />
      ) : null}
      <circle
        className="fill-ink stroke-paper"
        cx={sx}
        cy={sy}
        r={5.5}
        strokeWidth={1.6}
      />
    </CanvasItem>
  );
}

/**
 * The packets for the current chapter, one per run, drawn inside a
 * view's SVG. Each packet walks its hop's line as the view's scene draws
 * it, so the Iso view and Plan view share the timing and differ only in the
 * lines. Put it inside a `MapView`.
 *
 * Packets carry no label. The hop's own label, drawn once by the view at the
 * hop, names what the packet carries, and the side panel shows it when the
 * packet is selected.
 */
export function PacketLayer() {
  const { playing, runs } = usePlayback();
  const scene = use(EditorSceneContext);

  const lines = useMemo(
    (): HopLines =>
      new Map(
        Arr.map(scene?.hops ?? [], ({ hop, points }) => [hop.id, points])
      ),
    [scene]
  );

  return (
    <g data-packets data-playing={playing}>
      {Arr.map(runs, (run, index) => (
        <Packet key={run.id} lines={lines} run={run} runIndex={index} />
      ))}
    </g>
  );
}
