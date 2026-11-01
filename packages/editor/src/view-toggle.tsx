import type { View } from "@axonometric/contracts";
import { views } from "@axonometric/contracts";
import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr } from "effect";

import { controlClass } from "./control-class.ts";
import { viewKey } from "./view-keys.ts";

const names = {
  iso: "Iso",
  plan: "Plan",
} as const satisfies Record<View, string>;

/** Two joined buttons, Iso and Plan, the current one pressed. */
export function ViewToggle({
  view,
  choose,
  disabledBecause,
}: {
  readonly view: View;
  readonly choose: (view: View) => void;
  /** Why the views can't switch now, such as an open page, or `undefined`. */
  readonly disabledBecause?: string | undefined;
}) {
  return (
    <fieldset data-view-toggle className="flex">
      <legend className="sr-only">View</legend>
      {Arr.map(views, (option, index) => (
        <button
          key={option}
          type="button"
          data-view={option}
          aria-pressed={option === view}
          disabled={disabledBecause !== undefined}
          title={disabledBecause ?? `${names[option]} view (${viewKey})`}
          className={cn(
            controlClass,
            index > 0 && "-ml-px",
            option === view && "bg-ink text-paper"
          )}
          onClick={() => {
            choose(option);
          }}
        >
          {names[option]}
        </button>
      ))}
    </fieldset>
  );
}
