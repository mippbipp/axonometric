const UPDATER = "updater";

export default {
  format: 1,
  revision: 0,
  overview: {
    title: "Flake update pipeline",
    summary: "The updater bumps flake inputs and the Build gate checks them.",
  },
  groups: [{ id: "pipeline", title: "Pipeline" }],
  structures: [
    {
      id: UPDATER,
      code: "U",
      name: "Flake updater",
      shape: "job",
      group: "pipeline",
      status: "live",
      oneLiner: "Bumps the flake's inputs on a timer.",
      whatItDoes: "Runs nix flake update and pushes the result to a branch.",
      howItsBuilt: `A systemd timer runs ${"the updater"} script.`,
    },
    {
      id: "gate",
      code: "G",
      name: `Build ${"gate"}`,
      shape: "gate",
      group: "pipeline",
      status: "live",
      oneLiner: "Builds every host before an update merges.",
      whatItDoes: "Refuses an update that doesn't build.",
      howItsBuilt: "A GitHub Actions workflow that builds each host.",
    },
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
  flows: [],
  chapters: [],
};
