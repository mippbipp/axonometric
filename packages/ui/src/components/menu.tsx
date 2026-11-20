import { cn } from "@axonometric/ui/lib/utils";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import type { ComponentProps } from "react";

const Menu = MenuPrimitive.Root;

/**
 * The menu's popup, positioned against `anchor`. The caller picks the
 * anchor, so a menu can open at a point, such as where a right-click landed.
 */
function MenuContent({
  anchor,
  children,
  className,
  ...props
}: MenuPrimitive.Popup.Props & {
  readonly anchor?: ComponentProps<typeof MenuPrimitive.Positioner>["anchor"];
}) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        align="start"
        anchor={anchor}
        className="z-50 outline-none"
        side="bottom"
        sideOffset={2}
      >
        <MenuPrimitive.Popup
          className={cn(
            "flex min-w-44 flex-col border border-border bg-popover p-1 font-mono text-xs text-popover-foreground shadow-none outline-none",
            className
          )}
          data-slot="menu-content"
          {...props}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

const itemClass =
  "flex cursor-pointer items-center gap-2 px-2 py-1 text-left outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:cursor-default data-[disabled]:opacity-40";

function MenuItem({ className, ...props }: MenuPrimitive.Item.Props) {
  return (
    <MenuPrimitive.Item
      className={cn(itemClass, className)}
      data-slot="menu-item"
      {...props}
    />
  );
}

function MenuRadioItem({
  children,
  className,
  ...props
}: MenuPrimitive.RadioItem.Props) {
  return (
    <MenuPrimitive.RadioItem
      className={cn(itemClass, className)}
      data-slot="menu-radio-item"
      {...props}
    >
      <span aria-hidden="true" className="w-3 shrink-0">
        <MenuPrimitive.RadioItemIndicator>•</MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  );
}

function MenuCheckboxItem({
  children,
  className,
  ...props
}: MenuPrimitive.CheckboxItem.Props) {
  return (
    <MenuPrimitive.CheckboxItem
      className={cn(itemClass, className)}
      data-slot="menu-checkbox-item"
      {...props}
    >
      <span aria-hidden="true" className="w-3 shrink-0">
        <MenuPrimitive.CheckboxItemIndicator>
          ✓
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

function MenuSub({ ...props }: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot {...props} />;
}

function MenuSubTrigger({
  children,
  className,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props) {
  return (
    <MenuPrimitive.SubmenuTrigger
      className={cn(itemClass, className)}
      data-slot="menu-sub-trigger"
      {...props}
    >
      {children}
      <span aria-hidden="true" className="ml-auto">
        ▸
      </span>
    </MenuPrimitive.SubmenuTrigger>
  );
}

function MenuSubContent({
  children,
  className,
  ...props
}: MenuPrimitive.Popup.Props) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        align="start"
        className="z-50 outline-none"
        side="inline-end"
        sideOffset={2}
      >
        <MenuPrimitive.Popup
          className={cn(
            "flex min-w-36 flex-col border border-border bg-popover p-1 font-mono text-xs text-popover-foreground outline-none",
            className
          )}
          data-slot="menu-sub-content"
          {...props}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

function MenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      className={cn("my-1 h-px bg-border", className)}
      data-slot="menu-separator"
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

const MenuRadioGroup = MenuPrimitive.RadioGroup;

export {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
};
