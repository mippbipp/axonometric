const UPDATER = "updater";

export default {
  format: 1,
  revision: 0,
  structures: [
    { id: UPDATER, name: "Flake updater" },
    { id: "gate", name: `Build ${"gate"}` },
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
