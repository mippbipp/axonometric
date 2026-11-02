import { wholeMapChapterId } from "@axonometric/contracts";
import { Array as Arr, Option } from "effect";
import { useState } from "react";
import type { DragEvent } from "react";

import { ChapterLegend } from "./chapter-legend.tsx";
import { useAcceptedPlays, useChapterMarks } from "./chapter-marks-context.ts";
import { controlClass } from "./control-class.ts";
import { fieldClass } from "./field-class.ts";
import { useChapterPropose } from "./use-chapter-propose.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/** `list` with the item at `from` moved to `to`. */
const moved = (
  list: readonly string[],
  from: number,
  to: number
): readonly string[] => {
  const item = list[from];

  if (item === undefined || from === to) {
    return list;
  }

  const rest = Arr.filter(list, (_other, index) => index !== from);

  return [...rest.slice(0, to), item, ...rest.slice(to)];
};

/** What a row says about a proposal that changes it. */
const proposedWords = {
  play: "Proposed to play",
  unplay: "Proposed to stop playing",
  order: "Proposed order",
} as const;

/**
 * The side panel's chapter editing, under the chapter's story: which hops the
 * chapter plays, in what order, and the structures it hasn't revealed yet.
 * Every change is a chapter proposal, which changes this chapter and nothing
 * else, and the diagram not at all. The map shows it in the pending look in
 * this chapter only.
 *
 * Hops reorder by dragging a row, or with the move up and move down buttons,
 * which are the keyboard's way to do the same.
 */
export function ChapterEditor() {
  const { state, stop, revealed } = useWalkthrough();
  const { send, failure, canPropose, sending } = useChapterPropose();
  const adding = useChapterMarks(stop.id, "play");
  const removing = useChapterMarks(stop.id, "unplay");
  const revealing = useChapterMarks(stop.id, "reveal");
  const hiding = useChapterMarks(stop.id, "hide");
  const acceptedPlays = useAcceptedPlays(stop.id);
  const [dragging, setDragging] = useState<number | undefined>();
  const [over, setOver] = useState<number | undefined>();
  const [addHop, setAddHop] = useState("");

  const chapter = Arr.findFirst(
    state.data.chapters,
    ({ id }) => id === stop.id
  );

  if (stop.id === wholeMapChapterId || Option.isNone(chapter)) {
    return null;
  }

  const { plays } = chapter.value;
  const hops = new Map(Arr.map(state.data.hops, (hop) => [hop.id, hop]));
  const names = new Map(Arr.map(state.data.structures, (s) => [s.id, s.name]));
  const nameOf = (id: string) => names.get(id) ?? id;
  const labelOf = (id: string) => hops.get(id)?.label ?? id;

  const lacking = (hop: string) => {
    const found = hops.get(hop);
    const ends = found === undefined ? [] : [found.from, found.to];

    return Arr.filter(Arr.dedupe(ends), (end) => !revealed.has(end));
  };

  // A hop the proposals add is in `plays` already; one they stop is still
  // there; one an order moved is in a different place than the accepted
  // chapter has it.
  const pendingOf = (
    hop: string,
    index: number
  ): "play" | "unplay" | "order" | undefined => {
    if (adding.has(hop)) {
      return "play";
    }

    if (removing.has(hop)) {
      return "unplay";
    }

    return acceptedPlays.includes(hop) && acceptedPlays[index] !== hop
      ? "order"
      : undefined;
  };

  const playable = Arr.filter(state.data.hops, ({ id }) => !plays.includes(id));

  const unrevealed = Arr.filter(
    state.data.structures,
    ({ id }) => !revealed.has(id)
  );

  const order = (next: readonly string[]) => {
    send({ action: "order", chapter: stop.id, plays: [...next] });
  };

  const drop = (to: number) => {
    if (dragging !== undefined) {
      order(moved(plays, dragging, to));
    }

    setDragging(undefined);
    setOver(undefined);
  };

  return (
    <section data-chapter-editor={stop.id} className="flex flex-col gap-3">
      <ChapterLegend />
      <div className="flex flex-col gap-1.5">
        <h3 className="text-xs tracking-widest uppercase opacity-70">
          Hops it plays
        </h3>
        {plays.length === 0 ? (
          <p data-plays-empty className="text-xs opacity-70">
            This chapter plays no hops.
          </p>
        ) : (
          <ol data-plays className="flex flex-col gap-1">
            {Arr.map(plays, (hop, index) => {
              const missing = lacking(hop);
              const pending = pendingOf(hop, index);

              return (
                // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- dragging a row is a pointer shortcut; the move up and move down buttons in the row do the same from the keyboard.
                <li
                  key={hop}
                  data-play={hop}
                  data-play-pending={pending}
                  data-play-over={over === index && dragging !== index}
                  draggable={canPropose && plays.length > 1}
                  className="border-ink data-[play-pending=order]:border-pending data-[play-pending=play]:border-pending data-[play-pending=unplay]:border-refused flex items-center gap-1.5 border px-1.5 py-1 text-xs data-[play-over=true]:border-dashed data-[play-pending=unplay]:border-dashed"
                  onDragStart={(event: DragEvent<HTMLLIElement>) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", hop);
                    setDragging(index);
                  }}
                  onDragOver={(event) => {
                    if (dragging !== undefined) {
                      event.preventDefault();
                      setOver(index);
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    drop(index);
                  }}
                  onDragEnd={() => {
                    setDragging(undefined);
                    setOver(undefined);
                  }}
                >
                  <span aria-hidden="true" className="cursor-grab opacity-60">
                    ⠿
                  </span>
                  <span className="w-4 shrink-0 opacity-70">{index + 1}</span>
                  <span className="min-w-0 flex-1 break-words">
                    <b className="font-medium">{labelOf(hop)}</b>
                    <span className="opacity-70">
                      {" "}
                      {nameOf(hops.get(hop)?.from ?? "")} →{" "}
                      {nameOf(hops.get(hop)?.to ?? "")}
                    </span>
                    {pending === undefined ? null : (
                      <span data-play-state className="block opacity-70">
                        {proposedWords[pending]}
                      </span>
                    )}
                    {missing.length === 0 ? null : (
                      <span data-play-lacks className="block opacity-70">
                        This chapter hasn&rsquo;t revealed{" "}
                        {Arr.join(Arr.map(missing, nameOf), " or ")}.
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    data-play-up={hop}
                    className={controlClass}
                    disabled={!canPropose || index === 0}
                    aria-label={`Move ${labelOf(hop)} up`}
                    onClick={() => {
                      order(moved(plays, index, index - 1));
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    data-play-down={hop}
                    className={controlClass}
                    disabled={!canPropose || index === plays.length - 1}
                    aria-label={`Move ${labelOf(hop)} down`}
                    onClick={() => {
                      order(moved(plays, index, index + 1));
                    }}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    data-play-toggle={hop}
                    className={controlClass}
                    disabled={!canPropose}
                    aria-label={
                      pending === "unplay"
                        ? `Keep ${labelOf(hop)} in this chapter`
                        : `Remove ${labelOf(hop)} from this chapter`
                    }
                    onClick={() => {
                      send({
                        action: pending === "unplay" ? "play" : "unplay",
                        chapter: stop.id,
                        hop,
                      });
                    }}
                  >
                    {pending === "unplay" ? "Keep" : "Remove"}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        {playable.length === 0 ? null : (
          <form
            data-add-play
            className="flex gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();

              if (addHop !== "") {
                send({ action: "play", chapter: stop.id, hop: addHop }, () => {
                  setAddHop("");
                });
              }
            }}
          >
            <label className="sr-only" htmlFor="add-play-hop">
              Hop to play in this chapter
            </label>
            <select
              id="add-play-hop"
              data-add-play-hop
              value={addHop}
              disabled={!canPropose}
              className={`${fieldClass} min-w-0 flex-1`}
              onChange={(event) => {
                setAddHop(event.target.value);
              }}
            >
              <option value="">Add a hop…</option>
              {Arr.map(playable, ({ id, label, from, to }) => (
                <option key={id} value={id}>
                  {label} ({nameOf(from)} → {nameOf(to)})
                </option>
              ))}
            </select>
            <button
              type="submit"
              data-add-play-submit
              className={controlClass}
              disabled={!canPropose || addHop === "" || sending}
            >
              Play it
            </button>
          </form>
        )}
      </div>
      {unrevealed.length === 0 ? null : (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs tracking-widest uppercase opacity-70">
            Not revealed yet
          </h3>
          <ul data-unrevealed className="flex flex-col gap-1">
            {Arr.map(unrevealed, ({ id, name }) => (
              <li
                key={id}
                data-unrevealed-structure={id}
                className="flex items-center gap-1.5 text-xs"
              >
                <span className="min-w-0 flex-1 break-words">{name}</span>
                <button
                  type="button"
                  data-reveal={id}
                  className={controlClass}
                  disabled={!canPropose}
                  onClick={() => {
                    send({ action: "reveal", chapter: stop.id, structure: id });
                  }}
                >
                  Show in this chapter
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {revealing.size + hiding.size === 0 ? null : (
        <p data-chapter-reveal-note className="text-xs opacity-70">
          {revealing.size > 0
            ? `Proposed to show here: ${Arr.join(Arr.map([...revealing], nameOf), ", ")}. `
            : ""}
          {hiding.size > 0
            ? `Proposed to hide from here: ${Arr.join(Arr.map([...hiding], nameOf), ", ")}.`
            : ""}
        </p>
      )}
      {failure === undefined ? null : (
        <p
          role="alert"
          data-chapter-failure
          className="border-refused border-l-2 pl-2 text-xs"
        >
          {failure}
        </p>
      )}
    </section>
  );
}
