/**
 * The `data.mjs` that `init` writes. It builds with no errors or warnings,
 * and its comments say what each field is for, so it doubles as a short
 * guide to the format.
 */
export const starterData = `// The meaning of this map: what the system is made of and how it works.
// It holds no positions or sizes. Those live in layout.json, which
// \`axonometric build\` writes. Move a structure with \`axonometric layout\`.
//
// This is an ES module, so you can use template strings for long text and
// constants for ids you repeat.

export default {
  // The version of this file's format, and how many times it's been
  // accepted. Leave both alone.
  format: 1,
  revision: 0,

  // The "How it's built" page and the top of SYSTEM.md come from here.
  overview: {
    title: "Example system",
    summary:
      "One paragraph a newcomer can read in 30 seconds: what the system is for, and the path a request takes through it.",
  },

  // Each group gets a zone drawn around its structures.
  groups: [{ id: "service", title: "Service" }],

  // One box on the map per structure. The id is permanent. The code is a
  // few capital letters that question ids are built from, such as Q-A1.
  // shape is one of box, tall, store, cards, slab, screen, gate, job,
  // person, document and external. status is live, planned or off.
  structures: [
    {
      id: "api",
      code: "A",
      name: "API",
      shape: "gate",
      group: "service",
      status: "live",
      oneLiner: "Takes requests from clients and answers them.",
      whatItDoes: "Checks each request, does the work and replies.",
      howItsBuilt: "Name the files, framework and endpoints behind it.",
      // Questions keep their id forever, even after they're resolved.
      questions: [
        {
          id: "Q-A1",
          state: "open",
          text: "Replace this with something you'd like answered.",
        },
      ],
    },
    {
      id: "db",
      code: "D",
      name: "Database",
      shape: "store",
      group: "service",
      status: "live",
      oneLiner: "Keeps everything the API saves.",
      whatItDoes: "Stores records and answers queries.",
      howItsBuilt: "Name the database, its main tables and how it's backed up.",
    },
  ],

  // One arrow per hop, from one structure to another. The payload is an
  // example of what travels along it, and shows when you click a packet.
  hops: [
    {
      id: "h-save",
      from: "api",
      to: "db",
      label: "save record",
      payload: { id: 42 },
    },
  ],

  // A flow is a named, ordered list of hops, such as one request end to end.
  flows: [{ id: "f-request", name: "A request", hops: ["h-save"] }],

  // The walkthrough. Each chapter reveals some structures and plays some
  // hops. Structures stay revealed in later chapters, and by the last
  // chapter every structure must be revealed.
  chapters: [
    {
      id: "c-api",
      title: "The front door",
      lede: "Every request starts at the API.",
      story: "Say what a reader should notice in this chapter.",
      reveals: ["api"],
      plays: [],
    },
    {
      id: "c-all",
      title: "The whole system",
      lede: "The API saves what it's given to the database.",
      story: "The last chapter shows everything at once.",
      reveals: ["db"],
      plays: ["h-save"],
    },
  ],
};
`;
