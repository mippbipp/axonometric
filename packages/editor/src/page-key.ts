import { useShortcut } from "@axonometric/ui/lib/shortcuts";

/**
 * A one-key page shortcut on ui-sdk's `useShortcut`, such as `]` or `v`. It
 * runs with Shift held too, since ui-sdk matches Shift exactly and some
 * layouts type `]` with it. It repeats while held, is left alone in a text
 * field unless `allowInInput` is set, and pauses while a modal dialog is
 * open.
 */
// oxlint-disable-next-line effecttsgo/missing-pipeable-signature -- a React hook, called as `usePageKey(key, run)`, never piped.
export const usePageKey = (
  key: string,
  run: () => void,
  options: {
    readonly allowInInput?: boolean;
    readonly when?: () => boolean;
  } = {}
) => {
  useShortcut(key, run, { ...options, repeat: true });
  useShortcut(`shift+${key}`, run, { ...options, repeat: true });
};
