import { Array as Arr } from "effect";

import { controlClass } from "./control-class.ts";
import { usePlayback } from "./playback.ts";
import type { SelectedPacket } from "./playback.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

function ChapterStory() {
  const { stop, index, stops, state, back, next, isLast } = useWalkthrough();
  const names = new Map(Arr.map(state.data.structures, (s) => [s.id, s.name]));

  return (
    <section data-chapter-story className="flex flex-col gap-3">
      <p className="text-xs tracking-widest uppercase opacity-70">
        Chapter {index + 1} of {stops.length}
      </p>
      <h2 className="text-lg leading-tight font-medium">{stop.title}</h2>
      <p className="text-sm">{stop.lede}</p>
      <p className="text-sm opacity-80">{stop.story}</p>
      {stop.fresh.length === 0 ? null : (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs tracking-widest uppercase opacity-70">
            New in this chapter
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {Arr.map(stop.fresh, (id) => (
              <li
                key={id}
                className="border-ink border border-dashed px-1.5 py-0.5 text-xs"
              >
                {names.get(id) ?? id}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex gap-1.5">
        <button
          type="button"
          className={controlClass}
          disabled={index === 0}
          onClick={back}
        >
          ◂ Back
        </button>
        <button
          type="button"
          className={controlClass}
          disabled={isLast}
          onClick={next}
        >
          Next ▸
        </button>
      </div>
    </section>
  );
}

function PacketDetails({ packet }: { readonly packet: SelectedPacket }) {
  const { state } = useWalkthrough();
  const { play, step, reducedMotion } = usePlayback();
  const { track, hop, index } = packet;

  const names = new Map(Arr.map(state.data.structures, (s) => [s.id, s.name]));
  const nameOf = (id: string) => names.get(id) ?? id;

  return (
    <section data-packet-panel={hop.id} className="flex flex-col gap-3">
      <p className="text-xs tracking-widest uppercase opacity-70">
        Packet · {track.name} · hop {index + 1} of {track.hops.length}
      </p>
      <h2 data-packet-label className="text-lg leading-tight font-medium">
        {hop.label}
      </h2>
      <p className="text-sm">
        {nameOf(hop.from)} → {nameOf(hop.to)}
      </p>
      <p className="text-xs tracking-widest uppercase opacity-70">
        Example payload
      </p>
      {hop.payload === undefined ? (
        <p className="text-sm opacity-80">This hop has no example payload.</p>
      ) : (
        <pre
          data-packet-payload
          className="border-ink bg-face overflow-auto border p-2 text-xs"
        >
          {JSON.stringify(hop.payload, null, 2)}
        </pre>
      )}
      <div className="flex gap-1.5">
        <button type="button" className={controlClass} onClick={step}>
          Step
        </button>
        {reducedMotion ? null : (
          <button type="button" className={controlClass} onClick={play}>
            ▸ Play
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * The side panel: the selected packet's hop and payload, or the current
 * chapter's story when no packet is selected.
 */
export function SidePanel() {
  const { selected } = usePlayback();

  return (
    <aside className="border-ink w-80 shrink-0 overflow-y-auto border-l p-4">
      {selected === null ? (
        <ChapterStory />
      ) : (
        <PacketDetails packet={selected} />
      )}
    </aside>
  );
}
