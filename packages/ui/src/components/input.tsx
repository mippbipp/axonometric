import { cn } from "@axonometric/ui/lib/utils";
import { Input as InputPrimitive } from "@ui-sdk/react/input";
import type { ComponentProps } from "react";

/**
 * A line of text. Name it with a Field's label, or with `aria-label`. Keep
 * `value` in state and update it from `onValueChange`, which hears the text
 * and why it changed. A Field with `invalid` marks it `aria-invalid` and ties
 * its error to it.
 */
function Input({
  className,
  ...props
}: Omit<ComponentProps<typeof InputPrimitive>, "className"> & {
  readonly className?: string;
}) {
  return (
    <InputPrimitive
      className={cn(
        "w-full min-w-0 rounded-none border border-input bg-background px-2 py-1 text-xs text-foreground outline-none placeholder:text-foreground/75 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-50 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  );
}

export { Input };
