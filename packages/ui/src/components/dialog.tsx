import { cn } from "@axonometric/ui/lib/utils";
import {
  DialogBackdrop as DialogBackdropPrimitive,
  DialogContent as DialogContentPrimitive,
  DialogTitle as DialogTitlePrimitive,
} from "@ui-sdk/react/dialog";
import type { ComponentProps } from "react";

type WithClassName<Props> = Omit<Props, "className"> & {
  readonly className?: string;
};

/** The dim behind a modal dialog. Leave it out of a dialog that sits inline. */
function DialogBackdrop({
  className,
  ...props
}: WithClassName<ComponentProps<typeof DialogBackdropPrimitive>>) {
  return (
    <DialogBackdropPrimitive
      className={cn("fixed inset-0 bg-black/40", className)}
      {...props}
    />
  );
}

/**
 * The dialog itself, centred in the window. ui-sdk names it by its
 * `DialogTitle`, traps focus, makes the page inert and returns focus when it
 * closes. Pass `inline`, `modal="trap-focus"` and a positioned `className` to
 * keep it inside a region of the page instead.
 */
function DialogContent<Payload = unknown>({
  className,
  ...props
}: WithClassName<ComponentProps<typeof DialogContentPrimitive<Payload>>>) {
  return (
    <DialogContentPrimitive<Payload>
      className={cn(
        "fixed inset-0 m-auto h-fit max-h-[80svh] w-[min(36rem,90vw)] overflow-auto border-2 border-border bg-popover p-4 font-mono text-xs text-popover-foreground outline-none",
        className
      )}
      {...props}
    />
  );
}

/** The heading that names the dialog. */
function DialogTitle({
  className,
  ...props
}: WithClassName<ComponentProps<typeof DialogTitlePrimitive>>) {
  return (
    <DialogTitlePrimitive
      className={cn("text-sm font-medium", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogTrigger,
  createDialogController,
} from "@ui-sdk/react/dialog";
export type { DialogController } from "@ui-sdk/react/dialog";
export { DialogBackdrop, DialogContent, DialogTitle };
