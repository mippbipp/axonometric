import { groundProjections, maxRouteReach } from "@axonometric/contracts";
import type { GridPoint, Placement, View } from "@axonometric/contracts";
import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr } from "effect";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { isTyping } from "./chapter-keys.ts";
import { controlClass } from "./control-class.ts";
import { groundAt } from "./ground-at.ts";
import { NoteToolContext, useNoteTool } from "./note-tool-context.ts";
import type { NoteTool } from "./note-tool-context.ts";
import { useReview } from "./review-context.ts";
import { useSelection } from "./selection-context.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

const snap = (value: number) => Math.round(value * 2) / 2;

const clamp = (value: number) =>
  Math.max(-maxRouteReach, Math.min(maxRouteReach, snap(value)));

/** `point` on the half-unit grid, kept within the reach a spot may have. */
const onGrid = ({ x, y }: GridPoint): GridPoint => ({
  x: clamp(x),
  y: clamp(y),
});

/** How far an arrow key moves the cursor, and how far with Shift, in grid units. */
const step = 0.5;

const bigStep = 5;

const arrows = {
  ArrowRight: { x: 1, y: 0 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowDown: { x: 0, y: 1 },
  ArrowUp: { x: 0, y: -1 },
} as const satisfies Readonly<Record<string, GridPoint>>;

/** Which way an arrow key moves the cursor, or nothing for any other key. */
const directionOf = (key: string): GridPoint | undefined => {
  switch (key) {
    case "ArrowRight":
    case "ArrowLeft":
    case "ArrowDown":
    case "ArrowUp": {
      return arrows[key];
    }

    default: {
      return undefined;
    }
  }
};

/** The middle of the revealed structures on the grid: where the cursor starts. */
const middleOf = (
  placements: Readonly<Record<string, Placement>>,
  revealed: ReadonlySet<string>
): GridPoint => {
  const placed = Arr.flatMap([...revealed], (id) => {
    const at = placements[id];

    return at === undefined ? [] : [at];
  });

  return placed.length === 0
    ? { x: 0, y: 0 }
    : onGrid({
        x:
          Arr.reduce(placed, 0, (sum, at) => sum + at.x + at.w / 2) /
          placed.length,
        y:
          Arr.reduce(placed, 0, (sum, at) => sum + at.y + at.d / 2) /
          placed.length,
      });
};

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
  const { state, revealed } = useWalkthrough();
  const [cursor, setCursor] = useState<GridPoint | null>(null);
  const [spot, setSpot] = useState<GridPoint | null>(null);
  const armed = cursor !== null;

  // A spot's panel lasts while nothing else is selected.
  if ((selected !== null || selectedHop !== null) && spot !== null) {
    setSpot(null);
  }

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || isTyping(event.target)) {
      return;
    }

    if (event.key === "Escape") {
      if (armed) {
        event.preventDefault();
        setCursor(null);
      } else if (spot !== null) {
        event.preventDefault();
        setSpot(null);
      }

      return;
    }

    if (cursor === null || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    const direction = directionOf(event.key);

    if (direction !== undefined) {
      event.preventDefault();

      const by = event.shiftKey ? bigStep : step;

      setCursor(
        onGrid({
          x: cursor.x + direction.x * by,
          y: cursor.y + direction.y * by,
        })
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      setSpot(cursor);
      setCursor(null);
    }
  });

  useEffect(() => {
    globalThis.addEventListener("keydown", onKeyDown);

    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const start = useMemo(
    () => middleOf(state.layout.structures, revealed),
    [state.layout.structures, revealed]
  );

  const value = useMemo(
    (): NoteTool => ({
      armed,
      cursor,
      spot,
      arm: (on) => {
        setCursor(on ? start : null);
      },
      pick: setSpot,
    }),
    [armed, cursor, spot, start]
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
      aria-live="polite"
      className="bg-paper max-w-72 px-1 text-right text-xs opacity-80"
    >
      Click empty ground to pin a note there, or move the cursor with the arrow
      keys (Shift for five units) and press Enter. Esc stops.
      {tool.cursor === null ? null : (
        <b className="block font-medium" data-spot-readout>
          Spot {tool.cursor.x}, {tool.cursor.y}
        </b>
      )}
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

/**
 * The grid cursor of the Note tool: a crosshair on the ground at the spot the
 * arrow keys picked, and a live readout of its position for a screen reader.
 * It is an editing layer: a file's drawing never includes it.
 */
export function SpotCursor({ view }: { readonly view: View }) {
  const tool = useNoteTool();

  if (tool?.cursor === null || tool === null) {
    return null;
  }

  const at = groundProjections[view].toScreen(tool.cursor);
  const arm = 9;

  return (
    <g
      pointerEvents="none"
      data-spot-cursor={`${tool.cursor.x},${tool.cursor.y}`}
    >
      <title>{`Note at the spot ${tool.cursor.x}, ${tool.cursor.y}`}</title>
      <path
        d={`M ${at.sx - arm} ${at.sy} H ${at.sx + arm} M ${at.sx} ${at.sy - arm} V ${at.sy + arm}`}
        className="stroke-ink fill-none"
        strokeWidth={1.6}
      />
      <circle
        cx={at.sx}
        cy={at.sy}
        r={arm / 2}
        className="stroke-ink fill-none"
        strokeWidth={1.6}
      />
    </g>
  );
}
