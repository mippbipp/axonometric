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
  id: previewId,
  kind: "structure",
  change,
});

/** The group item for `change`. */
export const groupItem = (change: GroupChange): BatchItem => ({
  id: previewId,
  kind: "group",
  change,
});

/** The chapter item for `change`. */
export const chapterItem = (change: ChapterChange): BatchItem => ({
  id: previewId,
  kind: "chapter",
  change,
});
