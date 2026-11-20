import type { View } from "@axonometric/contracts";
import { views } from "@axonometric/contracts";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@axonometric/ui/components/segmented-control";
import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr } from "effect";

import { uiSegmentClass } from "./control-class.ts";
import { viewKey } from "./view-keys.ts";

const names = {
  iso: "Iso",
  plan: "Plan",
} as const satisfies Record<View, string>;

/** Two joined options, Iso and Plan, the current one chosen. */
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
    <SegmentedControl<View>
      aria-label="View"
      className="flex"
      data-view-toggle=""
      disabled={disabledBecause !== undefined}
      onValueChange={(next) => {
        if (next !== null) {
          choose(next);
        }
      }}
      value={view}
    >
      {Arr.map(views, (option, index) => (
        <SegmentedControlItem
          className={cn(uiSegmentClass, index > 0 && "-ml-px")}
          data-view={option}
          key={option}
          title={disabledBecause ?? `${names[option]} view (${viewKey})`}
          value={option}
        >
          {names[option]}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}
