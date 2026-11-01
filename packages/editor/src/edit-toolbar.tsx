import { alignMoves, distributeMoves } from "@axonometric/contracts";
import type { Alignment, Axis } from "@axonometric/contracts";
import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr } from "effect";
import { useState } from "react";
import type { ReactNode } from "react";

import { controlClass } from "./control-class.ts";
import { useEditing } from "./editing-context.ts";
import { useSelection } from "./selection-context.ts";

/** What the page tells the engineer about the arrange buttons. */
const alignments: readonly {
  readonly how: Alignment;
  readonly label: string;
  readonly title: string;
  /** A 16 by 16 icon: bars and boxes lined up the way the button does it. */
  readonly icon: ReactNode;
}[] = [
  {
    how: "left",
    label: "Align left edges",
    title: "Align left edges: every structure starts at the smallest x",
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
    label: "Align centres on x",
    title: "Align centres on x: every centre at the middle of the set's x",
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
    label: "Align right edges",
    title: "Align right edges: every structure ends at the largest x",
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
    label: "Align top edges",
    title: "Align top edges: every structure starts at the smallest y",
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
    label: "Align centres on y",
    title: "Align centres on y: every centre at the middle of the set's y",
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
    label: "Align bottom edges",
    title: "Align bottom edges: every structure ends at the largest y",
    icon: (
      <>
        <path d="M1 14h14" />
        <rect x="3" y="3" width="4" height="9" />
        <rect x="9" y="7" width="4" height="5" />
      </>
    ),
  },
];

const distributions: readonly {
  readonly axis: Axis;
  readonly label: string;
  readonly title: string;
  readonly icon: ReactNode;
}[] = [
  {
    axis: "x",
    label: "Distribute horizontally",
    title:
      "Distribute along x: equal gaps between the structures, the outer two stay put. Needs three.",
    icon: (
      <>
        <path d="M1 1v14M15 1v14" />
        <rect x="6" y="4" width="4" height="8" />
      </>
    ),
  },
  {
    axis: "y",
    label: "Distribute vertically",
    title:
      "Distribute along y: equal gaps between the structures, the outer two stay put. Needs three.",
    icon: (
      <>
        <path d="M1 1h14M1 15h14" />
        <rect x="4" y="6" width="8" height="4" />
      </>
    ),
  },
];

function Icon({ children }: { readonly children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4 fill-none stroke-current"
      strokeWidth={1.2}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const iconButton = cn(
  controlClass,
  "flex size-6 items-center justify-center p-0"
);

/**
 * The editing controls over the map, shown only while the page can edit:
 * Undo and Redo, and, when two or more structures are selected, Align and
 * Distribute for them. Each button is one change and one undo step.
 */
export function EditToolbar({ className }: { readonly className?: string }) {
  const editing = useEditing();
  const { marked } = useSelection();
  const [refusal, setRefusal] = useState<string | undefined>();

  if (editing === null || !editing.canEdit) {
    return null;
  }

  const { canUndo, canRedo, undo, redo, arrange } = editing;
  const ids = [...marked];
  const many = ids.length >= 2;

  const run = (plan: Parameters<typeof arrange>[0]) => {
    setRefusal(arrange(plan));
  };

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
          title="Undo (Ctrl+Z)"
          onClick={() => {
            setRefusal(undefined);
            undo();
          }}
        >
          ↶ Undo
        </button>
        <button
          type="button"
          data-control="redo"
          className={controlClass}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z or Ctrl+Y)"
          onClick={() => {
            setRefusal(undefined);
            redo();
          }}
        >
          Redo ↷
        </button>
      </div>
      {many ? (
        <div
          role="toolbar"
          aria-label={`Arrange ${ids.length} selected structures`}
          data-arrange-toolbar
          className="border-ink bg-paper flex flex-wrap items-center justify-end gap-1.5 border p-1.5"
        >
          <span className="px-1 text-xs tracking-widest uppercase opacity-70">
            {ids.length} selected
          </span>
          {Arr.map(alignments, ({ how, label, title, icon }) => (
            <button
              key={how}
              type="button"
              data-align={how}
              className={iconButton}
              aria-label={label}
              title={title}
              onClick={() => {
                run((placements) => alignMoves({ placements, ids, how }));
              }}
            >
              <Icon>{icon}</Icon>
            </button>
          ))}
          <span aria-hidden="true" className="bg-ink h-4 w-px opacity-40" />
          {Arr.map(distributions, ({ axis, label, title, icon }) => (
            <button
              key={axis}
              type="button"
              data-distribute={axis}
              className={iconButton}
              aria-label={label}
              title={title}
              disabled={ids.length < 3}
              onClick={() => {
                run((placements) => distributeMoves({ placements, ids, axis }));
              }}
            >
              <Icon>{icon}</Icon>
            </button>
          ))}
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
