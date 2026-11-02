import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { HopDraftContext } from "./hop-draft-context.ts";
import type { HopDraft, HopDrafting } from "./hop-draft-context.ts";

/** Holds the hop being drawn. */
export function HopDraftProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [draft, setDraft] = useState<HopDraft | null>(null);

  const value = useMemo(
    (): HopDrafting => ({
      draft,
      begin: (from, to) => {
        setDraft({ from, to: to ?? null });
      },
      pick: (to) => {
        setDraft((held) => (held === null ? held : { ...held, to }));
      },
      cancel: () => {
        setDraft(null);
      },
    }),
    [draft]
  );

  return <HopDraftContext value={value}>{children}</HopDraftContext>;
}
