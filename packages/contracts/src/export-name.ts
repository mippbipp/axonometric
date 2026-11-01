import { String as Str } from "effect";

import type { View } from "./plan.ts";

/**
 * What names one export of a map's view and chapter: the system, the view
 * and the chapter's number from 1, such as `flake-pipeline-iso-chapter-3`.
 * A file adds its extension, and the SVG's ids add a dash after it.
 */
export const exportName = ({
  system,
  view,
  chapter,
}: {
  readonly system: string;
  readonly view: View;
  readonly chapter: number;
}) => `${Str.replaceAll(/[^\w-]/gu, "-")(system)}-${view}-chapter-${chapter}`;
