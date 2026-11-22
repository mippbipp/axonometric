import { toggleVariants } from "@axonometric/ui/lib/toggle-variants";
import { cn } from "@axonometric/ui/lib/utils";
import { Toggle as TogglePrimitive } from "@ui-sdk/react/toggle";
import type { VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

/**
 * A button that stays pressed, announced through `aria-pressed`. On its own it
 * is one Tab stop. Inside a `Toolbar` it joins the toolbar's arrow-key row.
 * Pass `pressed` and `onPressedChange` to keep the state yourself. A disabled
 * toggle outside a toolbar leaves the Tab order.
 */
function Toggle({
  className,
  size = "default",
  variant = "default",
  ...props
}: Omit<ComponentProps<typeof TogglePrimitive>, "className"> &
  VariantProps<typeof toggleVariants> & { readonly className?: string }) {
  return (
    <TogglePrimitive
      className={cn(toggleVariants({ className, size, variant }))}
      {...props}
    />
  );
}

export { Toggle };
