import type { Structure } from "@axonometric/contracts";
import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr } from "effect";
import { useMemo } from "react";
import type { KeyboardEvent } from "react";

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

/** How far ↓ and ↑ move the selection through the index. */
const arrowSteps: ReadonlyMap<string, number> = new Map([
  ["ArrowDown", 1],
  ["ArrowUp", -1],
]);

const itemClass =
  "focus-visible:outline-ink flex w-full cursor-pointer items-baseline gap-2 px-2 py-0.5 text-left text-xs focus-visible:outline-2 focus-visible:-outline-offset-2 hover:bg-face";

function IndexItem({
  isNew,
  isSelected,
  onKeyDown,
  structure,
}: {
  readonly isNew: boolean;
  readonly isSelected: boolean;
  readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  readonly structure: Structure;
}) {
  const { select } = useSelection();

  return (
    <button
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
      onKeyDown={onKeyDown}
      type="button"
    >
      <span className="w-6 shrink-0 font-medium">{structure.code}</span>
      <span>{structure.name}</span>
    </button>
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
    <button
      aria-label={`${structure.name}, revealed in chapter ${chapter}`}
      className={cn(itemClass, "opacity-50")}
      data-index-structure={structure.id}
      data-revealed-in={chapter}
      onClick={() => {
        goTo(chapter - 1);
      }}
      type="button"
    >
      <span className="w-6 shrink-0 font-medium">{structure.code}</span>
      <span>{structure.name}</span>
      <span className="ml-auto shrink-0">ch {chapter}</span>
    </button>
  );
}

/**
 * Every structure by group, each with its code and name. Revealed ones
 * select their structure; later ones are dimmed, marked with the chapter that
 * reveals them, and jump to it. ↑ and ↓ move the selection through the
 * revealed ones. It hides on windows narrower than 1280px, so the map keeps
 * its room.
 */
export function SideIndex({ className }: { readonly className?: string }) {
  const { newlyRevealed, revealed, state } = useWalkthrough();
  const { select, selected } = useSelection();
  const revealedIn = useRevealedIn();
  const { groups, structures } = state.data;

  const order = Arr.flatMap(groups, (group) =>
    Arr.filter(
      structures,
      (structure) => structure.group === group.id && revealed.has(structure.id)
    )
  );

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = arrowSteps.get(event.key);

    if (step === undefined || order.length === 0) {
      return;
    }

    event.preventDefault();

    const at = order.findIndex(({ id }) => id === selected);
    const from = at === -1 && step === -1 ? order.length : at;
    const next = order[Math.max(0, Math.min(order.length - 1, from + step))];

    if (next !== undefined) {
      select(next.id);
      event.currentTarget
        .closest("[data-side-index]")
        ?.querySelector<HTMLElement>(`[data-index-structure="${next.id}"]`)
        ?.focus();
    }
  };

  return (
    <nav
      aria-label="Structures"
      className={cn(
        "border-ink hidden w-52 shrink-0 flex-col gap-3 overflow-y-auto border-r py-3 xl:flex",
        className
      )}
      data-side-index
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
                      onKeyDown={onKeyDown}
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
    </nav>
  );
}
