import { cn } from "@axonometric/ui/lib/utils";
import { Textarea as TextareaPrimitive } from "@ui-sdk/react/textarea";
import type { ComponentProps } from "react";

/**
 * Several lines of text. Name it with a Field's label, or with `aria-label`.
 * Keep `value` in state and update it from `onValueChange`. `submitShortcut`
 * submits the form from the keyboard, so Ctrl or ⌘ plus Enter sends a note.
 */
function Textarea({
  className,
  ...props
}: Omit<ComponentProps<typeof TextareaPrimitive>, "className"> & {
  readonly className?: string;
}) {
  return (
    <TextareaPrimitive
      className={cn(
        "w-full min-w-0 resize-y rounded-none border border-input bg-background px-2 py-1 text-xs text-foreground outline-none placeholder:text-foreground/75 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-50 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
