import { useSyncExternalStore } from "react";

/** A theme the reader picked, or `system` to follow the colour scheme. */
export type ThemeChoice = "system" | "light" | "dark";

/**
 * The `localStorage` key for the reader's choice. index.html reads it too,
 * before the page draws, so keep the two in step.
 */
const storageKey = "axonometric-theme";

const next = {
  system: "dark",
  dark: "light",
  light: "system",
} as const satisfies Record<ThemeChoice, ThemeChoice>;

const isChoice = (value: string | null | undefined): value is ThemeChoice =>
  value === "light" || value === "dark" || value === "system";

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

const read = (): ThemeChoice => {
  const { theme } = document.documentElement.dataset;

  return isChoice(theme) ? theme : "system";
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
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

const labels = {
  system: "System",
  light: "Light",
  dark: "Dark",
} as const satisfies Record<ThemeChoice, string>;

const switchTo = {
  system: "Follow the system's theme",
  light: "Switch to the light theme",
  dark: "Switch to the dark theme",
} as const satisfies Record<ThemeChoice, string>;

/**
 * Cycles the theme: the system's, then dark, then light. The choice lives in
 * `data-theme` on `<html>` and in `localStorage`.
 */
export function ThemeToggle() {
  const choice = useSyncExternalStore(subscribe, read);

  return (
    <button
      type="button"
      title={switchTo[next[choice]]}
      className="border-ink bg-paper text-ink hover:bg-face focus-visible:outline-ink shadow-hard h-7 border-2 px-2 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 active:translate-px active:shadow-none"
      onClick={() => {
        choose(next[choice]);
      }}
    >
      {`Theme: ${labels[choice]}`}
    </button>
  );
}
