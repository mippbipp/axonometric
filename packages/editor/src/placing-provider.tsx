import type { GridPoint } from "@axonometric/contracts";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { PlaceContext } from "./place-context.ts";
import type { Draft, Placing } from "./place-context.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

const blank: Draft = { name: "", shape: "box", group: "", status: "planned" };

/** Holds the add form's draft and where its structure goes. */
export function PlacingProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { state } = useWalkthrough();
  const firstGroup = state.data.groups[0]?.id ?? "";
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(blank);
  const [picking, setPicking] = useState(false);
  const [spot, setSpot] = useState<GridPoint | null>(null);

  const value = useMemo(
    (): Placing => ({
      open,
      setOpen: (next) => {
        setOpen(next);

        if (next) {
          setDraft((held) =>
            held.group === "" ? { ...held, group: firstGroup } : held
          );
        } else {
          setPicking(false);
          setSpot(null);
          setDraft(blank);
        }
      },
      draft,
      setDraft,
      picking,
      spot,
      pick: setPicking,
      setSpot,
    }),
    [open, draft, picking, spot, firstGroup]
  );

  return <PlaceContext value={value}>{children}</PlaceContext>;
}
