import { statusLabels } from "@axonometric/contracts";
import { use, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useStructuresById } from "./structures.ts";
import { HoveredContext, TooltipActionsContext } from "./tooltip-context.ts";
import type { Hovered, TooltipActions } from "./tooltip-context.ts";

/**
 * Holds which structure the tooltip shows. The actions sit in their own
 * context, so showing the tooltip only redraws the tooltip.
 */
export function TooltipProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [hovered, setHovered] = useState<Hovered | null>(null);

  const actions = useMemo(
    (): TooltipActions => ({
      show: (next) => {
        // Small pointer moves keep the tooltip where it is, so moving over a
        // structure doesn't redraw it on every event.
        setHovered((current) =>
          current?.id === next.id &&
          Math.abs(current.x - next.x) < 8 &&
          Math.abs(current.y - next.y) < 8
            ? current
            : next
        );
      },
      hide: (id) => {
        setHovered((current) => (current?.id === id ? null : current));
      },
    }),
    []
  );

  return (
    <TooltipActionsContext value={actions}>
      <HoveredContext value={hovered}>{children}</HoveredContext>
    </TooltipActionsContext>
  );
}

/** How far the tooltip sits from the pointer, in pixels. */
const offset = 14;

/** The gap the tooltip keeps from the canvas's edges, in pixels. */
const edge = 4;

function TooltipBox({
  hovered,
  children,
}: {
  readonly hovered: Hovered;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Placed through the DOM: the position changes with every structure, and
  // the lint rules keep inline styles out of JSX. The tooltip sits below and
  // right of the pointer, flips to the other side where it would leave the
  // canvas, and is clamped to the canvas as a last resort.
  useLayoutEffect(() => {
    const element = ref.current;
    const canvas = element?.offsetParent;

    if (element === null || !(canvas instanceof HTMLElement)) {
      return;
    }

    const bounds = canvas.getBoundingClientRect();
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const x = hovered.x - bounds.left;
    const y = hovered.y - bounds.top;

    const place = (at: number, size: number, room: number) => {
      const after = at + offset;
      const before = at - offset - size;
      const preferred = after + size <= room - edge ? after : before;

      return Math.max(edge, Math.min(preferred, room - size - edge));
    };

    element.style.left = `${place(x, width, bounds.width)}px`;
    element.style.top = `${place(y, height, bounds.height)}px`;
  }, [hovered]);

  return (
    <div
      ref={ref}
      role="tooltip"
      data-tooltip={hovered.id}
      className="border-ink bg-paper text-ink pointer-events-none absolute top-0 left-0 z-10 max-w-64 border px-2 py-1 text-xs"
    >
      {children}
    </div>
  );
}

/**
 * The hovered structure's code, name, status and one-liner. Put it inside
 * the positioned element that holds the canvas: it stays within that
 * element's box.
 */
export function StructureTooltip() {
  const hovered = use(HoveredContext);
  const byId = useStructuresById();
  const structure = hovered === null ? undefined : byId.get(hovered.id);

  if (hovered === null || structure === undefined) {
    return null;
  }

  return (
    <TooltipBox hovered={hovered}>
      <p className="font-medium">
        {structure.code} · {structure.name} · {statusLabels[structure.status]}
      </p>
      <p className="opacity-80">{structure.oneLiner}</p>
    </TooltipBox>
  );
}
