import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { NewGroupContext } from "./new-group-context.ts";
import type { NewGroupForm } from "./new-group-context.ts";

/** Holds whether the form that creates a group is open. */
export function NewGroupProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const value = useMemo((): NewGroupForm => ({ open, setOpen }), [open]);

  return <NewGroupContext value={value}>{children}</NewGroupContext>;
}
