import { cn } from "@axonometric/ui/lib/utils";
import {
  Tooltip as TooltipPrimitive,
  TooltipContent as TooltipContentPrimitive,
  TooltipTrigger,
} from "@ui-sdk/react/tooltip";
import type { ComponentProps, ReactElement, ReactNode } from "react";

type WithClassName<Props> = Omit<Props, "className"> & {
  readonly className?: string;
};

/** How long the pointer rests on a trigger before its tooltip opens. ui-sdk's own 600 is slow on a toolbar. */
const defaultDelay = 300;

/**
 * Names or describes a control on hover and keyboard focus. Put a
 * `TooltipTrigger` and a `TooltipContent` inside. A tooltip that opens right
 * after another one skips the delay, so moving along a toolbar reads as one
 * tooltip that follows the pointer. Escape closes it.
 */
function Tooltip({
  delay = defaultDelay,
  ...props
}: ComponentProps<typeof TooltipPrimitive>) {
  return <TooltipPrimitive delay={delay} {...props} />;
}

/**
 * The tooltip's popup, above its trigger and flipped below when there is no
 * room. It sits in the top layer, so no ancestor clips it. It fades in and
 * out, and skips the fade when it opens at once after another tooltip.
 */
function TooltipContent<Payload = unknown>({
  className,
  sideOffset = 6,
  ...props
}: WithClassName<ComponentProps<typeof TooltipContentPrimitive<Payload>>>) {
  return (
    <TooltipContentPrimitive<Payload>
      className={cn(
        "z-50 max-w-64 border border-border bg-popover px-2 py-1 font-mono text-xs text-popover-foreground transition-opacity duration-100 data-[ending-style]:opacity-0 data-[instant]:transition-none data-[starting-style]:opacity-0 motion-reduce:transition-none",
        className
      )}
      sideOffset={sideOffset}
      {...props}
    />
  );
}

/**
 * A tooltip over one control. `control` is the button, toggle or tab to
 * describe, and the children are what the tooltip says. The control keeps its
 * own name and props, and gains `aria-describedby`.
 *
 * To say why a control is unavailable, give it `aria-disabled` and ignore its
 * presses. A natively `disabled` button can't take focus, so a keyboard user
 * would never see the tooltip. Pass `disabled` to switch the tooltip off.
 */
function WithTooltip({
  children,
  control,
  ...options
}: Omit<ComponentProps<typeof Tooltip>, "children"> & {
  readonly children: ReactNode;
  readonly control: ReactElement;
}) {
  return (
    <Tooltip {...options}>
      <TooltipTrigger render={control} />
      <TooltipContent>{children}</TooltipContent>
    </Tooltip>
  );
}

export { createTooltipController } from "@ui-sdk/react/tooltip";
export type { TooltipController } from "@ui-sdk/react/tooltip";
export { TooltipTrigger } from "@ui-sdk/react/tooltip";
export { Tooltip, TooltipContent, WithTooltip };
