import type { MenuController } from "@axonometric/ui/components/menu";

/**
 * Opens `menu` at the point of a `contextmenu` event, the way ui-sdk's
 * `MenuContextTrigger` does for an area: a pointer leaves focus on the menu,
 * and a key (Shift+F10 or the context-menu key) puts it on the first item.
 */
export const openContextMenu = ({
  event,
  menu,
}: {
  readonly event: MouseEvent;
  readonly menu: MenuController;
}) => {
  const pointerType = "pointerType" in event ? event.pointerType : undefined;
  const byKey =
    event.button !== 2 &&
    !event.ctrlKey &&
    pointerType !== "touch" &&
    pointerType !== "pen";

  void menu.open({
    anchor: { x: event.clientX, y: event.clientY },
    focus: byKey ? "first" : "popup",
  });
};
