import { Button } from "@axonometric/ui/components/button";
import { Toggle } from "@axonometric/ui/components/toggle";
import { Array as Arr } from "effect";

import { legendOrder, looks } from "./compare-looks.ts";
import type { CompareKind } from "./compare-looks.ts";
import { uiControlClass } from "./control-class.ts";
import { fullDate } from "./relative-time.ts";

/** What differs, as the banner counts it. */
export interface DifferenceCount {
  readonly layout: number;
  readonly meaning: number;
}

/** One swatch and word of the legend: the look's stroke and dash, drawn small. */
function LegendItem({ kind }: { readonly kind: CompareKind }) {
  const look = looks[kind];

  return (
    <li className="flex items-center gap-1.5" data-legend={kind}>
      <svg
        aria-hidden="true"
        className="shrink-0"
        height={10}
        viewBox="0 0 22 10"
        width={22}
      >
        <line
          className={look.stroke}
          strokeDasharray={look.dash}
          strokeWidth={2.4}
          x1={1}
          x2={21}
          y1={5}
          y2={5}
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
  canRestore,
  comparing,
  differences,
  message,
  onBack,
  onCompare,
  onRestore,
  revision,
  savedAt,
}: {
  readonly canRestore: boolean;
  readonly comparing: boolean;
  readonly differences: DifferenceCount;
  readonly message: string;
  readonly onBack: () => void;
  readonly onCompare: () => void;
  readonly onRestore: () => void;
  readonly revision: number;
  readonly savedAt: string;
}) {
  const none = differences.layout + differences.meaning === 0;

  return (
    <section
      aria-label={`Past revision ${revision}`}
      className="border-ink bg-paper text-ink pointer-events-auto flex max-w-full shrink-0 flex-col gap-1.5 border-2 px-3 py-2 text-xs"
      data-past-revision={revision}
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
        <Toggle
          className={uiControlClass}
          data-control="compare"
          onPressedChange={onCompare}
          pressed={comparing}
        >
          Compare with accepted
        </Toggle>
        <Button
          className={uiControlClass}
          data-control="restore"
          disabled={!canRestore}
          onClick={onRestore}
        >
          Restore
        </Button>
        <Button
          className={uiControlClass}
          data-control="back-to-current"
          onClick={onBack}
        >
          Back to current
        </Button>
      </div>
      {comparing ? (
        <div className="flex flex-col gap-1.5" data-compare-legend>
          <p data-compare-summary>
            {none
              ? "Nothing differs from the accepted map."
              : `Against the accepted map: ${differences.layout} layout ${differences.layout === 1 ? "difference" : "differences"}, ${differences.meaning} ${differences.meaning === 1 ? "difference" : "differences"} in what the map says. Pending changes aren't compared.`}
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
