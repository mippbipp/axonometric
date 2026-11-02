export { describeCause } from "./cause.ts";

export { acceptanceMessage, acceptLayoutChanges } from "./accept.ts";

export type { Acceptance, DroppedChange } from "./accept.ts";

export { chapterStopsOf, wholeMapChapterId } from "./chapters.ts";

export type { ChapterStop } from "./chapters.ts";

export { checkMap, linkTargets } from "./check.ts";

export type { CheckOptions, MapFiles } from "./check.ts";

export { excalidrawIds, excalidrawOf, excalidrawText } from "./excalidraw.ts";

export type {
  ExcalidrawArrow,
  ExcalidrawBinding,
  ExcalidrawBound,
  ExcalidrawElement,
  ExcalidrawFile,
  ExcalidrawFrame,
  ExcalidrawRectangle,
  ExcalidrawSource,
  ExcalidrawText,
} from "./excalidraw.ts";

export { exportName, pngScale } from "./export-name.ts";

export { groundOutline, toPoints } from "./ground-outline.ts";

export {
  dashes,
  exportFontFamily,
  fadedOpacity,
  exportFontStack,
  palette,
  whiteBackground,
} from "./palette.ts";

export { fileVersionFields, formatVersion } from "./fields.ts";

export {
  AcceptedItem,
  historyFolder,
  parseRevisionFileName,
  RejectedItem,
  Revision,
  RevisionFile,
  revisionFileName,
} from "./revisions.ts";

export {
  boxOutline,
  corners,
  gridOnScreen,
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
  clashWarnings,
  footprintsOverlap,
  placedStructures,
  tagCovers,
} from "./layout-checks.ts";

export type { PlacedStructure } from "./layout-checks.ts";

export { isoHeights } from "./iso-heights.ts";

export {
  groundProjections,
  planRect,
  planTagSpots,
  planUnit,
  projectPlan,
  views,
} from "./plan.ts";

export type { GroundProjection, View } from "./plan.ts";

export {
  GridPoint,
  Layout,
  LayoutFile,
  Placement,
  RouteOverride,
  samePlacement,
  samePosition,
  sameSize,
} from "./layout.ts";

export {
  defaultFootprint,
  groupGap,
  placeStructures,
  structureGap,
  zoneGap,
} from "./placement.ts";

export type { PlacedLayout } from "./placement.ts";

export {
  boundsOfPoints,
  convexOverlap,
  distanceToPolyline,
  gapBetween,
  growRect,
  segmentCrosses,
} from "./geometry.ts";

export type { Segment } from "./geometry.ts";

export { arrowHalfWidth } from "./ends.ts";

export { drawnRoutes } from "./fans.ts";

export { laneGap, laneRoutes, laneWidths } from "./lanes.ts";

export {
  chapterSpotlightOf,
  defaultFlowChoice,
  playedHopsOf,
  spotlightOf,
} from "./spotlight.ts";

export type {
  FlowChoice,
  Spotlight,
  SpotlightChoice,
  SpotlightTarget,
} from "./spotlight.ts";

export { routeCap, routeHops, routeLength, routeRevealed } from "./routing.ts";

export {
  arrowheadOf,
  arrowLength,
  arrowPolygon,
  endsOnTarget,
  labelGap,
  labelReach,
  labelReachLimit,
  planZoneRadius,
  sceneClashes,
  placeMovingNameTags,
  placeNameTags,
  tagScene,
  sceneOf,
  silhouette,
} from "./scene.ts";

export { fitFloorOf, textZoomOf } from "./fit-floor.ts";

export { textGrowthAt, textSizes } from "./text-size.ts";

export type { TextGrowth } from "./text-size.ts";

export type {
  HiddenStretch,
  Scene,
  ClashPart,
  SceneClash,
  SceneHop,
  SceneSource,
  SceneStructure,
  SceneZone,
  TaggedBox,
} from "./scene.ts";

export type { HopRoute } from "./routing.ts";

export { zonePadding, zonesOf } from "./zones.ts";

export type { Zone, ZoneSource } from "./zones.ts";

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
  Source,
  Stat,
  Status,
  statuses,
  statusLabels,
  Step,
  Structure,
} from "./map-data.ts";

export {
  compareMarks,
  describeDifferences,
  diffMaps,
  ghostedMap,
  restoreChanges,
} from "./diff.ts";

export type {
  CompareMarks,
  DataSection,
  DifferenceLine,
  DifferenceLines,
  FieldChange,
  GhostedMap,
  HopMark,
  MapDiff,
  MapSnapshot,
  Repositioned,
  StructureMark,
} from "./diff.ts";

export { MapState, mapStateElementId } from "./map-state.ts";

export {
  emptyHistory,
  observeFile,
  pushStep,
  redoStep,
  undoStep,
  wroteFile,
} from "./undo-history.ts";

export type { Observed, Stepped, UndoHistory } from "./undo-history.ts";

export {
  alignMoves,
  appendMove,
  distributeMoves,
  nudgeMoves,
  structuresInBox,
} from "./arrange.ts";

export type { Alignment, Axis, GroundBox, Placements } from "./arrange.ts";

export {
  applyLayoutChanges,
  ChangeId,
  checkProposals,
  clashOf,
  discardChange,
  emptyProposals,
  Footprint,
  LayoutChange,
  layoutChangeKey,
  LayoutChanges,
  layoutRefusal,
  MoveChange,
  newChangeId,
  placeStructure,
  Proposals,
  ProposalsFile,
  ResizeChange,
  sameLayoutChanges,
  StructureMove,
  StructureTarget,
  structuresOf,
  Target,
} from "./proposals.ts";

export type { Clash, Placing } from "./proposals.ts";

export {
  Accepted,
  AcceptWrite,
  HistoryEntry,
  historyEntryOf,
  HistoryList,
  LayoutChangeRefused,
  maxMessageLength,
  maxWriteBytes,
  PendingLayoutWrite,
  MapFilesUnreadable,
  RevisionNotFound,
  RevisionNumber,
  StaleProposals,
  ServedPage,
  servedPageElementId,
  ServerEvent,
  serverPaths,
  ServerState,
} from "./server.ts";

export {
  normalSourcePath,
  SourceFact,
  sourceKey,
  uniqueSources,
} from "./sources.ts";

export type { SourceFacts } from "./sources.ts";

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
