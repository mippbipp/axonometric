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
}

/**
 * Holds the selected structure and the open inside view. Put it inside a
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
  });

  const current =
    stored.chapter === chapter &&
    stored.selected !== null &&
    stop.revealed.has(stored.selected)
      ? stored
      : null;

  const selected = current?.selected ?? null;
  const inside = current?.inside ?? null;

  const value = useMemo(
    (): Selection => ({
      selected,
      inside,
      select: (id) => {
        closePacket();
        setStored({ chapter, selected: id, inside: null });
      },
      goInside: (id) => {
        closePacket();
        setStored({
          chapter,
          selected: id,
          inside: hasSteps(byId.get(id)) ? id : null,
        });
      },
      comeOut: () => {
        setStored((before) => ({ ...before, inside: null }));
      },
    }),
    [byId, chapter, selected, inside, closePacket]
  );

  return <SelectionContext value={value}>{children}</SelectionContext>;
}
