import { maxNoteLength } from "@axonometric/contracts";
import { useId, useState } from "react";

import { controlClass } from "./control-class.ts";

/**
 * A note's text box with a send button. `onSubmit` calls `done` with why the
 * note was refused, or nothing when it went through. The form clears itself on
 * success. The box keeps focus and the text while a send fails, so nothing
 * typed is lost.
 */
export function NoteForm({
  label,
  initial = "",
  submit,
  onSubmit,
  onCancel,
}: {
  readonly label: string;
  readonly initial?: string;
  readonly submit: string;
  readonly onSubmit: (
    text: string,
    done: (failure: string | undefined) => void
  ) => void;
  readonly onCancel?: () => void;
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
      data-note-form
      className="flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <label
        htmlFor={id}
        className="text-xs tracking-widest uppercase opacity-70"
      >
        {label}
      </label>
      <textarea
        id={id}
        data-note-text
        name="note"
        rows={3}
        value={text}
        maxLength={maxNoteLength}
        autoComplete="off"
        placeholder="Ask a question or ask for a change…"
        disabled={sending}
        className="border-ink bg-paper text-ink focus-visible:outline-ink resize-y border px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-1"
        onChange={(event) => {
          setText(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            send();
          }
        }}
      />
      {failure === undefined ? null : (
        <p
          data-note-failure
          role="alert"
          className="border-refused border-l-2 pl-2 text-xs"
        >
          {failure}
        </p>
      )}
      <div className="flex gap-1.5">
        <button
          type="submit"
          data-note-send
          className={controlClass}
          disabled={sending || text.trim() === ""}
        >
          {sending ? "Saving…" : submit}
        </button>
        {onCancel === undefined ? null : (
          <button type="button" className={controlClass} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
