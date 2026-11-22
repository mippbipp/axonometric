import { usePageKey } from "./page-key.ts";

/** The key that switches between the Iso view and Plan view. */
export const viewKey = "v";

/**
 * Switches between the views with `v`. Keys typed into a field, or pressed
 * with Alt, Ctrl or Meta, are left alone.
 */
export const useViewKey = (toggle: () => void) => {
  usePageKey(viewKey, toggle);
};
