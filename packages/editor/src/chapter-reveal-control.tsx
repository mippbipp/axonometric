import type { Structure } from "@axonometric/contracts";

import { useChapterOps } from "./chapter-ops-context.ts";
import { useRevealToggle } from "./chapter-reveal.ts";
import { controlClass } from "./control-class.ts";
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
  const { send, failure, canPropose } = useChapterPropose();

  if (ops === null || toggle === undefined) {
    return null;
  }

  return (
    <section data-chapter-reveal className="flex flex-col gap-2">
      <h3 className="text-xs tracking-widest uppercase opacity-70">
        In this chapter
      </h3>
      <div className="flex flex-col items-start gap-1.5">
        <button
          type="button"
          data-chapter-toggle={toggle.change.action}
          className={controlClass}
          disabled={!canPropose || toggle.unavailable !== undefined}
          title={toggle.unavailable}
          onClick={() => {
            send(toggle.change);
          }}
        >
          {toggle.label}
        </button>
        {toggle.unavailable === undefined ? null : (
          <p data-chapter-toggle-note className="text-xs opacity-70">
            {toggle.unavailable}
          </p>
        )}
        {toggle.pending ? (
          <p data-chapter-toggle-pending className="text-xs opacity-70">
            Proposed for this chapter. It stays here, outlined, until the agent
            has reviewed it.
          </p>
        ) : null}
        {failure === undefined ? null : (
          <p
            role="alert"
            data-chapter-failure
            className="border-refused border-l-2 pl-2 text-xs"
          >
            {failure}
          </p>
        )}
      </div>
    </section>
  );
}
