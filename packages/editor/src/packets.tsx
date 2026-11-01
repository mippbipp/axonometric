import type { Hop } from "@axonometric/contracts";
import { Array as Arr } from "effect";
import { useMemo } from "react";
import type { KeyboardEvent } from "react";

import type { PacketRun } from "./chapters.ts";
import { packetAt } from "./packet-schedule.ts";
import { usePlayback, usePlaybackClock } from "./playback.ts";
import { pointAlong } from "./projection.ts";
import type { ScreenPoint } from "./projection.ts";

/**
 * A view's drawn route for a hop, in its own screen coordinates, or
 * `undefined` when the view doesn't draw the hop. Keep it stable between
 * renders, for example with `useCallback`, so routes aren't recomputed.
 */
export type RouteOf = (hop: Hop) => readonly ScreenPoint[] | undefined;

function Packet({
  run,
  runIndex,
  routeOf,
}: {
  readonly run: PacketRun;
  readonly runIndex: number;
  readonly routeOf: RouteOf;
}) {
  const { selected, selectPacket } = usePlayback();
  const clock = usePlaybackClock();
  const routes = useMemo(() => Arr.map(run.hops, routeOf), [run, routeOf]);
  const at = packetAt({ clock, hops: run.hops.length });
  const hop = run.hops[at.hop];
  const route = routes[at.hop];

  if (hop === undefined || route === undefined) {
    return null;
  }

  const { sx, sy } = pointAlong({ points: route, t: at.t });
  const isSelected = selected?.run.id === run.id;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectPacket(runIndex);
    }
  };

  return (
    <g
      data-packet={hop.id}
      data-run={run.id}
      data-selected={isSelected}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- SVG has no <button> element, so the packet's group takes the button role.
      role="button"
      tabIndex={0}
      aria-label={`Packet: ${hop.label}`}
      className="cursor-pointer outline-none"
      onClick={() => {
        selectPacket(runIndex);
      }}
      onKeyDown={onKeyDown}
    >
      {/* A wider, invisible target so the packet is easy to hit. */}
      <circle cx={sx} cy={sy} r={12} className="fill-transparent" />
      {isSelected ? (
        <circle
          cx={sx}
          cy={sy}
          r={11}
          fill="none"
          className="stroke-ink"
          strokeWidth={1.2}
          strokeDasharray="2 2"
        />
      ) : null}
      <circle
        cx={sx}
        cy={sy}
        r={5.5}
        className="fill-ink stroke-paper"
        strokeWidth={1.6}
      />
    </g>
  );
}

/**
 * The packets for the current chapter, one per run, drawn inside a view's
 * SVG. `routeOf` gives each hop's route in the view's coordinates, so the
 * Iso view and Plan view share the timing and differ only in the routes.
 *
 * Packets carry no label. The hop's own label, drawn once by the view at the
 * hop, names what the packet carries, and the side panel shows it when the
 * packet is selected.
 */
export function PacketLayer({ routeOf }: { readonly routeOf: RouteOf }) {
  const { runs, playing } = usePlayback();

  return (
    <g data-packets data-playing={playing}>
      {Arr.map(runs, (run, index) => (
        <Packet key={run.id} run={run} runIndex={index} routeOf={routeOf} />
      ))}
    </g>
  );
}
