import { DateTime, Option } from "effect";

const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const units = [
  { unit: "day", seconds: 86_400 },
  { unit: "hour", seconds: 3600 },
  { unit: "minute", seconds: 60 },
] as const satisfies readonly {
  readonly unit: Intl.RelativeTimeFormatUnit;
  readonly seconds: number;
}[];

/** How long ago a saved date was, such as "5 minutes ago" or "yesterday". */
export const relativeTime = (iso: string): string => {
  const then = DateTime.make(iso);

  if (Option.isNone(then)) {
    return iso;
  }

  const seconds = Math.round(
    (DateTime.nowUnsafe().epochMilliseconds - then.value.epochMilliseconds) /
      1000
  );

  if (seconds < 45) {
    return "just now";
  }

  if (seconds / 86_400 >= 30) {
    return DateTime.formatLocal(then.value, { dateStyle: "medium" });
  }

  const [day, , minute] = units;

  const unit = units.find((each) => seconds >= each.seconds) ?? minute ?? day;

  return format.format(-Math.round(seconds / unit.seconds), unit.unit);
};

/** The full date and time, for a tooltip and the revision banner. */
export const fullDate = (iso: string): string =>
  Option.match(DateTime.make(iso), {
    onNone: () => iso,
    onSome: (date) =>
      DateTime.formatLocal(date, { dateStyle: "medium", timeStyle: "short" }),
  });
