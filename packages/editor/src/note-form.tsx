import { maxNoteLength } from "@axonometric/contracts";
import { Textarea } from "@axonometric/ui/components/textarea";
import { useState } from "react";

import { controlClass } from "./control-class.ts";
import { LabelledField } from "./labelled-field.tsx";

const always = () => true;

/**
 * A note's text box with a send button. `onSubmit` calls `done` with why the
 * note was refused, or nothing when it went through. The form clears itself on
 * success. The box keeps focus and the text while a send fails, so nothing
 * typed is lost.
 */
export function NoteForm({
  canSend = always,
  hideLabel = false,
  initial = "",
  label,
  limit = maxNoteLength,
  onCancel,
  onSubmit,
  placeholder = "Ask a question or ask for a change…",
  rows = 3,
  submit,
}: {
  /** Whether `text`, trimmed, may be sent. The button waits for it. */
  readonly canSend?: (text: string) => boolean;
  /**
   * Whether the label is left off the screen, because the section's own
   * heading already says it. The box keeps the label as its accessible name.
   */
  readonly hideLabel?: boolean;
  readonly initial?: string;
  /** What the box is for. It names the field to a screen reader. */
  readonly label: string;
  /** The most characters the box takes. */
  readonly limit?: number;
  readonly onCancel?: () => void;
  readonly onSubmit: (
    text: string,
    done: (failure: string | undefined) => void
  ) => void;
  /** What the empty box says. */
  readonly placeholder?: string;
  readonly rows?: number;
  readonly submit: string;
}) {
  const [text, setText] = useState(initial);
  const [failure, setFailure] = useState<string | undefined>();
  const [sending, setSending] = useState(false);

  const send = () => {
    setSending(true);
    onSubmit(text.trim(), (why) => {
      setSending(false);
      setFailure(why);

      if (why === undefined) {
        setText("");
      }
    });
  };

  return (
    <form
      className="flex flex-col gap-1.5"
      data-note-form
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <LabelledField
        className="gap-1.5"
        disabled={sending}
        failure={failure}
        failureProps={{ "data-note-failure": "" }}
        hideLabel={hideLabel}
        label={label}
        labelClassName="tracking-widest uppercase"
      >
        <Textarea
          autoComplete="off"
          data-note-text
          maxLength={limit}
          name="note"
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              send();
            }
          }}
          onValueChange={setText}
          placeholder={placeholder}
          rows={rows}
          value={text}
        />
      </LabelledField>
      <div className="flex gap-1.5">
        <button
          className={controlClass}
          data-note-send
          disabled={sending || text.trim() === "" || !canSend(text.trim())}
          type="submit"
        >
          {sending ? "Saving…" : submit}
        </button>
        {onCancel === undefined ? null : (
          <button className={controlClass} onClick={onCancel} type="button">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
