import type { Structure } from "@axonometric/contracts";
import {
  RovingList,
  RovingListItem,
} from "@axonometric/ui/components/roving-list";
import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr } from "effect";
import { useMemo } from "react";

import { useSelection } from "./selection-context.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/** The 1-based number of the chapter that first reveals each structure. */
const useRevealedIn = () => {
  const { stops } = useWalkthrough();

  return useMemo(() => {
    const firstIn = new Map<string, number>();

    stops.forEach((stop, index) => {
      for (const id of stop.revealed) {
        if (!firstIn.has(id)) {
          firstIn.set(id, index + 1);
        }
      }
    });

    return firstIn;
  }, [stops]);
};

const itemClass =
  "focus-visible:outline-ink flex w-full cursor-pointer items-baseline gap-2 px-2 py-0.5 text-left text-xs focus-visible:outline-2 focus-visible:-outline-offset-2 hover:bg-face";

function IndexItem({
  isNew,
  isSelected,
  structure,
}: {
  readonly isNew: boolean;
  readonly isSelected: boolean;
  readonly structure: Structure;
}) {
  const { select } = useSelection();

  return (
    <RovingListItem
      aria-current={isSelected ? "true" : undefined}
      className={cn(
        itemClass,
        isSelected && "bg-ink text-paper hover:bg-ink",
        isNew &&
          !isSelected &&
          "outline-ink outline-1 -outline-offset-1 outline-dashed"
      )}
      data-index-structure={structure.id}
      onClick={() => {
        select(structure.id);
      }}
      value={structure.id}
    >
      <span className="w-6 shrink-0 font-medium">{structure.code}</span>
      <span>{structure.name}</span>
    </RovingListItem>
  );
}

function LaterItem({
  chapter,
  structure,
}: {
  readonly chapter: number;
  readonly structure: Structure;
}) {
  const { goTo } = useWalkthrough();

  return (
    <RovingListItem
      aria-label={`${structure.name}, revealed in chapter ${chapter}`}
      className={cn(itemClass, "opacity-50")}
      data-index-structure={structure.id}
      data-revealed-in={chapter}
      onClick={() => {
        goTo(chapter - 1);
      }}
      value={structure.id}
    >
      <span className="w-6 shrink-0 font-medium">{structure.code}</span>
      <span>{structure.name}</span>
      <span className="ml-auto shrink-0">ch {chapter}</span>
    </RovingListItem>
  );
}

/**
 * Every structure by group, each with its code and name. Revealed ones
 * select their structure; later ones are dimmed, marked with the chapter that
 * reveals them, and jump to it. The list is one Tab stop, held by the selected
 * structure. ↑ and ↓ move focus through every item, revealed or later, and
 * Enter or Space on the focused one selects it; they don't move the
 * selection. It hides on windows narrower than 1280px, so the map keeps
 * its room.
 */
export function SideIndex({ className }: { readonly className?: string }) {
  const { newlyRevealed, revealed, state } = useWalkthrough();
  const { selected } = useSelection();
  const revealedIn = useRevealedIn();
  const { groups, structures } = state.data;

  return (
    <RovingList
      aria-label="Structures"
      className={cn(
        "border-ink hidden w-52 shrink-0 flex-col gap-3 overflow-y-auto border-r py-3 xl:flex",
        className
      )}
      data-side-index
      orientation="vertical"
      value={selected}
    >
      {Arr.map(groups, (group) => {
        const members = Arr.filter(
          structures,
          (structure) => structure.group === group.id
        );

        return members.length === 0 ? null : (
          <section data-index-group={group.id} key={group.id}>
            <h2 className="px-2 pb-1 text-xs tracking-widest uppercase opacity-70">
              {group.title}
            </h2>
            <ul>
              {Arr.map(members, (structure) => (
                <li key={structure.id}>
                  {revealed.has(structure.id) ? (
                    <IndexItem
                      isNew={newlyRevealed.has(structure.id)}
                      isSelected={selected === structure.id}
                      structure={structure}
                    />
                  ) : (
                    <LaterItem
                      chapter={revealedIn.get(structure.id) ?? 0}
                      structure={structure}
                    />
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </RovingList>
  );
}
