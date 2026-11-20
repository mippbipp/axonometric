import { statusLabels } from "@axonometric/contracts";
import { use, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useStructuresById } from "./structures.ts";
import {
  HoveredContext,
  HoveredIdContext,
  TooltipActionsContext,
} from "./tooltip-context.ts";
import type { Hovered, TooltipActions } from "./tooltip-context.ts";
import { tooltipPlacement } from "./tooltip-placement.ts";
import type { Box } from "./tooltip-placement.ts";

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
      hide: (id) => {
        setHovered((current) => (current?.id === id ? null : current));
      },
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
    }),
    []
  );

  return (
    <TooltipActionsContext value={actions}>
      <HoveredContext value={hovered}>
        <HoveredIdContext value={hovered?.id ?? null}>
          {children}
        </HoveredIdContext>
      </HoveredContext>
    </TooltipActionsContext>
  );
}

function TooltipBox({
  children,
  hovered,
}: {
  readonly children: ReactNode;
  readonly hovered: Hovered;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // The lint rules keep inline styles out of JSX, and the position depends
  // on what's drawn, so the effect places the tooltip through the DOM. See
  // `tooltipPlacement` for where it goes.
  useLayoutEffect(() => {
    const element = ref.current;
    const canvas = element?.offsetParent;

    if (element === null || !(canvas instanceof HTMLElement)) {
      return;
    }

    const toBox = (rect: DOMRect): Box => ({
      height: rect.height,
      left: rect.left,
      top: rect.top,
      width: rect.width,
    });

    const target = canvas.querySelector(
      `[data-structure="${CSS.escape(hovered.id)}"]`
    );

    const boxesOf = (selector: string) =>
      [...canvas.querySelectorAll(selector)].flatMap((drawn) =>
        drawn === target ? [] : [toBox(drawn.getBoundingClientRect())]
      );

    const bounds = canvas.getBoundingClientRect();

    const at = tooltipPlacement({
      canvas: toBox(bounds),
      others: boxesOf("[data-structure]"),
      pointerX: hovered.x,
      size: { height: element.offsetHeight, width: element.offsetWidth },
      tags: boxesOf("[data-name-tag]"),
      target:
        target === null
          ? { height: 0, left: hovered.x, top: hovered.y, width: 0 }
          : toBox(target.getBoundingClientRect()),
    });

    element.style.left = `${at.left - bounds.left}px`;
    element.style.top = `${at.top - bounds.top}px`;
  }, [hovered]);

  return (
    <div
      className="border-ink bg-paper text-ink pointer-events-none absolute top-0 left-0 z-10 max-w-64 border px-2 py-1 text-xs"
      data-tooltip={hovered.id}
      ref={ref}
      role="tooltip"
    >
      {children}
    </div>
  );
}

/**
 * The hovered structure's code, name, status and one-liner. Put it inside
 * the positioned element that holds the canvas, and it stays within that
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
