import {
  RovingList,
  RovingListItem,
} from "@axonometric/ui/components/roving-list";
import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr } from "effect";

import { controlClass } from "./control-class.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/**
 * Numbered buttons for every chapter, and the current chapter's title. The
 * rail is one Tab stop, held by the current chapter; ← and → move focus along
 * it without changing the chapter.
 */
export function ChapterRail({ className }: { readonly className?: string }) {
  const { goTo, index, stop, stops } = useWalkthrough();

  return (
    <RovingList
      aria-label="Chapters"
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      data-chapter-rail
      orientation="horizontal"
      value={stop.id}
    >
      {Arr.map(stops, (chapter, position) => (
        <RovingListItem
          aria-current={position === index ? "step" : undefined}
          aria-label={`Chapter ${position + 1}: ${chapter.title}`}
          className={cn(
            controlClass,
            "size-6 p-0 leading-none",
            position === index && "bg-ink text-paper",
            position < index && "bg-face"
          )}
          data-chapter={chapter.id}
          key={chapter.id}
          onClick={() => {
            goTo(position);
          }}
          title={chapter.title}
          value={chapter.id}
        >
          {position + 1}
        </RovingListItem>
      ))}
      <span className="ml-1.5 text-xs tracking-widest uppercase opacity-70">
        Chapter {index + 1} ·{" "}
        <b className="font-medium opacity-100">{stop.title}</b>
      </span>
    </RovingList>
  );
}
