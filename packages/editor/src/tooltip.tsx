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
      show: setHovered,
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

function TooltipBox({
  hovered,
  children,
}: {
  readonly hovered: Hovered;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Placed through the DOM: the position changes with every structure, and
  // the lint rules keep inline styles out of JSX.
  useLayoutEffect(() => {
    const element = ref.current;

    if (element === null) {
      return;
    }

    const maxLeft = window.innerWidth - element.offsetWidth - 4;
    const maxTop = window.innerHeight - element.offsetHeight - 4;

    element.style.left = `${Math.min(hovered.x + offset, maxLeft)}px`;
    element.style.top = `${Math.min(hovered.y + offset, maxTop)}px`;
  }, [hovered]);

  return (
    <div
      ref={ref}
      role="tooltip"
      data-tooltip={hovered.id}
      className="border-ink bg-paper text-ink pointer-events-none fixed top-0 left-0 z-10 max-w-64 border px-2 py-1 text-xs"
    >
      {children}
    </div>
  );
}

/** The hovered structure's code, name, status and one-liner. */
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
