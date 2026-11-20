import { Array as Arr } from "effect";

import { useAcceptedPlays, useChapterMarks } from "./chapter-marks-context.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/** One look a chapter proposal draws on the map, and what it means. */
interface Key {
  readonly dash: string | undefined;
  readonly mark: "reveal" | "hide" | "play" | "unplay" | "order";
  /** The swatch's stroke class, dash and width, as the map draws the outline. */
  readonly stroke: string;
  readonly width: number;
  readonly words: string;
}

const keys: ReadonlyArray<Key> = [
  {
    dash: "5 3",
    mark: "reveal",
    stroke: "stroke-pending",
    width: 1.6,
    words: "Proposed to show",
  },
  {
    dash: undefined,
    mark: "hide",
    stroke: "stroke-refused",
    width: 1.6,
    words: "Proposed to hide",
  },
  {
    dash: undefined,
    mark: "play",
    stroke: "stroke-pending",
    width: 2.4,
    words: "Proposed to play",
  },
  {
    dash: "2 4",
    mark: "unplay",
    stroke: "stroke-refused",
    width: 3,
    words: "Proposed to stop playing",
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
    hide: hiding.size > 0,
    order: ordering.size > 0 && accepted.length > 0,
    play: playing.size > 0,
    reveal: revealing.size > 0,
    unplay: stopping.size > 0,
  } as const;

  const listed = Arr.filter(keys, ({ mark }) => shown[mark]);

  if (listed.length === 0 && !shown.order) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1.5" data-chapter-legend>
      <h3 className="text-xs tracking-widest uppercase opacity-70">
        Proposed in this chapter
      </h3>
      <ul className="flex flex-col gap-1">
        {Arr.map(listed, ({ dash, mark, stroke, width, words }) => (
          <li
            className="flex items-center gap-2 text-xs"
            data-legend={mark}
            key={mark}
          >
            <svg
              aria-hidden="true"
              className="shrink-0"
              height="8"
              viewBox="0 0 28 8"
              width="28"
            >
              <line
                className={stroke}
                strokeDasharray={dash}
                strokeWidth={width}
                x1="1"
                x2="27"
                y1="4"
                y2="4"
              />
            </svg>
            <span>{words}</span>
          </li>
        ))}
        {shown.order ? (
          <li className="flex items-center gap-2 text-xs" data-legend="order">
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
