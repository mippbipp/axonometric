// A map that forces routing around boxes: a hop with a structure in its
// way, a request and its reply between the same pair, and a vault walled in
// so tightly that the hop into it can't avoid a box.
const structure = (fields) => ({
  status: "live",
  oneLiner: "One line.",
  whatItDoes: "Does its job.",
  howItsBuilt: "Built simply.",
  ...fields,
});

const guard = (id, name) =>
  structure({ id, code: `G${name}`, name, tag: name, shape: "slab", group: "vault" });

export default {
  format: 1,
  revision: 0,
  overview: {
    title: "Crowded",
    summary: "Too many structures in too little room.",
  },
  groups: [
    { id: "edge", title: "Edge" },
    { id: "core", title: "Core" },
    { id: "vault", title: "Vault" },
  ],
  structures: [
    structure({
      id: "client",
      code: "C",
      name: "Client",
      shape: "person",
      group: "edge",
    }),
    structure({ id: "api", code: "A", name: "API", shape: "box", group: "core" }),
    structure({
      id: "cache",
      code: "CA",
      name: "Cache",
      shape: "tall",
      group: "core",
    }),
    structure({ id: "db", code: "D", name: "Database", tag: "DB", shape: "store", group: "core" }),
    structure({ id: "vault", code: "V", name: "Vault", tag: "V", shape: "box", group: "vault" }),
    guard("north", "N"),
    guard("east", "E"),
    guard("south", "S"),
    guard("west", "W"),
  ],
  hops: [
    { id: "h-request", from: "client", to: "api", label: "GET /orders" },
    { id: "h-reply", from: "api", to: "client", label: "200 orders" },
    { id: "h-query", from: "api", to: "db", label: "select orders" },
    { id: "h-warm", from: "db", to: "cache", label: "warm" },
    { id: "h-secret", from: "api", to: "vault", label: "read key" },
  ],
  flows: [
    {
      id: "f-order",
      name: "An order lookup",
      hops: ["h-request", "h-query", "h-reply"],
    },
  ],
  chapters: [
    {
      id: "c-edge",
      title: "The edge",
      lede: "A client calls the API.",
      story: "Requests come in from outside.",
      reveals: ["client", "api"],
      plays: ["h-request", "h-reply"],
    },
    {
      id: "c-all",
      title: "Everything",
      lede: "The whole crowd.",
      story: "Every structure, packed in.",
      reveals: ["cache", "db", "vault", "north", "east", "south", "west"],
      plays: ["h-request", "h-query", "h-reply"],
    },
  ],
};
