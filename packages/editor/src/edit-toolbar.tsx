import { alignMoves, distributeMoves } from "@axonometric/contracts";
import type { Alignment, Axis, View } from "@axonometric/contracts";
import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr } from "effect";
import { useState } from "react";
import type { ReactNode } from "react";

import { controlClass } from "./control-class.ts";
import { useEditing } from "./editing-context.ts";
import { useSelection } from "./selection-context.ts";

/**
 * What a button is called in each view. Plan view draws x to the right and
 * y down, so the names are the usual ones. The Iso view turns the ground a
 * quarter turn: x runs down and to the right, y down and to the left. There
 * "left" would line things up on a diagonal, so the buttons say which
 * diagonal edge of the ground they use instead, with the axis in brackets.
 */
interface Names {
  readonly plan: string;
  readonly iso: string;
}

/** One button's icon, drawn on a 16 by 16 plan of the ground. */
interface Control {
  readonly label: Names;
  readonly icon: ReactNode;
}

const alignments: readonly (Control & { readonly how: Alignment })[] = [
  {
    how: "left",
    label: {
      plan: "Align left edges",
      iso: "Align to the upper-left edge (smallest x)",
    },
    icon: (
      <>
        <path d="M2 1v14" />
        <rect x="4" y="3" width="9" height="4" />
        <rect x="4" y="9" width="5" height="4" />
      </>
    ),
  },
  {
    how: "centre-x",
    label: {
      plan: "Align centres on x (a vertical line)",
      iso: "Align centres on x (a line from lower-left to upper-right)",
    },
    icon: (
      <>
        <path d="M8 1v14" />
        <rect x="3" y="3" width="10" height="4" />
        <rect x="5" y="9" width="6" height="4" />
      </>
    ),
  },
  {
    how: "right",
    label: {
      plan: "Align right edges",
      iso: "Align to the lower-right edge (largest x)",
    },
    icon: (
      <>
        <path d="M14 1v14" />
        <rect x="3" y="3" width="9" height="4" />
        <rect x="7" y="9" width="5" height="4" />
      </>
    ),
  },
  {
    how: "top",
    label: {
      plan: "Align top edges",
      iso: "Align to the upper-right edge (smallest y)",
    },
    icon: (
      <>
        <path d="M1 2h14" />
        <rect x="3" y="4" width="4" height="9" />
        <rect x="9" y="4" width="4" height="5" />
      </>
    ),
  },
  {
    how: "centre-y",
    label: {
      plan: "Align centres on y (a horizontal line)",
      iso: "Align centres on y (a line from upper-left to lower-right)",
    },
    icon: (
      <>
        <path d="M1 8h14" />
        <rect x="3" y="3" width="4" height="10" />
        <rect x="9" y="5" width="4" height="6" />
      </>
    ),
  },
  {
    how: "bottom",
    label: {
      plan: "Align bottom edges",
      iso: "Align to the lower-left edge (largest y)",
    },
    icon: (
      <>
        <path d="M1 14h14" />
        <rect x="3" y="3" width="4" height="9" />
        <rect x="9" y="7" width="4" height="5" />
      </>
    ),
  },
];

const distributions: readonly (Control & { readonly axis: Axis })[] = [
  {
    axis: "x",
    label: {
      plan: "Distribute horizontally",
      iso: "Distribute along x (down and to the right)",
    },
    icon: (
      <>
        <path d="M1 1v14M15 1v14" />
        <rect x="6" y="4" width="4" height="8" />
      </>
    ),
  },
  {
    axis: "y",
    label: {
      plan: "Distribute vertically",
      iso: "Distribute along y (down and to the left)",
    },
    icon: (
      <>
        <path d="M1 1h14M1 15h14" />
        <rect x="4" y="6" width="8" height="4" />
      </>
    ),
  },
];

/** Why Distribute is off, where the engineer can read it. */
const distributeNeedsThree = "Select three or more to distribute";

/**
 * An icon drawn on the ground. In the Iso view the same drawing goes
 * through a 2:1 Iso projection (x to the lower right, y to the lower left),
 * on a wider canvas, so the icon shows the diagonal the button works along.
 * Strokes keep their width under the projection.
 */
function Icon({
  view,
  children,
}: {
  readonly view: View;
  readonly children: ReactNode;
}) {
  const iso = view === "iso";

  return (
    <svg
      viewBox={iso ? "0 0 24 16" : "0 0 16 16"}
      className={cn(
        "h-4 fill-none stroke-current **:[vector-effect:non-scaling-stroke]",
        iso ? "w-6" : "w-4"
      )}
      strokeWidth={1.2}
      aria-hidden="true"
    >
      <g
        transform={
          iso
            ? "translate(12 8) matrix(0.75 0.375 -0.75 0.375 0 0) translate(-8 -8)"
            : undefined
        }
      >
        {children}
      </g>
    </svg>
  );
}

const iconButton = cn(
  controlClass,
  "flex h-6 min-w-6 items-center justify-center px-0.5 py-0"
);

/**
 * The editing controls over the map, shown only while the page can edit:
 * Undo and Redo, and, when two or more structures are selected, Align and
 * Distribute for them. Each button is one change and one undo step.
 *
 * A button's name shows as text under the toolbar while the pointer is on
 * it or it has focus, so touch and keyboard users read it too. `view` picks
 * the icons and names: in the Iso view they say which diagonal of the ground
 * each button works along.
 */
export function EditToolbar({
  view,
  className,
}: {
  readonly view: View;
  readonly className?: string;
}) {
  const editing = useEditing();
  const { multiSelection } = useSelection();
  const [refusal, setRefusal] = useState<string | undefined>();
  const [hint, setHint] = useState<string | undefined>();

  if (editing === null || !editing.canEdit) {
    return null;
  }

  const { canUndo, canRedo, undo, redo, arrange } = editing;
  const ids = [...multiSelection];
  const many = ids.length >= 2;
  const canDistribute = ids.length >= 3;

  const run = (plan: Parameters<typeof arrange>[0]) => {
    setRefusal(arrange(plan));
  };

  /** Shows `label` while the pointer or focus is on a button. */
  const hintFor = (label: string) => ({
    onPointerEnter: () => {
      setHint(label);
    },
    onFocus: () => {
      setHint(label);
    },
    onPointerLeave: () => {
      setHint(undefined);
    },
    onBlur: () => {
      setHint(undefined);
    },
  });

  return (
    <div
      className={cn("flex flex-col items-end gap-1.5", className)}
      data-edit-toolbar
    >
      <div
        role="toolbar"
        aria-label="Undo and redo"
        data-history-toolbar
        className="flex gap-1.5"
      >
        <button
          type="button"
          data-control="undo"
          className={controlClass}
          disabled={!canUndo}
          aria-label="Undo"
          title="Undo (Ctrl+Z)"
          onClick={() => {
            setRefusal(undefined);
            undo();
          }}
        >
          <span aria-hidden="true">↶ Undo</span>
        </button>
        <button
          type="button"
          data-control="redo"
          className={controlClass}
          disabled={!canRedo}
          aria-label="Redo"
          title="Redo (Ctrl+Shift+Z or Ctrl+Y)"
          onClick={() => {
            setRefusal(undefined);
            redo();
          }}
        >
          <span aria-hidden="true">Redo ↷</span>
        </button>
      </div>
      {many ? (
        <div
          role="toolbar"
          aria-label={`Arrange ${ids.length} selected structures`}
          data-arrange-toolbar
          className="border-ink bg-paper flex flex-col items-end gap-1 border p-1.5"
        >
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <span className="px-1 text-xs tracking-widest uppercase opacity-70">
              {ids.length} selected
            </span>
            {Arr.map(alignments, ({ how, label, icon }) => (
              <button
                key={how}
                type="button"
                data-align={how}
                className={iconButton}
                aria-label={label[view]}
                title={label[view]}
                {...hintFor(label[view])}
                onClick={() => {
                  run((placements) => alignMoves({ placements, ids, how }));
                }}
              >
                <Icon view={view}>{icon}</Icon>
              </button>
            ))}
            <span aria-hidden="true" className="bg-ink h-4 w-px opacity-40" />
            {Arr.map(distributions, ({ axis, label, icon }) => (
              <button
                key={axis}
                type="button"
                data-distribute={axis}
                className={iconButton}
                aria-label={label[view]}
                title={canDistribute ? label[view] : distributeNeedsThree}
                disabled={!canDistribute}
                {...hintFor(label[view])}
                onClick={() => {
                  run((placements) =>
                    distributeMoves({ placements, ids, axis })
                  );
                }}
              >
                <Icon view={view}>{icon}</Icon>
              </button>
            ))}
          </div>
          {(hint ?? (canDistribute ? "" : distributeNeedsThree)) ===
          "" ? null : (
            <p
              data-toolbar-hint
              className="max-w-80 text-right text-xs opacity-80"
            >
              {hint ?? distributeNeedsThree}
            </p>
          )}
        </div>
      ) : null}
      {refusal === undefined ? null : (
        <p
          role="alert"
          data-arrange-refused
          className="border-refused bg-paper max-w-72 border-l-2 px-2 py-1 text-xs"
        >
          {refusal}
        </p>
      )}
    </div>
  );
}
