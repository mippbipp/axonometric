import { cn } from "@axonometric/ui/lib/utils";
import {
  MenuCheckboxItem as MenuCheckboxItemPrimitive,
  MenuContent as MenuContentPrimitive,
  MenuItem as MenuItemPrimitive,
  MenuItemIcon,
  MenuItemIndicator,
  MenuRadioItem as MenuRadioItemPrimitive,
  MenuSeparator as MenuSeparatorPrimitive,
  MenuSubContent as MenuSubContentPrimitive,
  MenuSubTrigger as MenuSubTriggerPrimitive,
} from "@ui-sdk/react/menu";
import type { ComponentProps, ReactNode } from "react";

type WithClassName<Props> = Omit<Props, "className"> & {
  readonly className?: string;
};

type WithNodeChildren<Props> = Omit<WithClassName<Props>, "children"> & {
  readonly children?: ReactNode;
};

const popupClass =
  "z-50 flex min-w-44 flex-col border border-border bg-popover p-1 font-mono text-xs text-popover-foreground shadow-none outline-none";

/**
 * The menu's popup. Opened from a controller it sits at the point the
 * controller was given, so a menu can open where a right-click landed.
 */
function MenuContent<Payload = unknown>({
  className,
  sideOffset = 2,
  ...props
}: WithClassName<ComponentProps<typeof MenuContentPrimitive<Payload>>>) {
  return (
    <MenuContentPrimitive<Payload>
      className={cn(popupClass, className)}
      sideOffset={sideOffset}
      {...props}
    />
  );
}

const itemClass =
  "flex cursor-pointer items-center gap-2 px-2 py-1 text-left outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-[disabled]:cursor-default data-[disabled]:opacity-50";

function MenuItem({
  className,
  ...props
}: WithClassName<ComponentProps<typeof MenuItemPrimitive>>) {
  return <MenuItemPrimitive className={cn(itemClass, className)} {...props} />;
}

function MenuRadioItem({
  children,
  className,
  ...props
}: WithNodeChildren<ComponentProps<typeof MenuRadioItemPrimitive>>) {
  return (
    <MenuRadioItemPrimitive className={cn(itemClass, className)} {...props}>
      <span aria-hidden="true" className="w-3 shrink-0">
        <MenuItemIndicator>•</MenuItemIndicator>
      </span>
      {children}
    </MenuRadioItemPrimitive>
  );
}

function MenuCheckboxItem({
  children,
  className,
  ...props
}: WithNodeChildren<ComponentProps<typeof MenuCheckboxItemPrimitive>>) {
  return (
    <MenuCheckboxItemPrimitive className={cn(itemClass, className)} {...props}>
      <span aria-hidden="true" className="w-3 shrink-0">
        <MenuItemIndicator>✓</MenuItemIndicator>
      </span>
      {children}
    </MenuCheckboxItemPrimitive>
  );
}

function MenuSubTrigger({
  children,
  className,
  ...props
}: WithNodeChildren<ComponentProps<typeof MenuSubTriggerPrimitive>>) {
  return (
    <MenuSubTriggerPrimitive className={cn(itemClass, className)} {...props}>
      {children}
      <MenuItemIcon className="ml-auto" mirror>
        ▸
      </MenuItemIcon>
    </MenuSubTriggerPrimitive>
  );
}

function MenuSubContent({
  className,
  ...props
}: WithClassName<ComponentProps<typeof MenuSubContentPrimitive>>) {
  return (
    <MenuSubContentPrimitive
      className={cn(popupClass, "min-w-36", className)}
      sideOffset={2}
      {...props}
    />
  );
}

function MenuSeparator({
  className,
  ...props
}: WithClassName<ComponentProps<typeof MenuSeparatorPrimitive>>) {
  return (
    <MenuSeparatorPrimitive
      className={cn("my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

/** A heading at the top of a menu. */
function MenuLabel({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "px-2 py-1 text-xs tracking-widest uppercase opacity-70",
        className
      )}
      data-slot="menu-label"
      {...props}
    />
  );
}

export {
  Menu,
  MenuRadioGroup,
  MenuSub,
  MenuTrigger,
  createMenuController,
} from "@ui-sdk/react/menu";
export type { MenuController } from "@ui-sdk/react/menu";
export {
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioItem,
  MenuSeparator,
  MenuSubContent,
  MenuSubTrigger,
};
