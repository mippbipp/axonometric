import { createContext, use } from "react";

/**
 * Whether the engineer is editing, for a page that `serve` serves. With it
 * off the page is for reading and presenting: it draws pending changes and
 * proposals but hides every control that makes one, except answering a
 * question. The read-only file has no `EditContext`, so it has no Edit
 * button and no editing controls at all.
 */
export interface EditSwitch {
  readonly on: boolean;
  readonly set: (on: boolean) => void;
}

export const EditContext = createContext<EditSwitch | null>(null);

/** The Edit switch, or `null` on a page that can't edit. */
export const useEditSwitch = (): EditSwitch | null => use(EditContext);

/** Whether Edit is on. Always false on a page that can't edit. */
export const useEditOn = (): boolean => useEditSwitch()?.on === true;

/**
 * `value` while Edit is on, else `null`. The hooks that give controls their
 * editing state use it, so one place turns every control off.
 */
export const useWhileEditOn = <A>(value: A | null): A | null =>
  useEditOn() ? value : null;
