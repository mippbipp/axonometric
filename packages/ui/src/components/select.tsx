import { cn } from "@axonometric/ui/lib/utils";
import {
  SelectContent as SelectContentPrimitive,
  SelectItem as SelectItemPrimitive,
  SelectItemIndicator,
  SelectTrigger as SelectTriggerPrimitive,
  SelectValue,
} from "@ui-sdk/react/select";
import type { ComponentProps, ReactNode } from "react";

type WithClassName<Props> = Omit<Props, "className" | "children"> & {
  readonly className?: string;
};

/**
 * The button that opens the list. It shows the chosen item, or the
 * `placeholder` while nothing is chosen, and a Field's label names it. Typing
 * on it picks the item that matches.
 */
function SelectTrigger({
  className,
  placeholder,
  ...props
}: WithClassName<ComponentProps<typeof SelectTriggerPrimitive>> & {
  readonly placeholder?: string;
}) {
  return (
    <SelectTriggerPrimitive
      className={cn(
        "flex min-w-0 cursor-pointer items-center justify-between gap-2 rounded-none border border-input bg-background px-2 py-1 text-left text-xs outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SelectValue className="min-w-0 truncate" placeholder={placeholder} />
      <span aria-hidden="true" className="shrink-0">
        ▾
      </span>
    </SelectTriggerPrimitive>
  );
}

/** The popup, as wide as the trigger at least. */
function SelectContent({
  className,
  sideOffset = 2,
  ...props
}: Omit<ComponentProps<typeof SelectContentPrimitive>, "className"> & {
  readonly className?: string;
}) {
  return (
    <SelectContentPrimitive
      className={cn(
        "z-50 flex max-h-72 min-w-[var(--anchor-width)] flex-col overflow-y-auto border border-border bg-popover p-1 font-mono text-xs text-popover-foreground shadow-none outline-none",
        className
      )}
      sideOffset={sideOffset}
      {...props}
    />
  );
}

/**
 * An option. Give `label` when the children are more than text, so the
 * trigger can show it. The chosen one carries ui-sdk's `data-selected`, set
 * as an empty string.
 */
function SelectItem<Value = string>({
  children,
  className,
  ...props
}: Omit<
  ComponentProps<typeof SelectItemPrimitive<Value>>,
  "children" | "className"
> & {
  readonly children?: ReactNode;
  readonly className?: string;
}) {
  return (
    <SelectItemPrimitive<Value>
      className={cn(
        "flex cursor-pointer items-center gap-2 px-2 py-1 text-left outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-[disabled]:cursor-default data-[disabled]:opacity-40",
        className
      )}
      {...props}
    >
      <span aria-hidden="true" className="w-3 shrink-0">
        <SelectItemIndicator>✓</SelectItemIndicator>
      </span>
      {children}
    </SelectItemPrimitive>
  );
}

export { Select } from "@ui-sdk/react/select";
export { SelectContent, SelectItem, SelectTrigger };
