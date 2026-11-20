import { alignMoves, distributeMoves } from "@axonometric/contracts";
import type { Alignment, Axis, View } from "@axonometric/contracts";
import { Toggle } from "@axonometric/ui/components/toggle";
import {
  Toolbar,
  ToolbarButton,
  ToolbarSeparator,
} from "@axonometric/ui/components/toolbar";
import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr } from "effect";
import { useState } from "react";
import type { ReactNode } from "react";

import { uiControlClass } from "./control-class.ts";
import { useEditing } from "./editing-context.ts";
import { useNewGroupForm } from "./new-group-context.ts";
import { NoteToolButton, NoteToolHint } from "./note-tool.tsx";
import { usePlacing } from "./place-context.ts";
import { useProposed } from "./proposed-context.ts";
import { useSelection } from "./selection-context.ts";

/**
 * What a button is called in each view. Plan view draws x to the right and
 * y down, so the names are the usual ones. The Iso view turns the ground a
 * quarter turn: x runs down and to the right, y down and to the left. There
 * "left" would line things up on a diagonal, so the buttons say which
 * diagonal edge of the ground they use instead, with the axis in brackets.
 */
interface Names {
  readonly iso: string;
  readonly plan: string;
}

/** One button's icon, drawn on a 16 by 16 plan of the ground. */
interface Control {
  readonly icon: ReactNode;
  readonly label: Names;
}

const alignments: ReadonlyArray<Control & { readonly how: Alignment }> = [
  {
    how: "left",
    icon: (
      <>
        <path d="M2 1v14" />
        <rect height="4" width="9" x="4" y="3" />
        <rect height="4" width="5" x="4" y="9" />
      </>
    ),
    label: {
      iso: "Align to the upper-left edge (smallest x)",
      plan: "Align left edges",
    },
  },
  {
    how: "centre-x",
    icon: (
      <>
        <path d="M8 1v14" />
        <rect height="4" width="10" x="3" y="3" />
        <rect height="4" width="6" x="5" y="9" />
      </>
    ),
    label: {
      iso: "Align centres on x (a line from lower-left to upper-right)",
      plan: "Align centres on x (a vertical line)",
    },
  },
  {
    how: "right",
    icon: (
      <>
        <path d="M14 1v14" />
        <rect height="4" width="9" x="3" y="3" />
        <rect height="4" width="5" x="7" y="9" />
      </>
    ),
    label: {
      iso: "Align to the lower-right edge (largest x)",
      plan: "Align right edges",
    },
  },
  {
    how: "top",
    icon: (
      <>
        <path d="M1 2h14" />
        <rect height="9" width="4" x="3" y="4" />
        <rect height="5" width="4" x="9" y="4" />
      </>
    ),
    label: {
      iso: "Align to the upper-right edge (smallest y)",
      plan: "Align top edges",
    },
  },
  {
    how: "centre-y",
    icon: (
      <>
        <path d="M1 8h14" />
        <rect height="10" width="4" x="3" y="3" />
        <rect height="6" width="4" x="9" y="5" />
      </>
    ),
    label: {
      iso: "Align centres on y (a line from upper-left to lower-right)",
      plan: "Align centres on y (a horizontal line)",
    },
  },
  {
    how: "bottom",
    icon: (
      <>
        <path d="M1 14h14" />
        <rect height="9" width="4" x="3" y="3" />
        <rect height="5" width="4" x="9" y="7" />
      </>
    ),
    label: {
      iso: "Align to the lower-left edge (largest y)",
      plan: "Align bottom edges",
    },
  },
];

const distributions: ReadonlyArray<Control & { readonly axis: Axis }> = [
  {
    axis: "x",
    icon: (
      <>
        <path d="M1 1v14M15 1v14" />
        <rect height="8" width="4" x="6" y="4" />
      </>
    ),
    label: {
      iso: "Distribute along x (down and to the right)",
      plan: "Distribute horizontally",
    },
  },
  {
    axis: "y",
    icon: (
      <>
        <path d="M1 1h14M1 15h14" />
        <rect height="4" width="8" x="4" y="6" />
      </>
    ),
    label: {
      iso: "Distribute along y (down and to the left)",
      plan: "Distribute vertically",
    },
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
  children,
  view,
}: {
  readonly children: ReactNode;
  readonly view: View;
}) {
  const iso = view === "iso";

  return (
    <svg
      aria-hidden="true"
      className={cn(
        "h-4 fill-none stroke-current **:[vector-effect:non-scaling-stroke]",
        iso ? "w-6" : "w-4"
      )}
      strokeWidth={1.2}
      viewBox={iso ? "0 0 24 16" : "0 0 16 16"}
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
  uiControlClass,
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
  className,
  view,
}: {
  readonly className?: string;
  readonly view: View;
}) {
  const editing = useEditing();
  const proposing = useProposed();
  const { multiSelection } = useSelection();
  const [refusal, setRefusal] = useState<string | undefined>();
  const [hint, setHint] = useState<string | undefined>();
  const placing = usePlacing();
  const newGroup = useNewGroupForm();

  if (editing === null || !editing.canEdit) {
    return null;
  }

  const { arrange, canRedo, canUndo, redo, undo } = editing;
  const ids = [...multiSelection];
  const many = ids.length >= 2;
  const canDistribute = ids.length >= 3;

  const run = (plan: Parameters<typeof arrange>[0]) => {
    setRefusal(arrange(plan));
  };

  /** Shows `label` while the pointer or focus is on a button. */
  const hintFor = (label: string) => ({
    onBlur: () => {
      setHint(undefined);
    },
    onFocus: () => {
      setHint(label);
    },
    onPointerEnter: () => {
      setHint(label);
    },
    onPointerLeave: () => {
      setHint(undefined);
    },
  });

  return (
    <div
      className={cn("flex flex-col items-end gap-1.5", className)}
      data-edit-toolbar
    >
      <Toolbar
        aria-label="Undo and redo"
        className="gap-1.5"
        data-history-toolbar
      >
        <ToolbarButton
          aria-label="Undo"
          className={uiControlClass}
          data-control="undo"
          disabled={!canUndo}
          onClick={() => {
            setRefusal(undefined);
            undo();
          }}
          title="Undo (Ctrl+Z)"
        >
          <span aria-hidden="true">↶ Undo</span>
        </ToolbarButton>
        <Toggle
          className={uiControlClass}
          data-control="add-structure"
          disabled={proposing === null || !proposing.canPropose}
          onPressedChange={(open) => {
            placing?.setOpen(open);
          }}
          pressed={placing?.open === true}
          title="Propose a new structure"
        >
          + Structure
        </Toggle>
        <Toggle
          className={uiControlClass}
          data-control="add-group"
          disabled={proposing === null || !proposing.canPropose}
          onPressedChange={(open) => {
            newGroup?.setOpen(open);
          }}
          pressed={newGroup?.open === true}
          title="Create a group, from the selected structures or empty"
        >
          + Group
        </Toggle>
        <ToolbarButton
          aria-label="Redo"
          className={uiControlClass}
          data-control="redo"
          disabled={!canRedo}
          onClick={() => {
            setRefusal(undefined);
            redo();
          }}
          title="Redo (Ctrl+Shift+Z or Ctrl+Y)"
        >
          <span aria-hidden="true">Redo ↷</span>
        </ToolbarButton>
        <NoteToolButton />
      </Toolbar>
      <NoteToolHint />
      {many ? (
        <div
          className="border-ink bg-paper flex flex-col items-end gap-1 border p-1.5"
          data-arrange-toolbar
        >
          <Toolbar
            aria-label={`Arrange ${ids.length} selected structures`}
            className="flex-wrap justify-end gap-1.5"
          >
            <span className="px-1 text-xs tracking-widest uppercase opacity-70">
              {ids.length} selected
            </span>
            {Arr.map(alignments, ({ how, icon, label }) => (
              <ToolbarButton
                aria-label={label[view]}
                className={iconButton}
                data-align={how}
                key={how}
                title={label[view]}
                {...hintFor(label[view])}
                onClick={() => {
                  run((placements) => alignMoves({ how, ids, placements }));
                }}
              >
                <Icon view={view}>{icon}</Icon>
              </ToolbarButton>
            ))}
            <ToolbarSeparator className="bg-ink h-4 opacity-40" />
            {Arr.map(distributions, ({ axis, icon, label }) => (
              <ToolbarButton
                aria-label={label[view]}
                className={iconButton}
                data-distribute={axis}
                disabled={!canDistribute}
                key={axis}
                title={canDistribute ? label[view] : distributeNeedsThree}
                {...hintFor(label[view])}
                onClick={() => {
                  run((placements) =>
                    distributeMoves({ axis, ids, placements })
                  );
                }}
              >
                <Icon view={view}>{icon}</Icon>
              </ToolbarButton>
            ))}
          </Toolbar>
          {(hint ?? (canDistribute ? "" : distributeNeedsThree)) ===
          "" ? null : (
            <p
              className="max-w-80 text-right text-xs opacity-80"
              data-toolbar-hint
            >
              {hint ?? distributeNeedsThree}
            </p>
          )}
        </div>
      ) : null}
      {refusal === undefined ? null : (
        <p
          className="border-refused bg-paper max-w-72 border-l-2 px-2 py-1 text-xs"
          data-arrange-refused
          role="alert"
        >
          {refusal}
        </p>
      )}
    </div>
  );
}
