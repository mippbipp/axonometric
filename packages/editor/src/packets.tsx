import { Array as Arr } from "effect";
import type { KeyboardEvent } from "react";

import type { Track } from "./chapters.ts";
import { pointAlong, screenRouteOf } from "./iso.ts";
import { packetAt } from "./packet-schedule.ts";
import { usePlayback, usePlaybackClock } from "./playback.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

function Packet({
  track,
  trackIndex,
  showLabel,
}: {
  readonly track: Track;
  readonly trackIndex: number;
  readonly showLabel: boolean;
}) {
  const { state } = useWalkthrough();
  const { selected, selectPacket } = usePlayback();
  const clock = usePlaybackClock();
  const at = packetAt({ clock, hops: track.hops.length });
  const hop = track.hops[at.hop];

  const route =
    hop === undefined
      ? undefined
      : screenRouteOf({ layout: state.layout, hop });

  if (hop === undefined || route === undefined) {
    return null;
  }

  const { sx, sy } = pointAlong({ points: route, t: at.t });
  const isSelected = selected?.track.id === track.id;
  const labelWidth = hop.label.length * 6.6 + 8;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectPacket(trackIndex);
    }
  };

  return (
    <g>
      <g
        data-packet={hop.id}
        data-track={track.id}
        data-selected={isSelected}
        // SVG has no button element, so the dot takes the button role.
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- see above
        role="button"
        tabIndex={0}
        aria-label={`Packet: ${hop.label}`}
        className="cursor-pointer outline-none"
        onClick={() => {
          selectPacket(trackIndex);
        }}
        onKeyDown={onKeyDown}
      >
        {/* A wider, invisible target so the dot is easy to hit. */}
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
      {showLabel || isSelected ? (
        <g className="pointer-events-none" aria-hidden="true">
          <rect
            x={sx + 8}
            y={sy - 21}
            width={labelWidth}
            height={15}
            className="fill-paper stroke-ink"
            strokeWidth={0.8}
          />
          <text
            x={sx + 12}
            y={sy - 10}
            fontSize={10}
            className="fill-ink stroke-none font-mono"
          >
            {hop.label}
          </text>
        </g>
      ) : null}
    </g>
  );
}

/**
 * The packets for the current chapter, one per track, drawn in screen
 * coordinates. Put it inside the view's SVG.
 */
export function PacketLayer() {
  const { isLast } = useWalkthrough();
  const { tracks, playing } = usePlayback();

  return (
    <g data-packets data-playing={playing}>
      {Arr.map(tracks, (track, index) => (
        <Packet
          key={track.id}
          track={track}
          trackIndex={index}
          // The last chapter can play every flow at once, so labels there
          // only show for the selected packet.
          showLabel={!isLast}
        />
      ))}
    </g>
  );
}
