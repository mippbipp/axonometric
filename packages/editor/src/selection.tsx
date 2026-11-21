import { followed as followedId } from "@axonometric/contracts";
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
  /** The group whose panel is open, from a click on its zone's title. */
  readonly group: string | null;
  readonly hop: string | null;
  readonly inside: string | null;
  readonly multiSelection: ReadonlySet<string>;
  readonly selected: string | null;
}

const nobody: ReadonlySet<string> = new Set();

/** What was stored, or nothing when it was stored in another chapter. */
const inChapter = (before: Stored, chapter: string): Stored =>
  before.chapter === chapter ? before : nothingIn(chapter);

/** Nothing selected, in `chapter`. */
const nothingIn = (chapter: string): Stored => ({
  chapter,
  group: null,
  hop: null,
  inside: null,
  multiSelection: nobody,
  selected: null,
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
  const { state, stop } = useWalkthrough();
  const { closePacket } = usePlayback();
  const byId = useStructuresById();
  const renames = useRenames();
  const chapter = stop.id;

  // The agent may accept a structure the engineer proposed under another id.
  // The selection follows it, so the panel stays open on the same structure.
  const followed = (id: string | null) =>
    id === null || byId.has(id) ? id : followedId(renames, "structure", id);

  const followedHop = (id: string) =>
    Arr.some(state.data.hops, (hop) => hop.id === id)
      ? id
      : followedId(renames, "hop", id);

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

  // A hop stays selected only while both its ends are revealed. The agent may
  // accept a hop the engineer drew under another id, and the selection
  // follows it.
  const storedHop =
    stored.chapter === chapter && stored.hop !== null
      ? followedHop(stored.hop)
      : null;

  const selectedHop =
    storedHop !== null &&
    Arr.some(
      state.data.hops,
      ({ from, id, to }) =>
        id === storedHop && stop.revealed.has(from) && stop.revealed.has(to)
    )
      ? storedHop
      : null;

  // A group stays selected only while the map still has it.
  const storedGroup = stored.chapter === chapter ? stored.group : null;

  const selectedGroup =
    storedGroup !== null &&
    Arr.some(state.data.groups, ({ id }) => id === storedGroup)
      ? storedGroup
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
      clearMultiSelection: () => {
        setStored((before) =>
          before.multiSelection.size === 0
            ? before
            : { ...before, multiSelection: nobody }
        );
      },
      comeOut: () => {
        setStored((before) => ({ ...before, inside: null }));
      },
      goInside: (id) => {
        closePacket();
        setStored({
          chapter,
          group: null,
          hop: null,
          inside: hasSteps(byId.get(id)) ? id : null,
          multiSelection: nobody,
          selected: id,
        });
      },
      inside,
      multiSelection,
      select: (id) => {
        closePacket();
        setStored({ ...nothingIn(chapter), selected: id });
      },
      selected,
      selectedGroup,
      selectedHop,
      selectGroup: (id) => {
        closePacket();
        setStored({ ...nothingIn(chapter), group: id });
      },
      selectHop: (id) => {
        closePacket();
        setStored({ ...nothingIn(chapter), hop: id });
      },
      setMultiSelection: (ids) => {
        setStored((before) => ({
          ...inChapter(before, chapter),
          multiSelection: new Set(ids),
        }));
      },
    }),
    [
      byId,
      chapter,
      selected,
      selectedHop,
      selectedGroup,
      inside,
      multiSelection,
      closePacket,
    ]
  );

  return <SelectionContext value={value}>{children}</SelectionContext>;
}
