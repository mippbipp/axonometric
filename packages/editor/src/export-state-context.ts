import type { MapState } from "@axonometric/contracts";
import { createContext, use } from "react";

/**
 * The map an export draws, when it isn't the map on screen. The page shows
 * the map as proposed, with structures that only exist as proposals; an
 * export is what the files hold, so the served page gives it the map without
 * them. A page with no proposals has none, and exports what it shows.
 */
export const ExportStateContext = createContext<MapState | null>(null);

/** The map to export, or `null` to export the one on screen. */
export const useExportState = (): MapState | null => use(ExportStateContext);
