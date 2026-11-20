import { cn } from "@axonometric/ui/lib/utils";
import { FieldLabel as FieldLabelPrimitive } from "@ui-sdk/react/field";
import type { ComponentProps } from "react";

type WithClassName<Props> = Omit<Props, "className"> & {
  readonly className?: string;
};

/**
 * The visible name of a control inside a `Field`. ui-sdk ties it to the
 * control, so pressing it focuses the control and screen readers announce it.
 */
function FieldLabel({
  className,
  ...props
}: WithClassName<ComponentProps<typeof FieldLabelPrimitive>>) {
  return (
    <FieldLabelPrimitive
      className={cn("text-xs data-[disabled]:opacity-50", className)}
      {...props}
    />
  );
}

export { Field, FieldDescription, FieldError } from "@ui-sdk/react/field";
export { FieldLabel };
