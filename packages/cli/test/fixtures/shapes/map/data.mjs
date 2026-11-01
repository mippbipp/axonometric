// One structure per shape, covering every status, so the browser tests and
// screenshots see each look.
const structure = (fields) => ({
  group: "core",
  status: "live",
  oneLiner: `The ${fields.shape} shape.`,
  whatItDoes: `Shows how a ${fields.shape} is drawn.`,
  howItsBuilt: "A fixture entry.",
  ...fields,
});

export default {
  format: 1,
  revision: 0,
  overview: {
    title: "Every shape",
    summary: "One structure of each shape, in every status.",
  },
  groups: [
    { id: "people", title: "People" },
    { id: "core", title: "Core" },
    { id: "outside", title: "Outside" },
  ],
  structures: [
    structure({ id: "person", code: "P", name: "Engineer", shape: "person", group: "people" }),
    structure({ id: "screen", code: "S", name: "Map page", shape: "screen", group: "people" }),
    structure({ id: "gate", code: "G", name: "Review gate", shape: "gate" }),
    structure({ id: "tall", code: "A", name: "Agent", shape: "tall" }),
    structure({ id: "box", code: "B", name: "Save server", shape: "box" }),
    structure({ id: "cards", code: "T", name: "Tools", shape: "cards", status: "planned" }),
    structure({ id: "job", code: "J", name: "Nightly job", shape: "job", status: "off" }),
    structure({ id: "store", code: "M", name: "Memory", shape: "store" }),
    structure({ id: "slab", code: "BE", name: "Backend", shape: "slab" }),
    structure({ id: "document", code: "D", name: "Pull request", shape: "document", status: "planned" }),
    structure({ id: "external", code: "U", name: "Upstream", shape: "external", group: "outside", status: "off" }),
  ],
  hops: [
    { id: "h-open", from: "person", to: "screen", label: "opens" },
    { id: "h-ask", from: "screen", to: "gate", label: "asks" },
    { id: "h-pass", from: "gate", to: "tall", label: "passes" },
    { id: "h-save", from: "tall", to: "box", label: "saves" },
    { id: "h-remember", from: "box", to: "store", label: "remembers" },
    { id: "h-pr", from: "store", to: "document", label: "proposes" },
  ],
  flows: [],
  chapters: [
    {
      id: "c-front",
      title: "The front",
      lede: "A person opens the page.",
      story: "Everything starts with the engineer.",
      reveals: ["person", "screen", "gate", "tall"],
      plays: ["h-open", "h-ask", "h-pass"],
    },
    {
      id: "c-all",
      title: "Everything",
      lede: "Every shape at once.",
      story: "The rest of the shapes.",
      reveals: ["box", "cards", "job", "store", "slab", "document", "external"],
      plays: ["h-save", "h-remember", "h-pr"],
    },
  ],
};
