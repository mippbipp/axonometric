import { DateTime } from "effect";

/**
 * The engineer's day as YYYY-MM-DD, by the browser's own time zone. An answer
 * records the day the engineer gave it, and a late evening in Denver is not
 * tomorrow in UTC.
 */
export const today = (): string =>
  DateTime.formatIsoDate(
    DateTime.setZone(DateTime.nowUnsafe(), DateTime.zoneMakeLocal())
  );
