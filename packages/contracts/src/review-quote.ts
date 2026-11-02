import { Array as Arr, pipe, Result, Schema, String as Str } from "effect";
import { dual } from "effect/Function";

import type { Verdict } from "./proposals.ts";

const encodeString = Schema.encodeResult(Schema.fromJsonString(Schema.String));

/**
 * `text` as a JSON string literal on one line. The quotes and escapes keep
 * whatever the engineer typed inside its own literal, so it can't pass for
 * a line of the prompt. The line separators JSON leaves bare are escaped
 * too.
 */
export const quoteText = (text: string): string =>
  pipe(
    Result.getOrElse(encodeString(text), () => '""'),
    Str.replaceAll("\u0085", String.raw`\u0085`),
    Str.replaceAll("\u2028", String.raw`\u2028`),
    Str.replaceAll("\u2029", String.raw`\u2029`)
  );

/** `text` on one line, cut to `limit` characters. */
export const oneLine: {
  (limit: number): (text: string) => string;
  (text: string, limit: number): string;
} = dual(2, (text: string, limit: number): string => {
  const flat = Arr.join(Str.split(/[\s\u0085]+/u)(Str.trim(text)), " ");

  return flat.length <= limit ? flat : `${Str.slice(0, limit - 1)(flat)}…`;
});

/**
 * `base` with the verdict's reason, and `changed: true` when the agent took
 * the item in another form. How a kind records an accepted item.
 */
export const decorate: {
  (
    verdict: Verdict
  ): <A extends object>(
    base: A
  ) => A & { readonly reason?: string; readonly changed?: true };
  <A extends object>(
    base: A,
    verdict: Verdict
  ): A & { readonly reason?: string; readonly changed?: true };
} = dual(
  2,
  <A extends object>(
    base: A,
    verdict: Verdict
  ): A & { readonly reason?: string; readonly changed?: true } => {
    const withReason =
      "reason" in verdict && verdict.reason !== undefined
        ? { ...base, reason: verdict.reason }
        : base;

    return verdict.verdict === "changed"
      ? { ...withReason, changed: true }
      : withReason;
  }
);
