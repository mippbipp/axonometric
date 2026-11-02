import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr } from "effect";

import { useHistory } from "./history-context.ts";
import { fullDate, relativeTime } from "./relative-time.ts";

const itemsText = (count: number) =>
  `${count} ${count === 1 ? "item" : "items"}`;

/**
 * The History tab: every revision, newest first, with its number, message,
 * how long ago it was saved and how many items it decided. Choosing one
 * opens it on the map, read-only.
 */
export function HistoryTab() {
  const history = useHistory();

  if (history === null) {
    return null;
  }

  const { entries, opened, loading, failure, open } = history;

  return (
    <section data-history-list className="flex flex-col gap-3">
      <p className="text-xs tracking-widest uppercase opacity-70">
        Revisions, newest first
      </p>
      {entries === null ? (
        <p className="text-sm opacity-80">Reading the history…</p>
      ) : Arr.isReadonlyArrayEmpty(entries) ? (
        <p data-history-empty className="text-sm opacity-80">
          No revisions yet. Accepting pending layout changes saves the first.
        </p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {Arr.map(entries, ({ revision, message, savedAt, items }) => {
            const isOpen = opened === revision;

            return (
              <li key={revision}>
                <button
                  type="button"
                  data-revision={revision}
                  aria-pressed={isOpen}
                  aria-label={`Revision ${revision}: ${message}, ${itemsText(items)}`}
                  className={cn(
                    "border-ink focus-visible:outline-ink flex w-full cursor-pointer flex-col gap-0.5 border px-2 py-1.5 text-left text-xs focus-visible:outline-2 focus-visible:outline-offset-1",
                    isOpen ? "bg-ink text-paper" : "bg-paper text-ink"
                  )}
                  onClick={() => {
                    open(revision);
                  }}
                >
                  <span className="flex gap-2">
                    <b className="font-medium">#{revision}</b>
                    <span data-revision-message className="min-w-0 break-words">
                      {message}
                    </span>
                  </span>
                  <span className="flex gap-2 opacity-80">
                    <time dateTime={savedAt} title={fullDate(savedAt)}>
                      {relativeTime(savedAt)}
                    </time>
                    <span>·</span>
                    <span data-revision-items>{itemsText(items)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {loading ? (
        <output data-history-loading className="text-xs opacity-80">
          Opening revision {opened}…
        </output>
      ) : null}
      {failure === null ? null : (
        <p data-history-failure role="alert" className="text-refused text-xs">
          {failure}
        </p>
      )}
    </section>
  );
}
