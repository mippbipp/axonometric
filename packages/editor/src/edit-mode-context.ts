import { createContext, use } from "react";

/**
 * Whether the engineer is editing, for a page that `serve` serves. With it
 * off the page is for reading and presenting: it draws pending changes and
 * proposals but hides every control that makes one, except answering a
 * question. The read-only file has no `EditModeContext`, so it has no Edit
 * button and no editing controls at all.
 */
export interface EditMode {
  readonly on: boolean;
  readonly set: (on: boolean) => void;
}

export const EditModeContext = createContext<EditMode | null>(null);

/** The edit mode, or `null` on a page that can't edit. */
export const useEditMode = (): EditMode | null => use(EditModeContext);

/** Whether Edit is on. Always false on a page that can't edit. */
export const useEditOn = (): boolean => useEditMode()?.on === true;
