import type { Structure } from "@axonometric/contracts";
import { Button } from "@axonometric/ui/components/button";
import { cn } from "@axonometric/ui/lib/utils";

import { uiControlClass } from "./control-class.ts";
import { useSelection } from "./selection-context.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/**
 * Where the inside view is: the system, then the structure. It takes the
 * chapter rail's place while the inside view is open.
 */
export function Breadcrumb({
  className,
  structure,
}: {
  readonly className?: string;
  readonly structure: Structure;
}) {
  const { index, state } = useWalkthrough();
  const { comeOut } = useSelection();

  return (
    <nav
      aria-label="Breadcrumb"
      className={cn("flex flex-wrap items-center gap-2", className)}
      data-breadcrumb
    >
      <Button
        className={uiControlClass}
        data-control="come-out"
        onClick={comeOut}
      >
        ← Come out
      </Button>
      <ol className="flex items-center gap-1.5 text-xs tracking-widest uppercase">
        <li className="opacity-70">
          {state.data.overview.title} · Chapter {index + 1}
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
