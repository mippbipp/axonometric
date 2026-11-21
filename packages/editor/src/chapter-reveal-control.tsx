import type { Structure } from "@axonometric/contracts";
import { Button } from "@axonometric/ui/components/button";
import { WithTooltip } from "@axonometric/ui/components/tooltip";

import { useRevealToggle } from "./chapter-reveal.ts";
import { uiControlClass } from "./control-class.ts";
import { useChapterOps } from "./proposal-ops-context.ts";
import { useChapterPropose } from "./use-chapter-propose.ts";

/**
 * A structure's panel section for this chapter: the toggle that proposes
 * showing it here, or hiding it from here. It changes the chapter, and the
 * diagram not at all.
 */
export function ChapterReveal({
  structure,
}: {
  readonly structure: Structure;
}) {
  const ops = useChapterOps();
  const toggle = useRevealToggle(structure.id);
  const { canPropose, failure, send } = useChapterPropose();

  if (ops === null || toggle === undefined) {
    return null;
  }

  return (
    <section className="flex flex-col gap-2" data-chapter-reveal>
      <h3 className="text-xs tracking-widest uppercase opacity-70">
        In this chapter
      </h3>
      <div className="flex flex-col items-start gap-1.5">
        <WithTooltip
          control={
            <Button
              className={uiControlClass}
              data-chapter-toggle={toggle.change.action}
              disabled={!canPropose || toggle.unavailable !== undefined}
              focusableWhenDisabled
              onClick={() => {
                send(toggle.change);
              }}
            >
              {toggle.label}
            </Button>
          }
          disabled={toggle.unavailable === undefined}
        >
          {toggle.unavailable}
        </WithTooltip>
        {toggle.unavailable === undefined ? null : (
          <p className="text-xs opacity-70" data-chapter-toggle-note>
            {toggle.unavailable}
          </p>
        )}
        {toggle.pending ? (
          <p className="text-xs opacity-70" data-chapter-toggle-pending>
            Proposed for this chapter. It stays here, outlined, until the agent
            has reviewed it.
          </p>
        ) : null}
        {failure === undefined ? null : (
          <p
            className="border-refused border-l-2 pl-2 text-xs"
            data-chapter-failure
            role="alert"
          >
            {failure}
          </p>
        )}
      </div>
    </section>
  );
}
