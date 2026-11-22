import { useChangePreview } from "./drag-preview-context.ts";
import { isTyping } from "./engineer-busy.ts";
import { useHopDraft } from "./hop-draft-context.ts";
import { useNoteTool } from "./note-tool-context.ts";
import { usePageKey } from "./page-key.ts";
import { useSelection } from "./selection-context.ts";

type Step = readonly [open: boolean, letGo: () => void];

const firstOpen = (steps: ReadonlyArray<Step>) =>
  steps.find(([open]) => open)?.[1];

const tooltipOpen = () =>
  document.querySelector('[role="tooltip"][data-open]') !== null;

/**
 * Escape lets go of one thing a press, the first that is open: the armed
 * Note tool, a spot's panel, then an open tooltip, the multi-selection, the
 * selected hop, the inside view and the pinned structure. A hop being drawn
 * is dropped on any Escape, from a field too.
 */
export const useEscapeKey = () => {
  const drafting = useHopDraft();
  const preview = useChangePreview();
  const tool = useNoteTool();
  const {
    clearMultiSelection,
    comeOut,
    inside,
    multiSelection,
    select,
    selected,
    selectedHop,
    selectHop,
  } = useSelection();

  const drawing = drafting !== null && drafting.draft !== null;

  const firstStep = () =>
    firstOpen([
      [tool?.armed === true, () => tool?.arm(false)],
      [tool !== null && tool.spot !== null, () => tool?.pick(null)],
    ]) ??
    // ui-sdk's shortcuts hear Escape before an open tooltip does. The
    // tooltip takes it, as it did before these keys moved to ui-sdk.
    (tooltipOpen()
      ? undefined
      : firstOpen([
          [multiSelection.size > 0, clearMultiSelection],
          [selectedHop !== null, () => selectHop(null)],
          [inside !== null, comeOut],
          [selected !== null, () => select(null)],
        ]));

  usePageKey(
    "escape",
    () => {
      preview?.clear();
      drafting?.cancel();

      if (!isTyping(document.activeElement)) {
        firstStep()?.();
      }
    },
    { allowInInput: true, when: () => drawing }
  );
  usePageKey("escape", () => firstStep()?.(), {
    when: () => !drawing && firstStep() !== undefined,
  });
};
