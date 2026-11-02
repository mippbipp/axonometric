import type { GridPoint } from "@axonometric/contracts";

import { controlClass } from "./control-class.ts";
import { useNoteTool } from "./note-tool-context.ts";
import { NotesSection } from "./notes-section.tsx";

/**
 * The picked empty spot in the side panel: where it is on the grid, the notes
 * pinned there, and a form that pins another. Closing it clears the pick.
 */
export function SpotPanel({ spot }: { readonly spot: GridPoint }) {
  const tool = useNoteTool();

  return (
    <section
      data-spot-panel={`${spot.x},${spot.y}`}
      className="flex flex-col gap-3"
    >
      <p className="text-xs tracking-widest uppercase opacity-70">Empty spot</p>
      <h2 className="text-lg leading-tight font-medium">
        {spot.x}, {spot.y}
      </h2>
      <p className="text-sm opacity-80">
        A note pinned here is for the agent to read. It stays on this spot of
        the grid.
      </p>
      <NotesSection target={{ kind: "spot", x: spot.x, y: spot.y }} />
      <div className="flex gap-1.5">
        <button
          type="button"
          data-control="close"
          className={controlClass}
          onClick={() => {
            tool?.pick(null);
          }}
        >
          Close
        </button>
      </div>
    </section>
  );
}
