import type { GridPoint } from "@axonometric/contracts";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { PlaceContext } from "./place-context.ts";
import type { Placing } from "./place-context.ts";

/** Holds where a new structure goes while its form is open. */
export function PlacingProvider({ children }: { readonly children: ReactNode }) {
  const [picking, setPicking] = useState(false);
  const [spot, setSpot] = useState<GridPoint | null>(null);

  const value = useMemo(
    (): Placing => ({ picking, spot, pick: setPicking, setSpot }),
    [picking, spot]
  );

  return <PlaceContext value={value}>{children}</PlaceContext>;
}
