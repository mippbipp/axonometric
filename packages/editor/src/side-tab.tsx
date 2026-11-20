import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { useNoteTool } from "./note-tool-context.ts";
import { useSelection } from "./selection-context.ts";
import { SideTabContext } from "./side-tab-context.ts";
import type { SideTab, Tab } from "./side-tab-context.ts";

/** What the selection is called, so a tab other than Details knows when it changed. */
const pickedKey = ({
  selected,
  selectedGroup,
  selectedHop,
  spot,
}: {
  readonly selected: string | null;
  readonly selectedGroup: string | null;
  readonly selectedHop: string | null;
  readonly spot: { readonly x: number; readonly y: number } | null;
}): string | null => {
  if (selected !== null) {
    return selected;
  }

  if (selectedGroup !== null) {
    return `group:${selectedGroup}`;
  }

  if (selectedHop !== null) {
    return `hop:${selectedHop}`;
  }

  return spot === null ? null : `spot:${spot.x},${spot.y}`;
};

/** Keeps the chosen tab above the side panel and the notices. */
export function SideTabProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { selected, selectedGroup, selectedHop } = useSelection();
  const spot = useNoteTool()?.spot ?? null;
  const picked = pickedKey({ selected, selectedGroup, selectedHop, spot });

  const [other, setOther] = useState<{
    readonly selected: string | null;
    readonly tab: Tab;
  } | null>(null);

  const value = useMemo(
    (): SideTab => ({
      choose: (tab) => {
        setOther(tab === "details" ? null : { selected: picked, tab });
      },
      chosen:
        other !== null && other.selected === picked ? other.tab : "details",
    }),
    [other, picked]
  );

  return <SideTabContext value={value}>{children}</SideTabContext>;
}
