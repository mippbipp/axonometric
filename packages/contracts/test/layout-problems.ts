import type { Layout, MapData, MapProblem } from "../src/index.ts";
import { drawingProblems } from "../src/index.ts";
import { layoutWideProblems } from "../src/layout-checks.ts";

/** Every problem with how the layout reads, drawing warnings included. */
export const layoutProblems = (
  data: MapData,
  layout: Layout
): ReadonlyArray<MapProblem> => [
  ...layoutWideProblems(data, layout),
  ...drawingProblems(data, layout),
];
