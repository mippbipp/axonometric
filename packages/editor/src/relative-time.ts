const units: readonly {
  readonly unit: Intl.RelativeTimeFormatUnit;
  readonly seconds: number;
}[] = [
  { unit: "day", seconds: 86_400 },
  { unit: "hour", seconds: 3600 },
  { unit: "minute", seconds: 60 },
];

/** How long ago a saved date was, such as "5 minutes ago" or "yesterday". */
export const relativeTime = (iso: string, now: Date = new Date()): string => {
  const then = new Date(iso);
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);

  if (Number.isNaN(seconds)) {
    return iso;
  }

  if (seconds < 45) {
    return "just now";
  }

  const days = seconds / 86_400;

  if (days >= 30) {
    return then.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  const unit =
    units.find(({ seconds: size }) => seconds >= size) ??
    ({ unit: "minute", seconds: 60 } as const);

  return format.format(-Math.round(seconds / unit.seconds), unit.unit);
};

/** The full date and time, for a tooltip and the revision banner. */
export const fullDate = (iso: string): string => {
  const date = new Date(iso);

  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
};
