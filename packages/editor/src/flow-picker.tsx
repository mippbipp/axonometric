import {
  SegmentedControl,
  SegmentedControlItem,
} from "@axonometric/ui/components/segmented-control";
import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr, Option } from "effect";
import { useId } from "react";

import { flowChoiceKey, flowOptionsOf } from "./chapters.ts";
import { uiSegmentClass } from "./control-class.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/**
 * The last chapter's flow picker: one button per flow, and one for every
 * flow at once. It shows nothing in other chapters or when the map has no
 * flows.
 */
export function FlowPicker({ className }: { readonly className?: string }) {
  const { chooseFlow, flowChoice, isLast, state, stop } = useWalkthrough();
  const labelId = useId();
  const { flows } = state.data;

  if (!isLast || flows.length === 0) {
    return null;
  }

  const chosen = flowChoiceKey(flowChoice);

  const options = flowOptionsOf({ flows, stop });

  return (
    <div
      className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}
      data-flow-picker
    >
      <span
        className="mr-1 text-xs tracking-widest uppercase opacity-70"
        id={labelId}
      >
        Flow
      </span>
      <SegmentedControl<string>
        aria-labelledby={labelId}
        className="flex min-w-0 flex-wrap gap-1.5"
        onValueChange={(next) => {
          const option = Arr.findFirst(options, ({ key }) => key === next);

          if (Option.isSome(option)) {
            chooseFlow(option.value.choice);
          }
        }}
        value={chosen}
      >
        {Arr.map(options, ({ choice, key, label }) => (
          <SegmentedControlItem
            className={cn(uiSegmentClass, "tracking-wider uppercase")}
            data-flow={choice.kind === "flow" ? choice.id : choice.kind}
            key={key}
            value={key}
          >
            {label}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
    </div>
  );
}
