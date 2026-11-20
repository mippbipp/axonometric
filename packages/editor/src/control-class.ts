/** The look of the walkthrough's small bordered buttons. */
export const controlClass =
  "border-ink focus-visible:outline-ink cursor-pointer border bg-paper text-ink px-2 py-0.5 text-xs focus-visible:outline-2 focus-visible:outline-offset-1 disabled:cursor-default disabled:opacity-40";

/**
 * The same look for a ui-sdk Toggle or ToolbarButton, which carry their own
 * size and colours. The pressed state is ui-sdk's `data-pressed`, set as an
 * empty string, so the variant is written `data-[pressed]:`.
 */
export const uiControlClass = `${controlClass} h-auto min-w-0 rounded-none font-normal transition-none hover:bg-paper hover:text-ink data-[pressed]:bg-ink data-[pressed]:text-paper aria-disabled:cursor-default aria-disabled:opacity-40`;
