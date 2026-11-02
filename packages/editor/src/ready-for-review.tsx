import type { FreezeAnswer } from "@axonometric/contracts";
import { Result } from "effect";
import { useEffect, useId, useRef, useState } from "react";

import { controlClass } from "./control-class.ts";
import { useEditing } from "./editing-context.ts";
import { useReview } from "./review-context.ts";

/** What the dialog shows once a batch is frozen. */
interface Sent {
  readonly frozen: FreezeAnswer;
  /** Whether the prompt reached the clipboard. */
  readonly copied: boolean;
}

/**
 * Copies `text` and calls `done` with whether the browser allowed it. A
 * browser without a clipboard API, or one that wants a gesture it didn't see,
 * says no, and the dialog shows the prompt in a box instead.
 */
const copyToClipboard = (text: string, done: (copied: boolean) => void) => {
  // SAFETY: the DOM types say `clipboard` always exists, but browsers drop it
  // on pages that aren't secure contexts, such as http on a LAN address.
  const clipboard = navigator.clipboard as Clipboard | undefined;

  if (clipboard === undefined) {
    done(false);

    return;
  }

  clipboard.writeText(text).then(
    () => {
      done(true);
    },
    () => {
      done(false);
    }
  );
};

/**
 * The prompt in a box, selected so Ctrl+C or ⌘C copies it. The dialog shows
 * it whether or not the clipboard worked, so the engineer can read what the
 * agent will be told.
 */
function PromptBox({
  prompt,
  selectOnOpen,
}: {
  readonly prompt: string;
  readonly selectOnOpen: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  useEffect(() => {
    if (selectOnOpen) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [selectOnOpen]);

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={id}
        className="text-xs tracking-widest uppercase opacity-70"
      >
        Prompt for your agent
      </label>
      <textarea
        id={id}
        ref={ref}
        data-review-prompt
        readOnly
        spellCheck={false}
        rows={10}
        value={prompt}
        className="border-ink bg-face text-ink focus-visible:outline-ink resize-y border p-2 text-xs focus-visible:outline-2 focus-visible:outline-offset-1"
        onFocus={(event) => {
          event.currentTarget.select();
        }}
      />
    </div>
  );
}

/**
 * The "Ready for review" button and its dialog. Pressing the button freezes
 * every open change and note into the next batch, copies the prompt, and
 * opens the dialog. When the browser refuses the clipboard, the dialog says
 * so and selects the prompt's text. The dialog and the prompt both say the
 * list is a summary and that the full details are in `proposals.json`.
 */
export function ReadyForReview() {
  const review = useReview();
  const editing = useEditing();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [sent, setSent] = useState<Sent | null>(null);
  const [failure, setFailure] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const element = dialog.current;

    if (element === null) {
      return;
    }

    if (sent === null) {
      if (element.open) {
        element.close();
      }
    } else if (!element.open) {
      element.showModal();
    }
  }, [sent]);

  if (review === null) {
    return null;
  }

  const open = (editing?.pending.length ?? 0) + review.openNotes;

  const press = () => {
    setBusy(true);
    setFailure(undefined);

    review.ops.freeze((outcome) => {
      if (Result.isFailure(outcome)) {
        setFailure(outcome.failure);
        setBusy(false);

        return;
      }

      const frozen = outcome.success;

      // Tried right after the answer arrives. A browser that wants a click
      // for the clipboard refuses, and the dialog shows the prompt instead.
      copyToClipboard(frozen.prompt, (copied) => {
        setSent({ frozen, copied });
        setBusy(false);
      });
    });
  };

  const copyAgain = () => {
    if (sent !== null) {
      copyToClipboard(sent.frozen.prompt, (copied) => {
        setSent({ ...sent, copied });
      });
    }
  };

  return (
    <>
      <button
        type="button"
        data-ready-for-review
        className={controlClass}
        disabled={!review.canWrite || busy || open === 0}
        title={
          open === 0
            ? "Add a note or move a structure first"
            : "Freeze these into a batch and copy a prompt for your agent"
        }
        onClick={press}
      >
        {busy ? "Saving…" : `Ready for review · ${open}`}
      </button>
      {failure === undefined ? null : (
        <output
          data-review-failure
          className="border-refused max-w-64 border-l-2 pl-2 text-xs"
        >
          {failure}
        </output>
      )}
      <dialog
        ref={dialog}
        data-review-dialog
        aria-labelledby={titleId}
        className="border-ink bg-paper text-ink m-auto max-w-lg overscroll-contain border-2 p-0 font-mono backdrop:bg-black/40"
        onClose={() => {
          setSent(null);
        }}
      >
        {sent === null ? null : (
          <div className="flex flex-col gap-3 p-4 text-sm">
            <h2
              id={titleId}
              data-review-title
              className="text-base font-medium text-balance"
            >
              Batch {sent.frozen.batch.number} is ready for your agent
            </h2>
            <p data-review-copied={sent.copied}>
              {sent.copied
                ? "The prompt is copied. Paste it into your agent."
                : "Your browser blocked the clipboard. The prompt is selected below. Copy it and paste it into your agent."}
            </p>
            <p data-review-summary-note className="text-xs opacity-80">
              The list in the prompt is a summary. The full details are in{" "}
              <code translate="no">{sent.frozen.home}/proposals.json</code>.
            </p>
            <PromptBox
              prompt={sent.frozen.prompt}
              selectOnOpen={!sent.copied}
            />
            <p className="text-xs opacity-80">
              You can keep editing. New changes go in batch{" "}
              {sent.frozen.batch.number + 1}.
            </p>
            <form method="dialog" className="flex gap-1.5">
              <button
                type="button"
                data-review-copy
                className={controlClass}
                onClick={copyAgain}
              >
                Copy the prompt
              </button>
              <button type="submit" data-review-close className={controlClass}>
                Close
              </button>
            </form>
          </div>
        )}
      </dialog>
    </>
  );
}
