import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { HopDraftContext } from "./hop-draft-context.ts";
import type { HopDraft, HopDrafting, HopStretch } from "./hop-draft-context.ts";
import { useMarkDragging } from "./use-mark-dragging.ts";

/** Holds the hop being drawn, and the drag that draws it. */
export function HopDraftProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [draft, setDraft] = useState<HopDraft | null>(null);
  const [stretch, setStretch] = useState<HopStretch | null>(null);

  useMarkDragging(stretch !== null);

  const value = useMemo(
    (): HopDrafting => ({
      begin: (from, to) => {
        setDraft({ from, to: to ?? null });
      },
      cancel: () => {
        setDraft(null);
      },
      draft,
      pick: (to) => {
        setDraft((held) => (held === null ? held : { ...held, to }));
      },
      stretch,
      stretchTo: setStretch,
    }),
    [draft, stretch]
  );

  return <HopDraftContext value={value}>{children}</HopDraftContext>;
}
