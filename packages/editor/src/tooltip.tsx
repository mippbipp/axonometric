import { statusLabels } from "@axonometric/contracts";
import {
  createTooltipController,
  Tooltip,
  TooltipContent,
} from "@axonometric/ui/components/tooltip";
import { use, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useStructuresById } from "./structures.ts";
import { HoveredIdContext, TooltipActionsContext } from "./tooltip-context.ts";
import type { Hovered, TooltipActions } from "./tooltip-context.ts";
import { tooltipPlacement } from "./tooltip-placement.ts";
import type { Box } from "./tooltip-placement.ts";

/**
 * Holds which structure is under the pointer or keyboard focus, and the one
 * tooltip every structure shares. The actions sit in their own context, so a
 * hover only redraws what reads the id.
 */
export function TooltipProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const controller = useMemo(() => createTooltipController<string>(), []);
  const latest = useRef<Hovered | null>(null);

  const actions = useMemo(
    (): TooltipActions => ({
      controller,
      hide: (id) => {
        setHoveredId((current) => (current === id ? null : current));
      },
      last: () => latest.current,
      show: (next) => {
        // Small pointer moves keep the tooltip where it is, so moving over a
        // structure doesn't make it chase the pointer.
        const { current } = latest;

        if (
          current?.id !== next.id ||
          Math.abs(current.x - next.x) >= 8 ||
          Math.abs(current.y - next.y) >= 8
        ) {
          latest.current = next;
        }

        setHoveredId(next.id);
      },
    }),
    [controller]
  );

  return (
    <TooltipActionsContext value={actions}>
      <HoveredIdContext value={hoveredId}>{children}</HoveredIdContext>
    </TooltipActionsContext>
  );
}

const toBox = (rect: DOMRect): Box => ({
  height: rect.height,
  left: rect.left,
  top: rect.top,
  width: rect.width,
});

/**
 * Where the tooltip for `hovered` goes, as the corner ui-sdk lines it up
 * with: clear of the other structures and name tags, and inside the canvas.
 * See `tooltipPlacement` for the order it tries.
 */
const placeAt = (hovered: Hovered, tooltip: HTMLElement) => {
  const target = document.querySelector(
    `[data-structure="${CSS.escape(hovered.id)}"]`
  );

  const canvas = target?.closest("[data-map-surface]");

  if (target === null || target === undefined || !(canvas instanceof Element)) {
    return { x: hovered.x, y: hovered.y };
  }

  const boxesOf = (selector: string) =>
    [...canvas.querySelectorAll(selector)].flatMap((drawn) =>
      drawn === target ? [] : [toBox(drawn.getBoundingClientRect())]
    );

  const at = tooltipPlacement({
    canvas: toBox(canvas.getBoundingClientRect()),
    others: boxesOf("[data-structure]"),
    pointerX: hovered.x,
    size: { height: tooltip.offsetHeight, width: tooltip.offsetWidth },
    tags: boxesOf("[data-name-tag]"),
    target: toBox(target.getBoundingClientRect()),
  });

  return { x: at.left, y: at.top };
};

/**
 * The hovered structure's code, name, status and one-liner, in ui-sdk's
 * Tooltip. Every structure is a trigger of the one tooltip, through
 * `StructureTarget`, so ui-sdk opens it on hover and on keyboard focus,
 * closes it on Escape, and describes the structure by it. Where it sits is
 * ours: ui-sdk only puts it above or below its trigger, and this keeps it off
 * the other structures. It is the point `placeAt` picks, and ui-sdk lines its
 * top-left corner up there.
 */
export function StructureTooltip() {
  const actions = use(TooltipActionsContext);
  const byId = useStructuresById();
  const element = useRef<HTMLDivElement>(null);

  const anchor = useMemo(
    () => ({
      getBoundingClientRect: () => {
        const hovered = actions?.last();
        const tooltip = element.current;

        const { x, y } =
          hovered === null || hovered === undefined || tooltip === null
            ? { x: 0, y: 0 }
            : placeAt(hovered, tooltip);

        return { height: 0, width: 0, x, y };
      },
    }),
    [actions]
  );

  if (actions === null) {
    return null;
  }

  return (
    <Tooltip controller={actions.controller} delay={0}>
      <TooltipContent<string>
        align="start"
        anchor={anchor}
        className="pointer-events-none"
        collisionPadding={0}
        ref={element}
        render={(props, state) => (
          <div
            {...props}
            data-tooltip={state.open ? state.payload : undefined}
          />
        )}
        side="bottom"
        sideOffset={0}
      >
        {(state) => {
          const structure =
            state.payload === undefined ? undefined : byId.get(state.payload);

          return structure === undefined ? null : (
            <>
              <p className="font-medium">
                {structure.code} · {structure.name} ·{" "}
                {statusLabels[structure.status]}
              </p>
              <p className="opacity-80">{structure.oneLiner}</p>
            </>
          );
        }}
      </TooltipContent>
    </Tooltip>
  );
}
