import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr } from "effect";

import { looks, legendOrder } from "./compare-looks.ts";
import { controlClass } from "./control-class.ts";
import { fullDate } from "./relative-time.ts";

/** What differs, as the banner counts it. */
export interface DifferenceCount {
  readonly layout: number;
  readonly meaning: number;
}

/** One swatch and word of the legend: the look's stroke and dash, drawn small. */
function LegendItem({ kind }: { readonly kind: (typeof legendOrder)[number] }) {
  const look = looks[kind];

  return (
    <li data-legend={kind} className="flex items-center gap-1.5">
      <svg
        aria-hidden="true"
        width={22}
        height={10}
        viewBox="0 0 22 10"
        className="shrink-0"
      >
        <line
          x1={1}
          y1={5}
          x2={21}
          y2={5}
          className={look.stroke}
          strokeWidth={2.4}
          strokeDasharray={look.dash}
        />
      </svg>
      <span>{look.label}</span>
    </li>
  );
}

/**
 * The sign that the page shows a past revision, over the canvas where the
 * notices go, so it never resizes the map. It says which revision and when,
 * that editing is off, and offers Compare, Restore and Back to current. With
 * Compare on it adds the legend.
 */
export function RevisionBanner({
  revision,
  message,
  savedAt,
  comparing,
  onCompare,
  differences,
  canRestore,
  onRestore,
  onBack,
}: {
  readonly revision: number;
  readonly message: string;
  readonly savedAt: string;
  readonly comparing: boolean;
  readonly onCompare: () => void;
  readonly differences: DifferenceCount;
  readonly canRestore: boolean;
  readonly onRestore: () => void;
  readonly onBack: () => void;
}) {
  const none = differences.layout + differences.meaning === 0;

  return (
    <section
      data-past-revision={revision}
      aria-label={`Past revision ${revision}`}
      className="border-ink bg-paper text-ink pointer-events-auto flex max-w-full shrink-0 flex-col gap-1.5 border-2 px-3 py-2 text-xs"
    >
      <p>
        <b className="font-medium tracking-widest uppercase">
          Past revision {revision}
        </b>
        {" · saved "}
        <time dateTime={savedAt}>{fullDate(savedAt)}</time>
        {` · ${message}`}
      </p>
      <p className="opacity-80">
        You&apos;re looking at the map as it was. It&apos;s read-only, and
        editing is off.
      </p>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          data-control="compare"
          aria-pressed={comparing}
          className={cn(controlClass, comparing && "bg-ink text-paper")}
          onClick={onCompare}
        >
          Compare with current
        </button>
        <button
          type="button"
          data-control="restore"
          className={controlClass}
          disabled={!canRestore}
          onClick={onRestore}
        >
          Restore
        </button>
        <button
          type="button"
          data-control="back-to-current"
          className={controlClass}
          onClick={onBack}
        >
          Back to current
        </button>
      </div>
      {comparing ? (
        <div data-compare-legend className="flex flex-col gap-1.5">
          <p data-compare-summary>
            {none
              ? "Nothing differs from the current map."
              : `Against the current map: ${differences.layout} layout ${differences.layout === 1 ? "difference" : "differences"}, ${differences.meaning} ${differences.meaning === 1 ? "difference" : "differences"} in what the map says.`}
          </p>
          <ul
            aria-label="Compare legend"
            className="flex flex-wrap gap-x-4 gap-y-1"
          >
            {Arr.map(legendOrder, (kind) => (
              <LegendItem key={kind} kind={kind} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
