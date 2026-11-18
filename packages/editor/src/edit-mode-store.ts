import { useSyncExternalStore } from "react";

/** The `localStorage` key that remembers Edit, as the theme's key does. */
const storageKey = "axonometric-edit";

/** Kept for the page's life when `localStorage` can't be used. */
const remembered = { on: false };

const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

/** `localStorage` can throw: a browser may block it for the page. */
const read = (): boolean => {
  try {
    return localStorage.getItem(storageKey) === "on";
  } catch {
    return remembered.on;
  }
};

const write = (on: boolean) => {
  remembered.on = on;

  try {
    if (on) {
      localStorage.setItem(storageKey, "on");
    } else {
      localStorage.removeItem(storageKey);
    }
  } catch {
    // The choice lasts until the page closes.
  }

  for (const listener of listeners) {
    listener();
  }
};

/** Edit as this browser last left it, off at first, and a way to change it. */
export const useStoredEdit = () =>
  [useSyncExternalStore(subscribe, read), write] as const;
