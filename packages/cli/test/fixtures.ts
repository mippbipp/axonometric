import type { HomeFiles } from "./harness.ts";

/**
 * The smallest map worth drawing: two structures and one hop, in a home
 * folder at `pipeline/map/`. `data.mjs` uses a shared constant and a template
 * string, which only work because the CLI imports it as a module.
 */
export const minimalMap = {
  "pipeline/map/data.mjs": `const UPDATER = "updater";

export default {
  format: 1,
  revision: 0,
  structures: [
    { id: UPDATER, name: "Flake updater" },
    { id: "gate", name: \`Build \${"gate"}\` },
  ],
  hops: [
    {
      id: "h-update",
      from: UPDATER,
      to: "gate",
      label: "update → build",
      payload: { inputs: ["nixpkgs"] },
    },
  ],
};
`,
  "pipeline/map/layout.json": `${JSON.stringify(
    {
      format: 1,
      revision: 0,
      structures: {
        updater: { x: 0, y: 4, w: 2, d: 2 },
        gate: { x: 4, y: 0, w: 2, d: 1.5 },
      },
    },
    null,
    2
  )}\n`,
} satisfies HomeFiles;
