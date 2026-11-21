import { Button } from "@axonometric/ui/components/button";
import { useSyncExternalStore } from "react";

import { uiControlClass } from "./control-class.ts";
import { darkQuery, readChoice, readSystem } from "./theme-state.ts";
import type { Theme } from "./theme-state.ts";

/** A theme the engineer picked, or `system` to follow the colour scheme. */
export type ThemeChoice = "system" | Theme;

/**
 * The `localStorage` key for the engineer's choice. index.html reads it too,
 * before the page draws, so keep the two in step.
 */
const storageKey = "axonometric-theme";

/** `localStorage` can throw: a `file://` page may not be allowed to use it. */
const store = (choice: ThemeChoice) => {
  try {
    if (choice === "system") {
      localStorage.removeItem(storageKey);
    } else {
      localStorage.setItem(storageKey, choice);
    }
  } catch {
    // The choice lasts until the page closes.
  }
};

const listeners = new Set<() => void>();

const subscribeChoice = (listener: () => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

const subscribeSystem = (listener: () => void) => {
  const query = globalThis.matchMedia(darkQuery);

  query.addEventListener("change", listener);

  return () => {
    query.removeEventListener("change", listener);
  };
};

const choose = (choice: ThemeChoice) => {
  if (choice === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = choice;
  }

  store(choice);

  for (const listener of listeners) {
    listener();
  }
};

const opposite = {
  dark: "light",
  light: "dark",
} as const satisfies Record<Theme, Theme>;

const actions = {
  dark: "Use dark theme",
  light: "Use light theme",
  system: "Follow system theme",
} as const satisfies Record<ThemeChoice, string>;

/**
 * Following the system, a click switches to the opposite of what's showing.
 * With a theme picked, a click goes back to following the system. The button
 * says what the next click does. The choice lives in `data-theme` on
 * `<html>` and in `localStorage`.
 */
export function ThemeToggle() {
  const choice = useSyncExternalStore(subscribeChoice, readChoice);
  const system = useSyncExternalStore(subscribeSystem, readSystem);
  const nextChoice = choice === "system" ? opposite[system] : "system";

  return (
    <Button
      className={uiControlClass}
      data-theme-toggle=""
      onClick={() => {
        choose(nextChoice);
      }}
    >
      {actions[nextChoice]}
    </Button>
  );
}
