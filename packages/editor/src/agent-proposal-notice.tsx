import { Button } from "@axonometric/ui/components/button";
import { Array as Arr } from "effect";

import { uiControlClass } from "./control-class.ts";
import { useEditOn } from "./edit-context.ts";
import { agentProposalOf, useEditingIgnoringEdit } from "./editing-context.ts";
import { useSideTab } from "./side-tab-context.ts";

/**
 * What the page says while Edit is off and the agent has layout changes
 * pending: how many, why, and a button to the Pending tab. The changes are
 * drawn in the pending look either way. Accepting them still needs Edit on.
 * The notice is an `output`, so a screen reader hears it appear and hears it
 * again when the count or the reasons change.
 */
export function AgentProposalNotice() {
  const proposal = agentProposalOf(useEditingIgnoringEdit());
  const editOn = useEditOn();
  const { choose } = useSideTab();

  if (proposal === undefined || editOn) {
    return null;
  }

  const { count, reasons } = proposal;
  const what = `${count} layout ${count === 1 ? "change" : "changes"}`;

  return (
    <output
      className="border-ink bg-paper text-ink pointer-events-auto flex max-w-full shrink-0 flex-col gap-1.5 border px-3 py-1.5 text-xs"
      data-agent-proposal-notice
    >
      <span>
        <b className="font-medium">The agent proposed {what}.</b>
        {reasons.length === 0
          ? " It gave no reason."
          : ` Reason: ${Arr.join(reasons, "; ")}.`}
        {" Turn Edit on to accept or discard them."}
      </span>
      <Button
        className={`${uiControlClass} self-start`}
        data-agent-proposal-link
        onClick={() => {
          choose("pending");
        }}
      >
        See them in Pending
      </Button>
    </output>
  );
}
