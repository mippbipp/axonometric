import { groundProjections, structuresInBox } from "@axonometric/contracts";
import type { GridPoint, Placement, View } from "@axonometric/contracts";
import { GroundGesture } from "@axonometric/ui/components/ground-gesture";
import { announce } from "@axonometric/ui/lib/announce";
import { useState } from "react";

import { useEditing } from "./editing-context.ts";
import { groundAt } from "./ground-at.ts";
import { groundOutline, toPoints } from "./projection.ts";
import { useSelection } from "./selection-context.ts";
import { outlineOf } from "./selection-outline.ts";

interface Box {
  readonly from: GridPoint;
  readonly to: GridPoint;
}

const messageOf = (count: number) =>
  `${count} ${count === 1 ? "structure" : "structures"} selected.`;

const sameIds = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((id) => b.has(id));

/** Whether a Shift-press on `target` starts a box, not a press on an item. */
const onEmptyCanvas = (target: EventTarget | null) =>
  !(target instanceof Element) ||
  target.closest(
    "[data-structure], [data-packet], [data-resize-handle], [data-edge-handle]"
  ) === null;

/**
 * Selects structures with a box: hold Shift and drag on empty canvas. A
 * plain drag on empty space still pans. The box is a rectangle on the
 * ground, so in the Iso view it's a diamond. While it grows, the structures
 * whose footprints it touches are outlined. When it lifts, they join what
 * was selected when the press began, as one change, and a screen reader
 * hears how many are selected. Escape lets go and selects nothing.
 *
 * It hears presses anywhere on the canvas, and draws inside the viewport's
 * transformed group, so the box pans and zooms with the map. The viewport
 * leaves a Shift press alone (see `Viewport`), so a box drag never pans.
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
  const [box, setBox] = useState<Box | undefined>();

  const hitsOf = (at: Box) =>
    structuresInBox({ box: at, ids: [...revealed], placements });

  const touched = box === undefined ? [] : hitsOf(box);
  const left = box === undefined ? 0 : Math.min(box.from.x, box.to.x);
  const top = box === undefined ? 0 : Math.min(box.from.y, box.to.y);
  const ground = groundProjections[view];

  return (
    <GroundGesture
      className="pointer-events-none"
      disabled={editing?.canEdit !== true}
      groundAt={(element, at) =>
        element instanceof SVGGraphicsElement
          ? groundAt({ element, event: at, view })
          : undefined
      }
      onCommit={({ from, payload: kept, to }) => {
        const next = new Set([...kept, ...hitsOf({ from, to })]);

        if (!sameIds(next, multiSelection)) {
          setMultiSelection([...next]);
          announce(messageOf(next.size));
        }
      }}
      onDraft={(stroke) => {
        setBox(stroke ?? undefined);
      }}
      starts={(event: PointerEvent) =>
        event.shiftKey && onEmptyCanvas(event.target)
          ? multiSelection
          : undefined
      }
    >
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
    </GroundGesture>
  );
}
