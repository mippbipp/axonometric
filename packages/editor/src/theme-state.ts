export type Theme = "light" | "dark";

export const darkQuery = "(prefers-color-scheme: dark)";

export const isTheme = (value: string | null | undefined): value is Theme =>
  value === "light" || value === "dark";

/** The theme the engineer picked, or `system` to follow the colour scheme. */
export const readChoice = (): Theme | "system" => {
  const { theme } = document.documentElement.dataset;

  return isTheme(theme) ? theme : "system";
};

export const readSystem = (): Theme =>
  globalThis.matchMedia(darkQuery).matches ? "dark" : "light";

/** The theme the page is showing now: the choice, or else the system's. */
export const shownTheme = (): Theme => {
  const choice = readChoice();

  return choice === "system" ? readSystem() : choice;
};
