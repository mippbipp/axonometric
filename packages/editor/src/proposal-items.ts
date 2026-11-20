import type {
  BatchItem,
  ChapterChange,
  GroupChange,
  StructureChange,
} from "@axonometric/contracts";

// The open item a control would propose, as the kind table takes it, so the
// warnings panel can run the layout checks on the change before it is sent.
// The id is only for the preview: the check never reads it.

const previewId = "preview";

/** The structure item for `change`. */
export const structureItem = (change: StructureChange): BatchItem => ({
  change,
  id: previewId,
  kind: "structure",
});

/** The group item for `change`. */
export const groupItem = (change: GroupChange): BatchItem => ({
  change,
  id: previewId,
  kind: "group",
});

/** The chapter item for `change`. */
export const chapterItem = (change: ChapterChange): BatchItem => ({
  change,
  id: previewId,
  kind: "chapter",
});
