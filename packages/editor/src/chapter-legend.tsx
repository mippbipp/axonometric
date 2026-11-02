import { Array as Arr } from "effect";

import { useAcceptedPlays, useChapterMarks } from "./chapter-marks-context.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/** One look a chapter proposal draws on the map, and what it means. */
interface Key {
  readonly mark: "reveal" | "hide" | "play" | "unplay" | "order";
  readonly words: string;
  /** The swatch's stroke class, dash and width, as the map draws the outline. */
  readonly stroke: string;
  readonly dash: string | undefined;
  readonly width: number;
}

const keys: readonly Key[] = [
  {
    mark: "reveal",
    words: "Proposed to show",
    stroke: "stroke-pending",
    dash: "5 3",
    width: 1.6,
  },
  {
    mark: "hide",
    words: "Proposed to hide",
    stroke: "stroke-refused",
    dash: undefined,
    width: 1.6,
  },
  {
    mark: "play",
    words: "Proposed to play",
    stroke: "stroke-pending",
    dash: undefined,
    width: 2.4,
  },
  {
    mark: "unplay",
    words: "Proposed to stop playing",
    stroke: "stroke-refused",
    dash: "2 4",
    width: 3,
  },
];

/**
 * A short key for the pending looks the map draws for this chapter's
 * proposals, in the chapter details. It lists a look only while a proposal
 * draws it in this chapter, and it is gone when none does. Each swatch is
 * the outline itself, drawn with the same stroke and dash the map uses, so the
 * key and the map cannot disagree. A reorder has no mark on the map: the
 * hops it moves are marked in the list below.
 */
export function ChapterLegend() {
  const { stop } = useWalkthrough();
  const revealing = useChapterMarks(stop.id, "reveal");
  const hiding = useChapterMarks(stop.id, "hide");
  const playing = useChapterMarks(stop.id, "play");
  const stopping = useChapterMarks(stop.id, "unplay");
  const ordering = useChapterMarks(stop.id, "order");
  const accepted = useAcceptedPlays(stop.id);

  const shown = {
    reveal: revealing.size > 0,
    hide: hiding.size > 0,
    play: playing.size > 0,
    unplay: stopping.size > 0,
    order: ordering.size > 0 && accepted.length > 0,
  } as const;

  const listed = Arr.filter(keys, ({ mark }) => shown[mark]);

  if (listed.length === 0 && !shown.order) {
    return null;
  }

  return (
    <div data-chapter-legend className="flex flex-col gap-1.5">
      <h3 className="text-xs tracking-widest uppercase opacity-70">
        Proposed in this chapter
      </h3>
      <ul className="flex flex-col gap-1">
        {Arr.map(listed, ({ mark, words, stroke, dash, width }) => (
          <li
            key={mark}
            data-legend={mark}
            className="flex items-center gap-2 text-xs"
          >
            <svg
              aria-hidden="true"
              width="28"
              height="8"
              viewBox="0 0 28 8"
              className="shrink-0"
            >
              <line
                x1="1"
                y1="4"
                x2="27"
                y2="4"
                className={stroke}
                strokeWidth={width}
                strokeDasharray={dash}
              />
            </svg>
            <span>{words}</span>
          </li>
        ))}
        {shown.order ? (
          <li data-legend="order" className="flex items-center gap-2 text-xs">
            <span
              aria-hidden="true"
              className="border-pending h-2 w-7 shrink-0 border"
            />
            <span>Proposed order</span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
