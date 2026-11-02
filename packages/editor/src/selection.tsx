import { Array as Arr } from "effect";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { usePlayback } from "./playback.ts";
import { useRenames } from "./renames-context.ts";
import { SelectionContext } from "./selection-context.ts";
import type { Selection } from "./selection-context.ts";
import { hasSteps, useStructuresById } from "./structures.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

interface Stored {
  /** The chapter the selection was made in. Another chapter clears it. */
  readonly chapter: string;
  readonly selected: string | null;
  readonly hop: string | null;
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
  hop: null,
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
  const { stop, state } = useWalkthrough();
  const { closePacket } = usePlayback();
  const byId = useStructuresById();
  const renames = useRenames();
  const chapter = stop.id;

  // The agent may accept a structure the engineer proposed under another id.
  // The selection follows it, so the panel stays open on the same structure.
  const followed = (id: string | null) =>
    id === null || byId.has(id) ? id : (renames.get(id) ?? id);

  const [stored, setStored] = useState<Stored>(() => nothingIn(chapter));

  const storedSelected = followed(stored.selected);

  const current =
    stored.chapter === chapter &&
    storedSelected !== null &&
    stop.revealed.has(storedSelected)
      ? stored
      : null;

  const selected = current === null ? null : storedSelected;
  const inside = followed(current?.inside ?? null);

  // A hop stays selected only while both its ends are revealed.
  const storedHop = stored.chapter === chapter ? stored.hop : null;

  const selectedHop =
    storedHop !== null &&
    Arr.some(
      state.data.hops,
      ({ id, from, to }) =>
        id === storedHop && stop.revealed.has(from) && stop.revealed.has(to)
    )
      ? storedHop
      : null;

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
      selectedHop,
      inside,
      multiSelection,
      select: (id) => {
        closePacket();
        setStored({ ...nothingIn(chapter), selected: id });
      },
      selectHop: (id) => {
        closePacket();
        setStored({ ...nothingIn(chapter), hop: id });
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
          hop: null,
          inside: hasSteps(byId.get(id)) ? id : null,
          multiSelection: nobody,
        });
      },
      comeOut: () => {
        setStored((before) => ({ ...before, inside: null }));
      },
    }),
    [byId, chapter, selected, selectedHop, inside, multiSelection, closePacket]
  );

  return <SelectionContext value={value}>{children}</SelectionContext>;
}
