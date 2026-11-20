import { maxNoteLength } from "@axonometric/contracts";
import { useId, useState } from "react";

import { controlClass } from "./control-class.ts";

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
  const id = useId();
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
      <label
        className={
          hideLabel ? "sr-only" : "text-xs tracking-widest uppercase opacity-70"
        }
        htmlFor={id}
      >
        {label}
      </label>
      <textarea
        autoComplete="off"
        className="border-ink bg-paper text-ink focus-visible:outline-ink resize-y border px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-1"
        data-note-text
        disabled={sending}
        id={id}
        maxLength={limit}
        name="note"
        onChange={(event) => {
          setText(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            send();
          }
        }}
        placeholder={placeholder}
        rows={rows}
        value={text}
      />
      {failure === undefined ? null : (
        <p
          className="border-refused border-l-2 pl-2 text-xs"
          data-note-failure
          role="alert"
        >
          {failure}
        </p>
      )}
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
