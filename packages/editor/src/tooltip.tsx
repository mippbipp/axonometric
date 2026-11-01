import { statusLabels } from "@axonometric/contracts";
import { use, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useStructuresById } from "./structures.ts";
import { HoveredContext, TooltipActionsContext } from "./tooltip-context.ts";
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

function TooltipBox({
  hovered,
  children,
}: {
  readonly hovered: Hovered;
  readonly children: ReactNode;
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
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
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
      target:
        target === null
          ? { left: hovered.x, top: hovered.y, width: 0, height: 0 }
          : toBox(target.getBoundingClientRect()),
      others: boxesOf("[data-structure]"),
      tags: boxesOf("[data-name-tag]"),
      size: { width: element.offsetWidth, height: element.offsetHeight },
      pointerX: hovered.x,
    });

    element.style.left = `${at.left - bounds.left}px`;
    element.style.top = `${at.top - bounds.top}px`;
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
