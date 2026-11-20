import { buttonVariants } from "@axonometric/ui/components/button";
import { cn } from "@axonometric/ui/lib/utils";
import {
  Toolbar as ToolbarPrimitive,
  ToolbarButton as ToolbarButtonPrimitive,
  ToolbarSeparator as ToolbarSeparatorPrimitive,
} from "@ui-sdk/react/toolbar";
import type { VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

type WithClassName<Props> = Omit<Props, "className"> & {
  readonly className?: string;
};

/**
 * A row of controls with one Tab stop. The arrow keys move between its
 * buttons and toggles. Name it with `aria-label`.
 */
function Toolbar({
  className,
  ...props
}: WithClassName<ComponentProps<typeof ToolbarPrimitive>>) {
  return (
    <ToolbarPrimitive
      className={cn(
        "flex items-center gap-1 data-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    />
  );
}

/**
 * A button in a toolbar, styled as a `Button`. A disabled one stays
 * reachable with the arrow keys and reports `aria-disabled`.
 */
function ToolbarButton({
  className,
  size = "default",
  variant = "outline",
  ...props
}: WithClassName<ComponentProps<typeof ToolbarButtonPrimitive>> &
  VariantProps<typeof buttonVariants>) {
  return (
    <ToolbarButtonPrimitive
      className={cn(
        buttonVariants({ size, variant }),
        "aria-disabled:pointer-events-none aria-disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

function ToolbarSeparator({
  className,
  ...props
}: WithClassName<ComponentProps<typeof ToolbarSeparatorPrimitive>>) {
  return (
    <ToolbarSeparatorPrimitive
      className={cn(
        "self-stretch bg-border data-[orientation=horizontal]:w-px",
        className
      )}
      {...props}
    />
  );
}

export { Toolbar, ToolbarButton, ToolbarSeparator };
