// Uses every status and every optional field, so the SYSTEM.md test sees
// each section.
const structure = (fields) => ({ group: "loop", status: "live", ...fields });

export default {
  format: 1,
  revision: 3,
  overview: {
    title: "Review loop",
    summary: `The engineer pins a note on the page.
The agent reads it, decides, and the page shows the verdict.`,
    stats: [
      { label: "Structures", value: "6" },
      { label: "Runtime", value: "Node 24" },
    ],
    decisions: [
      {
        topic: "Server",
        decision: "Pages talk to one local server per map.",
        adr: "adr/0001-local-server.md",
      },
      {
        topic: "Harness",
        decision: "The prompt works in any agent harness.",
        adr: "https://example.com/adr/harness",
      },
      { topic: "Storage", decision: "Proposals live in proposals.json." },
    ],
    fileLayout: `map/
  data.mjs
  layout.json
  proposals.json`,
    platformProvides: "Node's file system and an HTTP server.",
    weOwn: "The proposal format and the review commands.",
    costModel: "One agent run per batch, about 20k tokens.",
    deepDives: [
      {
        title: "Clipboard access",
        summary: "Browsers block the clipboard outside a click.",
        link: "research/clipboard.md#findings",
      },
      { title: "Locking", summary: "A lock file with the holder's process ID." },
    ],
  },
  groups: [
    { id: "people", title: "People" },
    { id: "loop", title: "The loop" },
    { id: "outside", title: "Outside" },
  ],
  structures: [
    structure({
      id: "engineer",
      code: "E",
      name: "Engineer",
      shape: "person",
      group: "people",
      oneLiner: "Reads the map and pins notes on it.",
      whatItDoes: "Reviews the architecture with the agent.",
      howItsBuilt: "A person at a browser.",
    }),
    structure({
      id: "page",
      code: "P",
      name: "Map page",
      tag: "PAGE",
      shape: "screen",
      oneLiner: "Shows the map and records notes.",
      whatItDoes: "Draws the map and saves each note as a proposal.",
      howItsBuilt: "The editor app, built into one HTML file.",
      steps: [
        { name: "Pin", detail: "The engineer pins a note to a structure." },
        { name: "Save", detail: "The page posts the note to the server." },
      ],
      questions: [
        { id: "Q-P1", state: "open", text: "Should notes have a length limit?" },
        {
          id: "Q-P2",
          state: "resolved",
          text: "Does the page work without the server?",
          answer: "Yes, read-only.",
          answeredBy: "mippbipp",
          answeredOn: "2026-10-30",
        },
      ],
    }),
    structure({
      id: "server",
      code: "S",
      name: "Save server",
      shape: "tall",
      oneLiner: "Saves edits and pushes changes to pages.",
      whatItDoes: "Writes proposals.json and tells open pages what changed.",
      howItsBuilt: "An Effect HttpApi server on 127.0.0.1.",
      questions: [
        { id: "Q-S1", state: "open", text: "Which port does it try first?" },
      ],
    }),
    structure({
      id: "proposals",
      code: "PR",
      name: "Proposals",
      shape: "store",
      oneLiner: "Every pending change, by batch.",
      whatItDoes: "Holds notes and changes until the agent gives a verdict.",
      howItsBuilt: "proposals.json in the home folder.",
    }),
    structure({
      id: "pull-request",
      code: "D",
      name: "Pull request",
      shape: "document",
      status: "planned",
      oneLiner: "Carries accepted changes to review.",
      whatItDoes: "Shows the map's diff to teammates.",
      howItsBuilt: "Not built yet.",
    }),
    structure({
      id: "upstream",
      code: "U",
      name: "Upstream atlas",
      shape: "external",
      group: "outside",
      status: "off",
      oneLiner: "The system-atlas skill this replaces.",
      whatItDoes: "Nothing; it's no longer read.",
      howItsBuilt: "inkboard/system-atlas.",
    }),
  ],
  hops: [
    { id: "h-note", from: "engineer", to: "page", label: "pins a note" },
    {
      id: "h-save",
      from: "page",
      to: "server",
      label: "POST /proposals",
      payload: { kind: "note", target: "server" },
    },
    { id: "h-store", from: "server", to: "proposals", label: "write batch" },
    { id: "h-pr", from: "proposals", to: "pull-request", label: "accepted" },
  ],
  flows: [
    { id: "f-note", name: "A note", hops: ["h-note", "h-save", "h-store"] },
  ],
  chapters: [
    {
      id: "c-page",
      title: "The page",
      lede: "The engineer reads the map.",
      story: "Everything starts on the page.",
      reveals: ["engineer", "page"],
      plays: ["h-note"],
    },
    {
      id: "c-save",
      title: "Saving",
      lede: "Notes go to the server.",
      story: "The server keeps every note.",
      reveals: ["server", "proposals"],
      plays: ["h-note", "h-save", "h-store"],
    },
    {
      id: "c-all",
      title: "The whole loop",
      lede: "Everything at once.",
      story: "Pick a flow to replay.",
      reveals: ["pull-request", "upstream"],
      plays: [],
    },
  ],
};
