import { clearOfText, toPoints } from "@axonometric/contracts";
import type { ScreenPoint, ScreenRect } from "@axonometric/contracts";
import { Array as Arr } from "effect";

/**
 * An editing outline drawn as separate lines that stay clear of every box in
 * `text`, so it has a gap where a name tag, chip, zone title or hop label
 * stands and never crosses a letter. Each line is a `<line>` carrying
 * `className` and `data-outline`, the id of what the outline marks.
 */
export function OutlineLines({
  id,
  points,
  text,
  closed,
  className,
  width,
  dash,
  mark,
}: {
  readonly id: string;
  readonly points: readonly ScreenPoint[];
  readonly text: readonly ScreenRect[];
  readonly closed: boolean;
  readonly className: string;
  readonly width: number;
  readonly dash: string | undefined;
  /** The `data-chapter-mark` or similar value the lines carry. */
  readonly mark: Readonly<Record<string, string>>;
}) {
  const pieces = clearOfText({ points, text, closed });

  return (
    <g data-outline={id} {...mark}>
      {Arr.map(pieces, ({ start, end }) => (
        <polyline
          key={toPoints([start, end])}
          points={toPoints([start, end])}
          fill="none"
          className={className}
          strokeWidth={width}
          strokeDasharray={dash}
          strokeLinecap="butt"
        />
      ))}
    </g>
  );
}
