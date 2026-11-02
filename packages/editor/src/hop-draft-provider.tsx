import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { HopDraftContext } from "./hop-draft-context.ts";
import type { HopDraft, HopDrafting, HopStretch } from "./hop-draft-context.ts";

/** Holds the hop being drawn, and the drag that draws it. */
export function HopDraftProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [draft, setDraft] = useState<HopDraft | null>(null);
  const [stretch, setStretch] = useState<HopStretch | null>(null);

  const value = useMemo(
    (): HopDrafting => ({
      draft,
      stretch,
      stretchTo: setStretch,
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
    [draft, stretch]
  );

  return <HopDraftContext value={value}>{children}</HopDraftContext>;
}
