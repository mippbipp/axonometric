import { Array as Arr } from "effect";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { usePlayback } from "./playback.ts";
import { SelectionContext } from "./selection-context.ts";
import type { Selection } from "./selection-context.ts";
import { hasSteps, useStructuresById } from "./structures.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

interface Stored {
  /** The chapter the selection was made in. Another chapter clears it. */
  readonly chapter: string;
  readonly selected: string | null;
  readonly inside: string | null;
  readonly multiSelection: ReadonlySet<string>;
}

const nobody: ReadonlySet<string> = new Set();

/** What was stored, or nothing when it was stored in another chapter. */
const inChapter = (before: Stored, chapter: string): Stored =>
  before.chapter === chapter ? before : nothingIn(chapter);

/** Nothing selected, in `chapter`. */
const nothingIn = (chapter: string): Stored => ({
  chapter,
  selected: null,
  inside: null,
  multiSelection: nobody,
});

/**
 * Holds the selected structure, the multi-selection and the open inside
 * view. Put it inside a `PlaybackProvider`: selecting a structure, or clearing the selection,
 * closes the packet panel.
 */
export function SelectionProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { stop } = useWalkthrough();
  const { closePacket } = usePlayback();
  const byId = useStructuresById();
  const chapter = stop.id;

  const [stored, setStored] = useState<Stored>(() => nothingIn(chapter));

  const current =
    stored.chapter === chapter &&
    stored.selected !== null &&
    stop.revealed.has(stored.selected)
      ? stored
      : null;

  const selected = current?.selected ?? null;
  const inside = current?.inside ?? null;

  const storedMulti =
    stored.chapter === chapter ? stored.multiSelection : nobody;

  const multiSelection = useMemo(
    (): ReadonlySet<string> =>
      storedMulti.size === 0
        ? nobody
        : new Set(Arr.filter([...storedMulti], (id) => stop.revealed.has(id))),
    [storedMulti, stop.revealed]
  );

  const value = useMemo(
    (): Selection => ({
      selected,
      inside,
      multiSelection,
      select: (id) => {
        closePacket();
        setStored({ ...nothingIn(chapter), selected: id });
      },
      toggleMultiSelected: (id) => {
        setStored((before) => {
          const here = inChapter(before, chapter);

          const start =
            here.multiSelection.size === 0 && here.selected !== null
              ? [here.selected]
              : [...here.multiSelection];

          const next = start.includes(id)
            ? Arr.filter(start, (other) => other !== id)
            : [...start, id];

          return { ...here, multiSelection: new Set(next) };
        });
      },
      setMultiSelection: (ids) => {
        setStored((before) => ({
          ...inChapter(before, chapter),
          multiSelection: new Set(ids),
        }));
      },
      clearMultiSelection: () => {
        setStored((before) =>
          before.multiSelection.size === 0
            ? before
            : { ...before, multiSelection: nobody }
        );
      },
      goInside: (id) => {
        closePacket();
        setStored({
          chapter,
          selected: id,
          inside: hasSteps(byId.get(id)) ? id : null,
          multiSelection: nobody,
        });
      },
      comeOut: () => {
        setStored((before) => ({ ...before, inside: null }));
      },
    }),
    [byId, chapter, selected, inside, multiSelection, closePacket]
  );

  return <SelectionContext value={value}>{children}</SelectionContext>;
}
