import { Array as Arr, Match } from "effect";
import { useMemo } from "react";

import { controlClass } from "./control-class.ts";
import { usePlayback } from "./playback.ts";
import type { SelectedPacket } from "./playback.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/** Structure names by id, for showing ids as names. */
const useStructureNames = () => {
  const { state } = useWalkthrough();

  return useMemo(
    () => new Map(Arr.map(state.data.structures, (s) => [s.id, s.name])),
    [state.data.structures]
  );
};

function ChapterStory() {
  const { stop, index, stops, back, next, isLast } = useWalkthrough();
  const names = useStructureNames();

  return (
    <section data-chapter-story className="flex flex-col gap-3">
      <p className="text-xs tracking-widest uppercase opacity-70">
        Chapter {index + 1} of {stops.length}
      </p>
      <h2 className="text-lg leading-tight font-medium">{stop.title}</h2>
      <p className="text-sm">{stop.lede}</p>
      <p className="text-sm opacity-80">{stop.story}</p>
      {stop.newlyRevealed.length === 0 ? null : (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs tracking-widest uppercase opacity-70">
            New in this chapter
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {Arr.map(stop.newlyRevealed, (id) => (
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
  const { play, step, reducedMotion } = usePlayback();
  const { run, hop, index } = packet;
  const names = useStructureNames();
  const nameOf = (id: string) => names.get(id) ?? id;

  return (
    <section data-packet-panel={hop.id} className="flex flex-col gap-3">
      <p className="text-xs tracking-widest uppercase opacity-70">
        Packet · {run.name} · hop {index + 1} of {run.hops.length}
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
 * What the side panel shows. A selected packet wins over the chapter story.
 *
 * To add a kind of content, such as #7's pinned structure: add a member here,
 * return it from `panelContentOf` in the order it should win (a pinned
 * structure likely comes after a selected packet, since clicking a packet
 * pauses to show it), and render it in `renderContent`, whose
 * match fails to compile until every kind is handled.
 */
export type PanelContent =
  | { readonly kind: "chapter" }
  | { readonly kind: "packet"; readonly packet: SelectedPacket };

const panelContentOf = (selected: SelectedPacket | null): PanelContent =>
  selected === null
    ? { kind: "chapter" }
    : { kind: "packet", packet: selected };

const renderContent = Match.type<PanelContent>().pipe(
  Match.discriminatorsExhaustive("kind")({
    chapter: () => <ChapterStory />,
    packet: ({ packet }) => <PacketDetails packet={packet} />,
  })
);

/** The side panel next to the view. See `PanelContent` for what it shows. */
export function SidePanel() {
  const { selected } = usePlayback();

  return (
    <aside
      data-side-panel
      className="border-ink w-80 shrink-0 overflow-y-auto border-l p-4"
    >
      {renderContent(panelContentOf(selected))}
    </aside>
  );
}
