import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr } from "effect";

import { controlClass } from "./control-class.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/** Numbered buttons for every chapter, and the current chapter's title. */
export function ChapterRail({ className }: { readonly className?: string }) {
  const { goTo, index, stop, stops } = useWalkthrough();

  return (
    <nav
      aria-label="Chapters"
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      data-chapter-rail
    >
      {Arr.map(stops, (chapter, position) => (
        <button
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
          type="button"
        >
          {position + 1}
        </button>
      ))}
      <span className="ml-1.5 text-xs tracking-widest uppercase opacity-70">
        Chapter {index + 1} ·{" "}
        <b className="font-medium opacity-100">{stop.title}</b>
      </span>
    </nav>
  );
}
