import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@axonometric/ui/components/field";
import { cn } from "@axonometric/ui/lib/utils";
import type { ReactNode } from "react";

/**
 * The Field around one text box or text area: its label, an optional hint,
 * and the reason the last send was refused. ui-sdk ties the label, the hint
 * and the refusal to the control inside, so a screen reader says all three,
 * and the control is `aria-invalid` while a refusal shows. `disabled`
 * disables the control. `failureProps` carries the page's `data-*` hook onto
 * the refusal.
 */
export function LabelledField({
  children,
  className,
  description,
  disabled,
  failure,
  failureProps,
  hideLabel = false,
  label,
  labelClassName,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly description?: string;
  readonly disabled?: boolean;
  readonly failure?: string;
  readonly failureProps?: Readonly<Record<`data-${string}`, string>>;
  /** Keeps the label for screen readers alone. */
  readonly hideLabel?: boolean;
  readonly label: ReactNode;
  readonly labelClassName?: string;
}) {
  return (
    <Field
      className={cn("flex flex-col gap-1", className)}
      disabled={disabled}
      invalid={failure === undefined ? undefined : true}
    >
      <FieldLabel
        className={cn(hideLabel ? "sr-only" : "opacity-70", labelClassName)}
      >
        {label}
      </FieldLabel>
      {children}
      {description === undefined ? null : (
        <FieldDescription className="text-xs opacity-70">
          {description}
        </FieldDescription>
      )}
      {failure === undefined ? null : (
        <FieldError
          className="border-refused border-l-2 pl-2 text-xs"
          match
          {...failureProps}
        >
          {failure}
        </FieldError>
      )}
    </Field>
  );
}
