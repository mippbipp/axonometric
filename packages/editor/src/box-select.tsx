import { groundProjections, structuresInBox } from "@axonometric/contracts";
import type { GridPoint, Placement, View } from "@axonometric/contracts";
import { announce } from "@axonometric/ui/lib/announce";
import { bindCanvasDrag } from "@axonometric/ui/lib/canvas-drag";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { useEditing } from "./editing-context.ts";
import { groundAt } from "./ground-at.ts";
import { groundOutline, toPoints } from "./projection.ts";
import { useSelection } from "./selection-context.ts";
import { outlineOf } from "./selection-outline.ts";

interface Box {
  readonly from: GridPoint;
  readonly to: GridPoint;
}

/** Selected structures, as a screen reader hears the count. */
const messageOf = (count: number) =>
  `${count} ${count === 1 ? "structure" : "structures"} selected.`;

/** Listens for presses on `svg`, and returns a function that stops. */
const listen = (
  svg: SVGSVGElement,
  onDown: (event: PointerEvent) => void,
  onStop: () => void
) => {
  svg.addEventListener("pointerdown", onDown);

  return () => {
    svg.removeEventListener("pointerdown", onDown);
    onStop();
  };
};

const sameIds = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((id) => b.has(id));

/**
 * Selects structures with a box: hold Shift and drag on empty canvas. A
 * plain drag on empty space still pans. The box is a rectangle on the
 * ground, so in the Iso view it's a diamond. While it grows, the structures
 * whose footprints it touches are outlined. When it lifts, they join what
 * was selected when the press began, as one change, and a screen reader
 * hears how many are selected. Escape lets go and selects nothing.
 *
 * It listens on the canvas that holds it, and draws inside the viewport's
 * transformed group, so the box pans and zooms with the map. The viewport
 * leaves a Shift press alone (see `PannableCanvas`), so a box drag never pans.
 *
 * This is ui-sdk's `bindDrag` with `structuresInBox` and `announce`, not
 * `createLasso`. The lasso hit-tests each item's screen bounding box against
 * a screen rectangle, so in the Iso view it picks different structures from
 * the ground box (0 of 6 drags agreed, measured in the #137 spike). It moves
 * to `createLasso` once it takes a `touches` option:
 * https://github.com/vercel-labs/ui/issues/961
 */
export function BoxSelect({
  placements,
  revealed,
  view,
}: {
  readonly placements: Readonly<Partial<Record<string, Placement>>>;
  /** The structures that are on the map now. */
  readonly revealed: ReadonlySet<string>;
  readonly view: View;
}) {
  const editing = useEditing();
  const { multiSelection, setMultiSelection } = useSelection();
  const anchor = useRef<SVGGElement>(null);
  const stop = useRef<(() => void) | undefined>(undefined);
  const [box, setBox] = useState<Box | undefined>();
  const live = editing?.canEdit === true;

  const hitsOf = useEffectEvent((at: Box): ReadonlyArray<string> =>
    structuresInBox({ box: at, ids: [...revealed], placements })
  );

  const onDown = useEffectEvent((event: PointerEvent) => {
    const element = anchor.current;
    const svg = element?.ownerSVGElement;

    if (
      element === null ||
      svg === null ||
      svg === undefined ||
      event.button !== 0 ||
      !event.shiftKey ||
      (event.target instanceof Element &&
        event.target.closest(
          "[data-structure], [data-packet], [data-resize-handle], [data-edge-handle]"
        ) !== null)
    ) {
      return;
    }

    const from = groundAt({ element, event, view });

    if (from === undefined) {
      return;
    }

    const kept = multiSelection;
    let latest: Box | undefined;

    stop.current?.();
    stop.current = bindCanvasDrag(svg, event, {
      onEnd: ({ canceled }) => {
        stop.current = undefined;
        setBox(undefined);

        if (canceled || latest === undefined) {
          return;
        }

        const next = new Set([...kept, ...hitsOf(latest)]);

        if (!sameIds(next, multiSelection)) {
          setMultiSelection([...next]);
          announce(messageOf(next.size));
        }
      },
      onMove: (position) => {
        const to = groundAt({ element, event: position, view });

        if (to === undefined) {
          return;
        }

        latest = { from, to };
        setBox(latest);
      },
    });
  });

  useEffect(() => {
    const svg = anchor.current?.ownerSVGElement;

    return live && svg !== null && svg !== undefined
      ? listen(svg, onDown, () => {
          stop.current?.();
          stop.current = undefined;
          setBox(undefined);
        })
      : undefined;
  }, [live]);

  const touched =
    box === undefined
      ? []
      : structuresInBox({ box, ids: [...revealed], placements });

  const left = box === undefined ? 0 : Math.min(box.from.x, box.to.x);
  const top = box === undefined ? 0 : Math.min(box.from.y, box.to.y);
  const ground = groundProjections[view];

  return (
    <g className="pointer-events-none" ref={anchor}>
      {box === undefined ? null : (
        <>
          {touched.map((id) => {
            const at = placements[id];

            return at === undefined ? null : (
              <polygon
                aria-hidden="true"
                className="fill-multi/10 stroke-multi"
                data-box-touched={id}
                key={id}
                points={toPoints(groundOutline(outlineOf(at), ground))}
                strokeDasharray="5 3"
                strokeWidth={1.5}
              />
            );
          })}
          <polygon
            aria-hidden="true"
            className="fill-multi/10 stroke-multi"
            data-selection-box=""
            points={toPoints(
              groundOutline(
                {
                  d: Math.abs(box.to.y - box.from.y),
                  w: Math.abs(box.to.x - box.from.x),
                  x: left,
                  y: top,
                },
                ground
              )
            )}
            strokeDasharray="5 3"
            strokeWidth={1.5}
          />
        </>
      )}
    </g>
  );
}
