import { cn } from "@axonometric/ui/lib/utils";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import type { ComponentProps } from "react";

const Menu = MenuPrimitive.Root;

const MenuPortal = MenuPrimitive.Portal;

/**
 * The menu's popup, positioned against `anchor`. The caller picks the
 * anchor, so a menu can open at a point, such as where a right-click landed.
 */
function MenuContent({
  className,
  anchor,
  children,
  ...props
}: MenuPrimitive.Popup.Props & {
  readonly anchor?: ComponentProps<typeof MenuPrimitive.Positioner>["anchor"];
}) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        anchor={anchor}
        side="bottom"
        align="start"
        sideOffset={2}
        className="z-50 outline-none"
      >
        <MenuPrimitive.Popup
          data-slot="menu-content"
          className={cn(
            "flex min-w-44 flex-col border border-border bg-popover p-1 font-mono text-xs text-popover-foreground shadow-none outline-none",
            className
          )}
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
      data-slot="menu-item"
      className={cn(itemClass, className)}
      {...props}
    />
  );
}

function MenuRadioItem({
  className,
  children,
  ...props
}: MenuPrimitive.RadioItem.Props) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="menu-radio-item"
      className={cn(itemClass, className)}
      {...props}
    >
      <span aria-hidden="true" className="w-3 shrink-0">
        <MenuPrimitive.RadioItemIndicator>•</MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  );
}

function MenuSub({ ...props }: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot {...props} />;
}

function MenuSubTrigger({
  className,
  children,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="menu-sub-trigger"
      className={cn(itemClass, "", className)}
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
  className,
  children,
  ...props
}: MenuPrimitive.Popup.Props) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        side="inline-end"
        align="start"
        sideOffset={2}
        className="z-50 outline-none"
      >
        <MenuPrimitive.Popup
          data-slot="menu-sub-content"
          className={cn(
            "flex min-w-36 flex-col border border-border bg-popover p-1 font-mono text-xs text-popover-foreground outline-none",
            className
          )}
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
      data-slot="menu-separator"
      className={cn("my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

function MenuGroup(props: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group {...props} />;
}

/** A heading at the top of a menu. For a labelled group, use `MenuGroup` with its own label. */
function MenuLabel({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="menu-label"
      className={cn(
        "px-2 py-1 text-xs tracking-widest uppercase opacity-70",
        className
      )}
      {...props}
    />
  );
}

const MenuRadioGroup = MenuPrimitive.RadioGroup;

export {
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuPortal,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
};
