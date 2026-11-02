# Writing data.mjs

`data.mjs` is the map's meaning. It is an ES module with a default export, so you can use template strings for long text and constants for ids you repeat. Only you edit it. The CLI imports it and checks the result against a schema. A wrong or unknown field is an error that names the field and the fix, so run `build` early and read the errors.

`axonometric init <home>` writes a starter with a comment on each field. Positions and sizes don't go here (`x`, `y`, `w`, `d`, `h`, `gx`, `gy` are errors). They live in `layout.json`, and `build` fills them in.

Write text as plain text. The page doesn't render HTML.

## Top level

The default export has exactly these fields: `format`, `revision`, `overview`, `groups`, `structures`, `hops`, `flows` and `chapters`. Leave `format: 1` and `revision` alone.

## overview

`title` and `summary` are required. The summary is one paragraph a newcomer reads in 30 seconds. The rest is optional, and `SYSTEM.md` leaves out what you omit.

- `stats`: a list of `{ label, value }`. Both are text.
- `decisions`: a list of `{ topic, decision, adr }`. State the decision and why in one line. `adr` links the ADR with a path relative to `SYSTEM.md`, or a full URL. `SYSTEM.md` sits in the home folder's parent, so an ADR at `docs/adr/0003-runtime.md` is `../adr/0003-runtime.md` from `docs/pipeline/SYSTEM.md`. A link that doesn't resolve to a file is an error. A `#fragment` is fine.
- `platformProvides` and `weOwn`: what the platform or framework gives you, and what this system builds itself.
- `fileLayout`: an indented tree, one path per line.
- `costModel`: the cost assumptions as Markdown. State each price with its source and the date you fetched it.
- `deepDives`: a list of `{ title, summary, link }`. `link` is a path relative to `SYSTEM.md`, or a URL.

The "How it's built" page and the matching sections of `SYSTEM.md` are generated from these fields, so write each thing once. Don't repeat the summary in a chapter or a structure.

## groups

A list of `{ id, title }`. Each group gets a zone drawn around its structures. A group with no structures is a warning.

## structures

| Field | Meaning |
|---|---|
| `id` | Permanent. Hops, chapters and `layout.json` refer to it. |
| `code` | 1 to 3 capital letters, unique. Question ids are built from it. Shown on the box. |
| `name` | The structure's name, a noun. |
| `tag` | Optional. The short text on the name tag, in place of the name. |
| `shape` | How it is drawn. See `design`. |
| `group` | The id of one of the groups. |
| `status` | `live` runs today, `planned` is designed but not running, `off` exists and is switched off. |
| `oneLiner` | One sentence, shown in the tooltip. |
| `whatItDoes` | Plain words for a newcomer. |
| `howItsBuilt` | The files, tables and APIs behind it. |
| `steps` | Optional. The inside view's stages, as `{ name, detail }`. |
| `questions` | Optional. See Questions below. |
| `sources` | Optional. The files behind it, as `{ path, commit }`. |

A `sources` path runs from the root of the git repo that holds the home folder, with `/` between folders, such as `src/server.ts`. `commit` is optional, 7 to 64 hex digits: the commit the structure's text describes. With it, `check` warns when the file has changed since, so you know to reread it, update the text, and pin the source to the current commit (`git rev-parse --short HEAD`). Without it, `check` only needs the path to be a file git tracks at HEAD. A path that isn't, or a commit that isn't in the local history, is an error. Listing the same file twice is a warning. `check` skips the source checks when the home folder isn't in a git repo, and says so.

Give a structure `steps` when it does several things in order. The inside view walks them with one packet. Skip them for a plain box.

## hops

A list of `{ id, from, to, label, payload }`. `from` and `to` are structure ids. `label` is short. `payload` is any JSON value, an example of what the hop carries. The page shows it when someone clicks the packet, so make it look like a real message.

A request and its reply are two hops. They are drawn side by side, and each can play in its own chapter.

## flows

A list of `{ id, name, hops }`. `hops` is an ordered list of hop ids, at least one. A flow is one story told end to end, such as "A green week". The last chapter's flow picker replays flows in the order they list their hops.

## chapters

A list of `{ id, title, lede, story, reveals, plays }`. `reveals` lists structure ids. `plays` lists hop ids, in order, and is `[]` for none. Chapters refer to hops by id, so write each hop once. See `chapters` for how to split the system.

The lede is one sentence. The story is two or three sentences.

## Questions

Every question has an id of the form `Q-<code><n>`, such as `Q-G1`: the structure's code, then a number that starts at 1. The id is assigned once and never changes or gets reused, even after the question is resolved, so "Q-F1" means the same thing next week. For a new question, use the next number never used anywhere on the map, resolved questions included. `check` rejects a repeated id.

An open question is `{ id, state: "open", text }`. Write the text as one sentence.

A resolved question adds the answer:

```js
{
  id: "Q-G1",
  state: "resolved",
  text: "Should the gate also build the arm hosts?",
  answer: "Yes, on every PR. A red arm build blocks the merge.",
  answeredBy: "mippbipp",
  answeredOn: "2026-11-02",
}
```

`answeredOn` is a real date as `YYYY-MM-DD`. `answeredBy` is the engineer who answered.

Rules from earlier rounds:

- Record the engineer's own words in `answer`.
- If they say a question isn't a question, resolve it with that as the answer. Don't delete it, because its id stays taken.
- If they say they don't get a question, explain it with a concrete example before you resolve it.
- Ask only what the code and docs can't tell you. Take defaults for the rest and say which you took.
- The Questions tab lists every question revealed so far, open ones first.

## Typical errors

`build` and `check` print every error at once. These come up often:

- A reference to an id that doesn't exist: `group`, `from`, `to`, a flow's `hops`, a chapter's `reveals` or `plays`.
- A chapter plays a hop whose ends no chapter has revealed yet. Reveal them in that chapter or an earlier one, or move the hop to a later chapter.
- The last chapter leaves a structure unrevealed.
- A repeated id or code, or a `code` that isn't 1 to 3 capital letters.
- An empty string where a field is required. Optional fields are left out, not set to `""`.
- A question id that doesn't match `Q-<code><n>`.
- A `ghost` field. It was replaced by `status`.
