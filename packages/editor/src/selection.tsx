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
  readonly marked: ReadonlySet<string>;
}

const nobody: ReadonlySet<string> = new Set();

/**
 * Holds the selected structure, the multi-selection and the open inside view. Put it inside a
 * `PlaybackProvider`: selecting a structure, or clearing the selection,
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

  const [stored, setStored] = useState<Stored>({
    chapter,
    selected: null,
    inside: null,
    marked: nobody,
  });

  const current =
    stored.chapter === chapter &&
    stored.selected !== null &&
    stop.revealed.has(stored.selected)
      ? stored
      : null;

  const selected = current?.selected ?? null;
  const inside = current?.inside ?? null;

  const storedMarked = stored.chapter === chapter ? stored.marked : nobody;

  const marked = useMemo(
    (): ReadonlySet<string> =>
      storedMarked.size === 0
        ? nobody
        : new Set(Arr.filter([...storedMarked], (id) => stop.revealed.has(id))),
    [storedMarked, stop.revealed]
  );

  const value = useMemo(
    (): Selection => ({
      selected,
      inside,
      marked,
      select: (id) => {
        closePacket();
        setStored({ chapter, selected: id, inside: null, marked: nobody });
      },
      toggleMarked: (id) => {
        setStored((before) => {
          const here =
            before.chapter === chapter
              ? before
              : { chapter, selected: null, inside: null, marked: nobody };

          const start =
            here.marked.size === 0 && here.selected !== null
              ? [here.selected]
              : [...here.marked];

          const next = start.includes(id)
            ? Arr.filter(start, (other) => other !== id)
            : [...start, id];

          return { ...here, marked: new Set(next) };
        });
      },
      mark: (ids) => {
        setStored((before) => ({
          ...(before.chapter === chapter
            ? before
            : { chapter, selected: null, inside: null }),
          marked: new Set(ids),
        }));
      },
      clearMarked: () => {
        setStored((before) =>
          before.marked.size === 0 ? before : { ...before, marked: nobody }
        );
      },
      goInside: (id) => {
        closePacket();
        setStored({
          chapter,
          selected: id,
          inside: hasSteps(byId.get(id)) ? id : null,
          marked: nobody,
        });
      },
      comeOut: () => {
        setStored((before) => ({ ...before, inside: null }));
      },
    }),
    [byId, chapter, selected, inside, marked, closePacket]
  );

  return <SelectionContext value={value}>{children}</SelectionContext>;
}
