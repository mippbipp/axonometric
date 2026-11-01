import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr } from "effect";

import { useWalkthrough } from "./walkthrough.tsx";

/** Numbered buttons for every chapter, and the current chapter's title. */
export function ChapterRail({ className }: { readonly className?: string }) {
  const { stops, index, stop, goTo } = useWalkthrough();

  return (
    <nav
      aria-label="Chapters"
      data-chapter-rail
      className={cn("flex flex-wrap items-center gap-1.5", className)}
    >
      {Arr.map(stops, (chapter, position) => (
        <button
          key={chapter.id}
          type="button"
          data-chapter={chapter.id}
          title={chapter.title}
          aria-label={`Chapter ${position + 1}: ${chapter.title}`}
          aria-current={position === index ? "step" : undefined}
          className={cn(
            "border-ink focus-visible:outline-ink size-6 cursor-pointer border-[1.5px] text-[10px] leading-none focus-visible:outline-2 focus-visible:outline-offset-1",
            position === index
              ? "bg-ink text-paper"
              : position < index
                ? "bg-face text-ink"
                : "bg-paper text-ink"
          )}
          onClick={() => {
            goTo(position);
          }}
        >
          {position + 1}
        </button>
      ))}
      <span className="ml-1.5 text-[10px] tracking-widest uppercase opacity-70">
        Chapter {index + 1} ·{" "}
        <b className="font-medium opacity-100">{stop.title}</b>
      </span>
    </nav>
  );
}
