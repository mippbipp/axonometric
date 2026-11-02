import { createContext, use } from "react";

/**
 * Whether the form that creates a group is open. The form sits in the side
 * panel, under the tabs, so it never covers the drawing; the toolbar and the
 * structure menu open it.
 */
export interface NewGroupForm {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
}

export const NewGroupContext = createContext<NewGroupForm | null>(null);

/** The new-group form's state, or `null` outside a page that can propose. */
export const useNewGroupForm = (): NewGroupForm | null => use(NewGroupContext);
