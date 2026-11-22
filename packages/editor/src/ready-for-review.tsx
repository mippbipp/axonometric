import type { FreezeAnswer } from "@axonometric/contracts";
import { Button } from "@axonometric/ui/components/button";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@axonometric/ui/components/dialog";
import { Textarea } from "@axonometric/ui/components/textarea";
import { WithTooltip } from "@axonometric/ui/components/tooltip";
import { Array as Arr, Result } from "effect";
import { useEffect, useRef, useState } from "react";

import { uiControlClass } from "./control-class.ts";
import { useEditingIgnoringEdit } from "./editing-context.ts";
import { LabelledField } from "./labelled-field.tsx";
import { useReview } from "./review-context.ts";

/** What the dialog shows once a batch is frozen. */
interface Sent {
  /** Whether the prompt reached the clipboard. */
  readonly copied: boolean;
  readonly frozen: FreezeAnswer;
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

  useEffect(() => {
    if (selectOnOpen) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [selectOnOpen]);

  return (
    <LabelledField
      label="Prompt for your agent"
      labelClassName="tracking-widest uppercase"
    >
      <Textarea
        className="bg-face p-2"
        data-review-prompt
        onFocus={(event) => {
          event.currentTarget.select();
        }}
        readOnly
        ref={ref}
        rows={10}
        spellCheck={false}
        value={prompt}
      />
    </LabelledField>
  );
}

/**
 * Where focus goes when the dialog closes. The button that opened it is gone
 * once the batch is frozen, so it goes to the Pending tab, which lists the
 * frozen items.
 */
const pendingTab = () =>
  document.querySelector<HTMLElement>('[role="tab"][data-tab="pending"]');

/**
 * The "Ready for review" button and its dialog. Pressing the button freezes
 * every open change and note into the next batch, copies the prompt, and
 * opens the dialog. When the browser refuses the clipboard, the dialog says
 * so and selects the prompt's text. The dialog and the prompt both say the
 * list is a summary and that the full details are in `proposals.json`.
 */
export function ReadyForReview() {
  const review = useReview();
  const editing = useEditingIgnoringEdit();
  const [sent, setSent] = useState<Sent | null>(null);
  const [failure, setFailure] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  if (review === null) {
    return null;
  }

  // The agent's layout changes stay open when the batch freezes.
  const open =
    Arr.filter(editing?.pending ?? [], ({ by }) => by === "engineer").length +
    review.openText;

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
        setSent({ copied, frozen });
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

  // With nothing waiting there is nothing to send, so no button. It stays
  // while a press is saving, which empties the count.
  const showButton = open > 0 || busy;

  return (
    <>
      {showButton ? (
        <WithTooltip
          control={
            <Button
              className={uiControlClass}
              data-ready-for-review
              disabled={!review.canWrite || busy || open === 0}
              focusableWhenDisabled
              onClick={() => {
                press();
              }}
            >
              {busy ? "Saving…" : `Ready for review · ${open}`}
            </Button>
          }
        >
          {open === 0
            ? "Add a note, a suggestion or an answer, or move a structure first"
            : "Freeze these into a batch and copy a prompt for your agent"}
        </WithTooltip>
      ) : null}
      {failure === undefined ? null : (
        <output
          className="border-refused max-w-64 border-l-2 pl-2 text-xs"
          data-review-failure
        >
          {failure}
        </output>
      )}
      <Dialog
        onOpenChange={(next) => {
          if (!next) {
            setSent(null);
          }
        }}
        open={sent !== null}
      >
        <DialogBackdrop />
        <DialogContent
          className="border-ink bg-paper text-ink w-fit max-w-[min(32rem,90vw)] overscroll-contain p-0"
          data-review-dialog
          finalFocus={pendingTab}
        >
          {sent === null ? null : (
            <div className="flex flex-col gap-3 p-4 text-sm">
              <DialogTitle className="text-base text-balance" data-review-title>
                Batch {sent.frozen.batch.number} is ready for your agent
              </DialogTitle>
              <DialogDescription data-review-copied={sent.copied}>
                {sent.copied
                  ? "The prompt is copied. Paste it into your agent."
                  : "Your browser blocked the clipboard. The prompt is selected below. Copy it and paste it into your agent."}
              </DialogDescription>
              <p className="text-xs opacity-80" data-review-summary-note>
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
              <div className="flex gap-1.5">
                <Button
                  className={uiControlClass}
                  data-review-copy
                  onClick={copyAgain}
                >
                  Copy the prompt
                </Button>
                <DialogClose className={uiControlClass} data-review-close>
                  Close
                </DialogClose>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
