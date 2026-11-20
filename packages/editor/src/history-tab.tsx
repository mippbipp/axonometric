import type { DifferenceLine } from "@axonometric/contracts";
import { Toggle } from "@axonometric/ui/components/toggle";
import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr } from "effect";

import { controlClass } from "./control-class.ts";
import { useHistory } from "./history-context.ts";
import { fullDate, relativeTime } from "./relative-time.ts";
import { useSelection } from "./selection-context.ts";

const itemsText = (count: number) =>
  `${count} ${count === 1 ? "item" : "items"}`;

/** Who made the accepted layout changes, such as "2 by you, 1 by the agent". */
const authorsText = ({
  agent,
  engineer,
}: {
  readonly agent: number;
  readonly engineer: number;
}) =>
  Arr.join(
    [
      ...(engineer === 0 ? [] : [`${engineer} by you`]),
      ...(agent === 0 ? [] : [`${agent} by the agent`]),
    ],
    ", "
  );

/**
 * One difference as text. When it names a structure, choosing it selects
 * that structure on the map, which shows its panel.
 */
function DifferenceItem({ line }: { readonly line: DifferenceLine }) {
  const { select } = useSelection();
  const { structureId } = line;

  return (
    <li data-difference={line.key}>
      {structureId === undefined ? (
        line.text
      ) : (
        <button
          className={cn(controlClass, "w-full text-left")}
          onClick={() => {
            select(structureId);
          }}
          type="button"
        >
          {line.text}
        </button>
      )}
    </li>
  );
}

function Differences({
  lines,
}: {
  readonly lines: ReadonlyArray<DifferenceLine>;
}) {
  return (
    <ul className="flex flex-col gap-1 text-xs">
      {Arr.map(lines, (line) => (
        <DifferenceItem key={line.key} line={line} />
      ))}
    </ul>
  );
}

/**
 * The History tab: every revision, newest first, with its number, message,
 * how long ago it was saved and how many items it decided. Choosing one
 * opens it on the map, read-only. With Compare on, it lists each difference
 * from the accepted map as text, and choosing one selects its structure.
 */
export function HistoryTab() {
  const history = useHistory();

  if (history === null) {
    return null;
  }

  const { differences, entries, failure, loading, open, opened } = history;

  return (
    <section className="flex flex-col gap-3" data-history-list>
      <p className="text-xs tracking-widest uppercase opacity-70">
        Revisions, newest first
      </p>
      {entries === null ? (
        <p className="text-sm opacity-80">Reading the history…</p>
      ) : Arr.isReadonlyArrayEmpty(entries) ? (
        <p className="text-sm opacity-80" data-history-empty>
          No revisions yet. Accepting pending layout changes saves the first.
        </p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {Arr.map(entries, ({ by, items, message, revision, savedAt }) => {
            const isOpen = opened === revision;

            return (
              <li key={revision}>
                <Toggle
                  aria-label={`Revision ${revision}: ${message}, ${itemsText(items)}`}
                  className="border-ink focus-visible:outline-ink bg-paper text-ink data-[pressed]:bg-ink data-[pressed]:text-paper hover:bg-paper hover:text-ink data-[pressed]:hover:bg-ink data-[pressed]:hover:text-paper flex h-auto w-full min-w-0 cursor-pointer flex-col items-stretch justify-start gap-0.5 rounded-none border px-2 py-1.5 text-left text-xs font-normal whitespace-normal transition-none focus-visible:outline-2 focus-visible:outline-offset-1"
                  data-revision={revision}
                  onPressedChange={() => {
                    open(revision);
                  }}
                  pressed={isOpen}
                >
                  <span className="flex gap-2">
                    <b className="font-medium">#{revision}</b>
                    <span className="min-w-0 break-words" data-revision-message>
                      {message}
                    </span>
                  </span>
                  <span className="flex gap-2 opacity-80">
                    <time dateTime={savedAt} title={fullDate(savedAt)}>
                      {relativeTime(savedAt)}
                    </time>
                    <span>·</span>
                    <span data-revision-items>{itemsText(items)}</span>
                    {by.engineer + by.agent === 0 ? null : (
                      <>
                        <span>·</span>
                        <span data-revision-authors>{authorsText(by)}</span>
                      </>
                    )}
                  </span>
                </Toggle>
              </li>
            );
          })}
        </ol>
      )}
      {loading ? (
        <output className="text-xs opacity-80" data-history-loading>
          Opening revision {opened}…
        </output>
      ) : null}
      {failure === null ? null : (
        <p className="text-refused text-xs" data-history-failure role="alert">
          {failure}
        </p>
      )}
      {differences === null ? null : (
        <div className="flex flex-col gap-2" data-difference-list>
          <p className="text-xs tracking-widest uppercase opacity-70">
            Differences from the accepted map
          </p>
          {Arr.isReadonlyArrayEmpty([
            ...differences.layout,
            ...differences.meaning,
            ...differences.routes,
          ]) ? (
            <p className="text-xs opacity-80">Nothing differs.</p>
          ) : (
            <Differences
              lines={[
                ...differences.layout,
                ...differences.meaning,
                ...differences.routes,
              ]}
            />
          )}
        </div>
      )}
    </section>
  );
}
