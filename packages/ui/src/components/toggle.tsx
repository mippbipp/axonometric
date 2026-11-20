import { cn } from "@axonometric/ui/lib/utils";
import { Toggle as TogglePrimitive } from "@ui-sdk/react/toggle";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

const toggleVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-none border text-xs font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 data-[disabled]:cursor-default data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-8 min-w-8 px-2.5",
        sm: "h-7 min-w-7 px-2.5",
        xs: "h-6 min-w-6 px-2",
      },
      variant: {
        default:
          "border-transparent bg-transparent hover:bg-muted hover:text-foreground data-[pressed]:bg-muted data-[pressed]:text-foreground",
        outline:
          "border-input bg-transparent hover:bg-muted hover:text-foreground data-[pressed]:bg-muted data-[pressed]:text-foreground",
      },
    },
  }
);

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

export { Toggle, toggleVariants };
