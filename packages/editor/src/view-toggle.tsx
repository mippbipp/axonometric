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
  choose,
  disabledBecause,
  view,
}: {
  readonly choose: (view: View) => void;
  /** Why the views can't switch now, such as an open page, or `undefined`. */
  readonly disabledBecause?: string | undefined;
  readonly view: View;
}) {
  return (
    <fieldset className="flex" data-view-toggle>
      <legend className="sr-only">View</legend>
      {Arr.map(views, (option, index) => (
        <button
          aria-pressed={option === view}
          className={cn(
            controlClass,
            index > 0 && "-ml-px",
            option === view && "bg-ink text-paper"
          )}
          data-view={option}
          disabled={disabledBecause !== undefined}
          key={option}
          onClick={() => {
            choose(option);
          }}
          title={disabledBecause ?? `${names[option]} view (${viewKey})`}
          type="button"
        >
          {names[option]}
        </button>
      ))}
    </fieldset>
  );
}
