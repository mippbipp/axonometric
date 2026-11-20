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
  className,
  closed,
  dash,
  id,
  mark,
  points,
  text,
  width,
}: {
  readonly className: string;
  readonly closed: boolean;
  readonly dash: string | undefined;
  readonly id: string;
  /** The `data-chapter-mark` or similar value the lines carry. */
  readonly mark: Readonly<Record<string, string>>;
  readonly points: ReadonlyArray<ScreenPoint>;
  readonly text: ReadonlyArray<ScreenRect>;
  readonly width: number;
}) {
  const pieces = clearOfText({ closed, points, text });

  return (
    <g data-outline={id} {...mark}>
      {Arr.map(pieces, ({ end, start }) => (
        <polyline
          className={className}
          fill="none"
          key={toPoints([start, end])}
          points={toPoints([start, end])}
          strokeDasharray={dash}
          strokeLinecap="butt"
          strokeWidth={width}
        />
      ))}
    </g>
  );
}
