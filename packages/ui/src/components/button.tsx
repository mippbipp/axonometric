import { buttonVariants } from "@axonometric/ui/lib/button-variants";
import { cn } from "@axonometric/ui/lib/utils";
import { Button as ButtonPrimitive } from "@ui-sdk/react/button";
import type { VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

function Button({
  className,
  size = "default",
  variant = "default",
  ...props
}: Omit<ComponentProps<typeof ButtonPrimitive>, "className"> &
  VariantProps<typeof buttonVariants> & { readonly className?: string }) {
  return (
    <ButtonPrimitive
      className={cn(buttonVariants({ className, size, variant }))}
      {...props}
    />
  );
}

export { Button };
