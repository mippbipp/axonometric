import { maxRouteReach } from "@axonometric/contracts";
import type { GridPoint, View } from "@axonometric/contracts";
import { cn } from "@axonometric/ui/lib/utils";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { isTyping } from "./chapter-keys.ts";
import { controlClass } from "./control-class.ts";
import { groundAt } from "./ground-at.ts";
import { NoteToolContext, useNoteTool } from "./note-tool-context.ts";
import type { NoteTool } from "./note-tool-context.ts";
import { useReview } from "./review-context.ts";
import { useSelection } from "./selection-context.ts";

const snap = (value: number) => Math.round(value * 2) / 2;

const clamp = (value: number) =>
  Math.max(-maxRouteReach, Math.min(maxRouteReach, snap(value)));

/** `point` on the half-unit grid, kept within the reach a spot may have. */
const onGrid = ({ x, y }: GridPoint): GridPoint => ({
  x: clamp(x),
  y: clamp(y),
});

/**
 * Holds the Note tool and the spot it picked. Put it inside a
 * `SelectionProvider`: selecting a structure or a hop closes the spot's panel.
 * Escape disarms the tool, and closes the spot's panel when the tool is off.
 */
export function NoteToolProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { selected, selectedHop } = useSelection();
  const [armed, setArmed] = useState(false);
  const [spot, setSpot] = useState<GridPoint | null>(null);

  // A spot's panel lasts while nothing else is selected.
  if ((selected !== null || selectedHop !== null) && spot !== null) {
    setSpot(null);
  }

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.key !== "Escape" ||
      event.defaultPrevented ||
      isTyping(event.target)
    ) {
      return;
    }

    if (armed) {
      event.preventDefault();
      setArmed(false);
    } else if (spot !== null) {
      event.preventDefault();
      setSpot(null);
    }
  });

  useEffect(() => {
    globalThis.addEventListener("keydown", onKeyDown);

    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const value = useMemo(
    (): NoteTool => ({ armed, spot, arm: setArmed, pick: setSpot }),
    [armed, spot]
  );

  return <NoteToolContext value={value}>{children}</NoteToolContext>;
}

/**
 * The toolbar's Note button. Pressing it arms the tool; pressing it again, or
 * Escape, disarms it. Only a page that can write has it.
 */
export function NoteToolButton() {
  const review = useReview();
  const tool = useNoteTool();

  if (review === null || tool === null) {
    return null;
  }

  return (
    <button
      type="button"
      data-control="note-tool"
      className={cn(controlClass, tool.armed && "bg-ink text-paper")}
      aria-pressed={tool.armed}
      disabled={!review.canWrite}
      title="Pin a note to an empty spot on the map"
      onClick={() => {
        tool.arm(!tool.armed);
      }}
    >
      Note
    </button>
  );
}

/** What the Note tool asks for while it is armed. */
export function NoteToolHint() {
  const tool = useNoteTool();

  return tool?.armed === true ? (
    <p
      data-note-tool-hint
      className="bg-paper max-w-72 px-1 text-right text-xs opacity-80"
    >
      Click empty ground to pin a note there. Esc stops.
    </p>
  ) : null;
}

/**
 * A transparent sheet over the map's ground while the Note tool is armed. A
 * click on it picks the spot under the pointer, on the half-unit grid.
 * Structures and route segments sit above it, so they keep their own clicks.
 * It is an editing layer: a file's drawing never includes it.
 */
export function SpotPicker({ view }: { readonly view: View }) {
  const tool = useNoteTool();
  const sheet = useRef<SVGRectElement>(null);

  if (tool === null || !tool.armed) {
    return null;
  }

  return (
    <rect
      ref={sheet}
      data-spot-picker
      x={-100_000}
      y={-100_000}
      width={200_000}
      height={200_000}
      fill="transparent"
      className="cursor-crosshair"
      onClick={(event) => {
        const element = sheet.current;

        const at =
          element === null ? undefined : groundAt({ element, event, view });

        if (at !== undefined) {
          tool.pick(onGrid(at));
          tool.arm(false);
        }
      }}
    />
  );
}
