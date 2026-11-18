import { editStorage } from "@axonometric/contracts";
import { useSyncExternalStore } from "react";

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
    return localStorage.getItem(editStorage.key) === editStorage.on;
  } catch {
    return remembered.on;
  }
};

const write = (on: boolean) => {
  remembered.on = on;

  try {
    if (on) {
      localStorage.setItem(editStorage.key, editStorage.on);
    } else {
      localStorage.removeItem(editStorage.key);
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
