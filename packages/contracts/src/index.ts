export { describeCause } from "./cause.ts";

export { acceptanceMessage, acceptLayoutChanges } from "./accept.ts";

export type { Acceptance, DroppedChange, MessageOptions } from "./accept.ts";

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
  changedChapterProblems,
  changedProblems,
  checkChapter,
  checkLayout,
  clashWarnings,
  draggedProblems,
  footprintsOverlap,
  offEndFindings,
  onOutline,
  placedStructures,
  tagCovers,
} from "./layout-checks.ts";

export type {
  Checkable,
  DraggedProblem,
  HopEnds,
  OffEnd,
  PlacedStructure,
} from "./layout-checks.ts";

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
  maxRoutePoints,
  maxRouteReach,
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
  rectPolygon,
  segmentCrosses,
  segmentsOf,
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

export { groupMembers, zonePadding, zonesOf } from "./zones.ts";

export type { Zone, ZoneSource } from "./zones.ts";

export {
  Chapter,
  Decision,
  DeepDive,
  Flow,
  Group,
  Hop,
  hopLabelOf,
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
  hopsOf,
  HopTarget,
  idOfTargetKey,
  LayoutChange,
  layoutChangeKey,
  LayoutChanges,
  layoutRefusal,
  MoveChange,
  newChangeId,
  placeRoute,
  placeStructure,
  Proposals,
  ProposalsFile,
  RerouteChange,
  ResizeChange,
  sameLayoutChanges,
  shiftedRoutes,
  sharedTarget,
  StructureMove,
  StructureTarget,
  structuresOf,
  Target,
  targetIdsOf,
  targetKeysOf,
} from "./proposals.ts";

export type { Clash, Placing, PlacingRoute } from "./proposals.ts";

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

export { outsideHoles, strikeSegments } from "./strike.ts";

export { clearOfText, outlineClearance, textBoxesOf } from "./clear-of-text.ts";

export { dragSegment, routeVertices, segmentGuides } from "./route-drag.ts";

export type { RouteEnds, SegmentGuide } from "./route-drag.ts";

export {
  Answer,
  AnswerDate,
  Batch,
  BatchItem,
  Committed,
  maxNoteLength,
  maxSuggestionLength,
  Note,
  NoteTarget,
  NoteText,
  QuestionRef,
  RaisedQuestion,
  SpotTarget,
  Suggestion,
  SuggestionText,
  TextField,
  maxReasonLength,
  Reason,
  RequiredReason,
  StructureProposal,
  HopProposal,
  FlowProposal,
  GroupProposal,
  ChapterProposal,
  Verdict,
  verdictKinds,
} from "./proposals.ts";

export {
  acceptRefusal,
  addItem,
  batchesOf,
  breakageOf,
  checkOpenItems,
  commitBatch,
  committedRenames,
  commitMessage,
  discardProposal,
  dismissItem,
  editProposal,
  findBatchItem,
  freezeOpen,
  frozenLayoutChanges,
  frozenWriteRefusal,
  frozenRefusal,
  nextBatchNumber,
  oldestOpenBatch,
  openItemCount,
  openItems,
  recordVerdict,
  reopenItem,
  reviewEntries,
  reviewPrompt,
  changedLayoutNotice,
  engineerTextNotice,
  kindNotices,
  summaryLine,
  fullNames,
  bySection,
  inSections,
  sectionOf,
  withoutVerdict,
} from "./review.ts";

export type {
  Committing,
  FreezeResult,
  Known,
  ItemStatus,
  PartialNames,
  ReviewEntry,
} from "./review.ts";

export {
  AnswerAdd,
  FreezeWrite,
  FreezeAnswer,
  ItemWrite,
  NoteAdd,
  ItemEdit,
  ProposalRefused,
  QuestionAdd,
  ReopenWrite,
  FlowWrite,
  HopWrite,
  ChapterWrite,
  GroupWrite,
  maxGroupMembers,
  StructureWrite,
  SuggestionAdd,
} from "./review-server.ts";

export {
  boxStroke,
  centreClearance,
  edgeStroke,
  gapAt,
  hopStroke,
  minScreenGap,
  noteMarkerRadius,
  noteMarkerStroke,
  placeNoteMarkers,
  visibleGap,
} from "./note-markers.ts";

export type {
  NoteBearers,
  NoteMarkerSpot,
  PlacedMarkers,
  PlacedSpot,
} from "./note-markers.ts";

export {
  allKinds,
  applyOrder,
  kindTable,
  sections,
  sectionTitles,
  oneLine,
  quoteText,
  removedMark,
  specOf,
} from "./review-kinds.ts";

export type {
  CommitContext,
  Existing,
  KindSpec,
  Landing,
  MapShape,
  Mark,
  Names,
  Pointer,
  Section,
  Touches,
  Waiting,
} from "./review-kinds.ts";

export {
  frozenItems,
  layoutUnderProposals,
  marked,
  proposedMap,
} from "./proposed-map.ts";

export type { Mappable, MarkQuery, ProposedMap } from "./proposed-map.ts";

export { namesOf } from "./review-names.ts";

export { proposalProblems } from "./proposal-problems.ts";

export type { CheckScope } from "./proposal-problems.ts";

export {
  FinalId,
  maxProposedReach,
  maxProposedSide,
  maxStructureNameLength,
  NewStructure,
  ProposedPlacement,
  provisionalIdOf,
  ProvisionalId,
  sameStructureChange,
  StructureChange,
  StructureId,
  StructureName,
  structureOf,
} from "./structure-change.ts";

export {
  actionOf,
  codeOfName,
  proposedDetails,
  proposedOneLiner,
  structureActions,
  structureOfNew,
} from "./structure-actions.ts";

export type { DescribeNames, StructureAction } from "./structure-actions.ts";

export {
  candidateProblems,
  defaultSpotFor,
  describePlacement,
  droppedIntoGroup,
  referencesTo,
  structureBreakage,
  structureChangeToData,
  structureChangeToLayout,
} from "./structure-effects.ts";

export type { StructureLanding } from "./structure-effects.ts";

export {
  addedIds,
  frozenStructureChanges,
  openStructureChanges,
} from "./structure-held.ts";

export {
  checkStructureProposals,
  newProvisionalId,
  proposeStructure,
} from "./structure-proposals.ts";

export type { StructureWorld } from "./structure-proposals.ts";

export {
  GroupChange,
  GroupId,
  groupOf,
  GroupTitle,
  maxGroupTitleLength,
  NewGroup,
  provisionalGroupIdOf,
  sameGroupSubject,
  titleOf,
} from "./group-change.ts";

export {
  newProvisionalGroupId,
  proposeGroup,
  proposeGroupWithMembers,
} from "./group-proposals.ts";

export type { GroupWorld, Member } from "./group-proposals.ts";

export { groupMark } from "./review-kinds-group.ts";

export {
  applyChapterChange,
  chapterActions,
  chapterBreakage,
  ChapterChange,
  ChapterId,
  chapterHolds,
  chapterProblems,
  chaptersAfter,
  hopsOfChange,
  HopId,
  maxPlayedHops,
  resequenced,
  revealedUpTo,
  structuresOfChange,
  subjectOf,
} from "./chapter-change.ts";

export type { ChapterProblem } from "./chapter-change.ts";

export { proposeChapter } from "./chapter-proposals.ts";

export type { ChapterWorld } from "./chapter-proposals.ts";

export { chapterMarkName } from "./review-kinds-chapter.ts";

export {
  fieldLabel,
  isTextField,
  parseTextField,
  plainFields,
  stepDetailField,
  stepNameField,
  textOfField,
} from "./text-fields.ts";

export type { FieldPath, StepPart } from "./text-fields.ts";

export {
  Facts,
  ReportedItem,
  ReviewedBatch,
  ReviewReport,
  VerdictFacts,
} from "./review-report.ts";

export {
  HopChange,
  HopLabel,
  HopRef,
  hopOf,
  maxHopLabelLength,
  NewHop,
  FlowRef,
  sameHopChange,
  sameHopSubject,
} from "./hop-change.ts";

export {
  FlowChange,
  FlowName,
  flowOf,
  maxFlowNameLength,
  NewFlow,
  sameFlowChange,
  sameFlowSubject,
} from "./flow-change.ts";

export {
  describeHop,
  flowsOfHop,
  hopBreakage,
  hopCandidateProblems,
  hopChangeToData,
  hopIsCurrent,
  hopLabel,
  referencesToHop,
  summarizeHop,
} from "./hop-effects.ts";

export type { HopLanding, HopNames } from "./hop-effects.ts";

export {
  describeFlow,
  flowBreakage,
  flowChangeToData,
  flowIsCurrent,
  flowLabel,
  inFlowOrder,
  summarizeFlow,
} from "./flow-effects.ts";

export type { FlowLanding, FlowNames } from "./flow-effects.ts";

export {
  addedFlowIds,
  addedHopIds,
  frozenFlowChanges,
  frozenHopChanges,
  openFlowChanges,
  openHopChanges,
  withoutOpenHop,
} from "./connection-held.ts";

export {
  checkConnectionProposals,
  newFlowId,
  newHopId,
  proposeFlow,
  proposeHop,
} from "./connection-proposals.ts";

export type { ConnectionWorld } from "./connection-proposals.ts";

export { changedFlowMark } from "./review-kinds-flow.ts";

export { proposedHopMark, removedHopMark } from "./review-kinds-hop.ts";

export {
  entities,
  followed,
  hasRenames,
  noKnownIds,
  noRenames,
  provisionalOf,
  renamesOf,
} from "./provisional-ids.ts";

export type {
  Entity,
  KnownIds,
  Rename,
  Renames,
  VerdictContext,
} from "./provisional-ids.ts";

export { lineBreak, oneLineText } from "./text-schemas.ts";

export { hopActionOf, hopActions } from "./hop-actions.ts";

export { flowActionOf, flowActions, hopsWith } from "./flow-actions.ts";

export { moveItem } from "./reorder.ts";
