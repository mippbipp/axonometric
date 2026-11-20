import { cn } from "@axonometric/ui/lib/utils";
import { NumberInputControl as NumberInputControlPrimitive } from "@ui-sdk/react/number-input";
import type { ComponentProps } from "react";

/**
 * The text box of a number input. Name it with a Field's label, or with
 * `aria-label`. Typing, the arrow keys and Page Up and Down step the value by
 * the root's `step`. The root's `value` and `onValueChange` are `null` while
 * the box is empty, so check it first.
 */
function NumberInputControl({
  className,
  ...props
}: Omit<ComponentProps<typeof NumberInputControlPrimitive>, "className"> & {
  readonly className?: string;
}) {
  return (
    <NumberInputControlPrimitive
      className={cn(
        "w-full min-w-0 rounded-none border border-input bg-background px-2 py-1 text-xs outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export { NumberInput } from "@ui-sdk/react/number-input";
export { NumberInputControl };
