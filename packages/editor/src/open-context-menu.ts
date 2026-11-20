import type { MenuController } from "@axonometric/ui/components/menu";
import { useEffect, useEffectEvent } from "react";

/** Whether a `contextmenu` event came from a key, not a pointer or a touch. */
const fromKey = (event: MouseEvent) => {
  const pointerType = "pointerType" in event ? event.pointerType : undefined;

  return (
    event.button !== 2 &&
    !event.ctrlKey &&
    pointerType !== "touch" &&
    pointerType !== "pen"
  );
};

const asksForMenu = (event: KeyboardEvent) =>
  event.key === "ContextMenu" ||
  (event.key === "F10" &&
    event.shiftKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey);

/**
 * Opens `menu` on a map target: a right-click or long press opens it at the
 * pointer with focus on the menu, and Shift+F10 or the context-menu key open
 * it at the focused target with focus on the first item.
 *
 * The keys are read from `keydown`. macOS Chromium sends Shift+F10 as key
 * events with no `contextmenu` event, so waiting for one leaves a Mac
 * keyboard with no way in. A `contextmenu` event that a key caused is only
 * kept from showing the browser's own menu.
 */
export const useContextMenu = ({
  enabled,
  idOf,
  menu,
  onOpen,
}: {
  readonly enabled: boolean;
  /** The id of the thing `target` is part of, when it is a target for this menu. */
  readonly idOf: (target: Element) => string | undefined;
  readonly menu: MenuController;
  readonly onOpen: (id: string) => void;
}) => {
  const open = useEffectEvent(
    (id: string, anchor: { x: number; y: number }, byKey: boolean) => {
      onOpen(id);
      void menu.open({ anchor, focus: byKey ? "first" : "popup" });
    }
  );

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      const id =
        event.target instanceof Element ? idOf(event.target) : undefined;

      if (id === undefined) {
        return;
      }

      event.preventDefault();

      if (!fromKey(event)) {
        open(id, { x: event.clientX, y: event.clientY }, false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : undefined;
      const id = target === undefined ? undefined : idOf(target);

      if (target === undefined || id === undefined || !asksForMenu(event)) {
        return;
      }

      event.preventDefault();

      const box = target.getBoundingClientRect();

      open(id, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, true);
    };

    if (enabled) {
      document.addEventListener("contextmenu", onContextMenu);
      document.addEventListener("keydown", onKeyDown);
    }

    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [enabled, idOf]);
};
