import { cn } from "@axonometric/ui/lib/utils";
import {
  SegmentedControl as SegmentedControlPrimitive,
  SegmentedControlItem as SegmentedControlItemPrimitive,
} from "@ui-sdk/react/segmented-control";
import type { ComponentProps } from "react";

type WithClassName<Props> = Omit<Props, "className"> & {
  readonly className?: string;
};

/**
 * A row of options where exactly one is on. The arrow keys move between the
 * options and choose as they go, and the row is one Tab stop. Pass `value`
 * and `onValueChange` to keep the choice yourself, and name the row with
 * `aria-label`. `onValueChange` can receive `null`, so check it first.
 */
function SegmentedControl<Value extends string>({
  className,
  ...props
}: WithClassName<ComponentProps<typeof SegmentedControlPrimitive<Value>>>) {
  return (
    <SegmentedControlPrimitive<Value>
      className={cn("inline-flex items-stretch", className)}
      {...props}
    />
  );
}

/**
 * One option. The chosen one carries `aria-checked="true"` and ui-sdk's
 * `data-checked`, set as an empty string, so style it with `data-[checked]:`.
 */
function SegmentedControlItem({
  className,
  ...props
}: WithClassName<ComponentProps<typeof SegmentedControlItemPrimitive>>) {
  return (
    <SegmentedControlItemPrimitive
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-none border border-transparent px-2.5 text-xs font-medium whitespace-nowrap text-foreground/60 transition-all outline-none select-none hover:text-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 data-[checked]:bg-muted data-[checked]:text-foreground data-[disabled]:cursor-default data-[disabled]:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export { SegmentedControl, SegmentedControlItem };
