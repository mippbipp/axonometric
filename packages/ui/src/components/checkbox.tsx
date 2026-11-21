import { cn } from "@axonometric/ui/lib/utils";
import {
  Checkbox as CheckboxPrimitive,
  CheckboxGroup as CheckboxGroupPrimitive,
  CheckboxIndicator,
} from "@ui-sdk/react/checkbox";
import type { ComponentProps } from "react";

/**
 * A box that is on or off, announced as a checkbox. Put it inside a `<label>`
 * with its text, or in a Field, so it has a name. `onCheckedChange` gets
 * `true`, `false` or `"indeterminate"`, so compare with `=== true`. The
 * checked state is ui-sdk's `data-checked`, set as an empty string.
 */
function Checkbox({
  className,
  ...props
}: Omit<ComponentProps<typeof CheckboxPrimitive>, "children" | "className"> & {
  readonly className?: string;
}) {
  return (
    <CheckboxPrimitive
      className={cn(
        "inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-none border border-input bg-background text-xs leading-none outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 data-[checked]:bg-primary data-[checked]:text-primary-foreground data-[disabled]:cursor-default data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      <CheckboxIndicator aria-hidden="true">✓</CheckboxIndicator>
    </CheckboxPrimitive>
  );
}

/**
 * Several checkboxes that share one list of checked values. Each `Checkbox`
 * inside gives its `value`. Name the group with a `FieldLegend` in a
 * `FieldSet`, or with `aria-label`. `onValueChange` gets the list in the order
 * the checkboxes appear, so a caller that cares about the order the user
 * ticked them in keeps its own.
 */
function CheckboxGroup({
  className,
  ...props
}: Omit<ComponentProps<typeof CheckboxGroupPrimitive>, "className"> & {
  readonly className?: string;
}) {
  return (
    <CheckboxGroupPrimitive
      className={cn("flex flex-col gap-1", className)}
      {...props}
    />
  );
}

export { Checkbox, CheckboxGroup };
