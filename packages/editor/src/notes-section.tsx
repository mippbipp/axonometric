import type { NoteTarget } from "@axonometric/contracts";
import { Array as Arr, Option, Result } from "effect";

import { ItemStatusLine } from "./item-status.tsx";
import { NoteForm } from "./note-form.tsx";
import { noteTargetKey } from "./note-target.ts";
import { entriesOfKind, useReview } from "./review-context.ts";

/**
 * The notes pinned to `target`, each with its status and verdict, and a form
 * that pins another. The target is a structure, a hop or an empty spot. Only
 * a page that can write has the section.
 */
export function NotesSection({ target }: { readonly target: NoteTarget }) {
  const review = useReview();

  if (review === null) {
    return null;
  }

  const here = noteTargetKey(target);

  const notes = Arr.filter(
    entriesOfKind(review.entries, "note"),
    ({ item }) => noteTargetKey(item.target) === here
  );

  return (
    <section data-notes-section className="flex flex-col gap-2">
      <h3 className="text-xs tracking-widest uppercase opacity-70">Notes</h3>
      {notes.length === 0 ? null : (
        <ul className="flex flex-col gap-2">
          {Arr.map(notes, ({ item, status }) => (
            <li
              key={item.id}
              data-panel-note={item.id}
              data-note-state={status.state}
              className="border-pending flex flex-col gap-1 border-l-2 pl-2 text-sm"
            >
              <span className="break-words">{item.text}</span>
              <ItemStatusLine status={status} />
            </li>
          ))}
        </ul>
      )}
      {review.canWrite ? (
        <NoteForm
          label="Pin a note"
          hideLabel
          submit="Pin note"
          onSubmit={(text, done) => {
            review.ops.add({ kind: "note", target, text }, (outcome) => {
              done(Option.getOrUndefined(Result.getFailure(outcome)));
            });
          }}
        />
      ) : null}
    </section>
  );
}
