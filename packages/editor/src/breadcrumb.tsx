import type { Structure } from "@axonometric/contracts";
import { cn } from "@axonometric/ui/lib/utils";

import { controlClass } from "./control-class.ts";
import { useSelection } from "./selection-context.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/**
 * Where the inside view is: the system, then the structure. It takes the
 * chapter rail's place while the inside view is open.
 */
export function Breadcrumb({
  structure,
  className,
}: {
  readonly structure: Structure;
  readonly className?: string;
}) {
  const { state, index } = useWalkthrough();
  const { comeOut } = useSelection();

  return (
    <nav
      aria-label="Breadcrumb"
      data-breadcrumb
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      <button
        type="button"
        data-control="come-out"
        className={controlClass}
        onClick={comeOut}
      >
        ← Come out
      </button>
      <ol className="flex items-center gap-1.5 text-xs tracking-widest uppercase">
        <li className="opacity-70">
          {state.system} · Chapter {index + 1}
        </li>
        <li aria-hidden="true" className="opacity-70">
          ›
        </li>
        <li aria-current="location" className="font-medium">
          {structure.code} {structure.name}
        </li>
        <li className="opacity-70">· steps in order</li>
      </ol>
    </nav>
  );
}
