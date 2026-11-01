export { describeCause } from "./cause.ts";

export { checkMap, linkTargets } from "./check.ts";

export type { CheckOptions, MapFiles } from "./check.ts";

export { fileVersionFields, formatVersion } from "./fields.ts";

export {
  boxOutline,
  corners,
  nameTagRect,
  nameTagText,
  project,
  tagCharWidth,
  tagCoversBox,
  tagDrop,
  tagHeight,
  tagOffset,
  tagPadding,
  tileHeight,
  tileWidth,
} from "./iso.ts";

export type { Corners, GridPosition, ScreenPoint, ScreenRect } from "./iso.ts";

export {
  checkLayout,
  footprintsOverlap,
  placedStructures,
  tagCovers,
} from "./layout-checks.ts";

export type { PlacedStructure } from "./layout-checks.ts";

export { isoHeights } from "./iso-heights.ts";

export {
  GridPoint,
  Layout,
  LayoutFile,
  Placement,
  RouteOverride,
} from "./layout.ts";

export {
  defaultFootprint,
  groupGap,
  placeStructures,
  structureGap,
  zoneGap,
  zonePadding,
} from "./placement.ts";

export type { PlacedLayout } from "./placement.ts";

export { routeHops } from "./routing.ts";

export type { HopRoute } from "./routing.ts";

export {
  Chapter,
  Decision,
  DeepDive,
  Flow,
  Group,
  Hop,
  MapData,
  OpenQuestion,
  Overview,
  Question,
  ResolvedQuestion,
  Shape,
  shapes,
  Stat,
  Status,
  statuses,
  statusLabels,
  Step,
  Structure,
} from "./map-data.ts";

export { MapState, mapStateElementId } from "./map-state.ts";

export {
  formatCount,
  formatPath,
  formatProblem,
  MapFile,
  mapError,
  MapProblem,
  mapWarning,
  problemsFromIssue,
  Severity,
  splitProblems,
} from "./problems.ts";
