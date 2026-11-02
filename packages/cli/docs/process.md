# Building a map

Work through these steps in order. Each ends with the condition that says it is done.

## 1. Read the inputs

Read the code and docs the map is about, the repo's `GLOSSARY.md` and ADRs if it has them, and any design document the engineer names. Ask which prior art you may use. They may forbid a branch or a source.

If the system runs on a framework, hand the framework's long docs to a subagent with your specific design questions. Ask for a primer with its gotchas and a list of what it doesn't give you.

Boxes drawn before this step don't map to anything real. Done when you can name the real file, service or person behind each structure you plan, and say what you haven't read.

## 2. Discuss before drawing

Propose the structures and groups in chat, mapped to the system's real parts. Ask only what the repo can't tell you, as plain chat text. Take defaults for the rest and say which you took. If the system is small and the repo answers everything, state the plan and go on.

Done when the engineer has seen the structures and groups, and the defaults you took.

## 3. Pick the home folder

The home folder is `.scratch/<system>/map/`, or `docs/<system>/map/` in repos that commit design docs. `build` writes `SYSTEM.md` and `<system>.html` into the home folder's parent, so `.scratch/<system>/` or `docs/<system>/` holds the finished map.

If the repo's docs policy is unclear, ask the engineer which one applies before you create or commit anything. A `docs/` folder full of design docs points to `docs/`. A `.scratch/` line in `.gitignore` points to scratch. Some repos commit only ADRs and the glossary, and keep specs in the issue tracker. For those, use `.scratch/`, and attach `SYSTEM.md` to the spec issue when the spec is published. Committing a whole set of design files once produced a 3,900-line docs PR and four review rounds that reconciled three restatements of one design.

`.scratch/` has to be ignored by git. `init` warns when it isn't. Tell the engineer, or add `.scratch/` to the repo's `.gitignore` if they agree.

The home folder holds:

| File | Who edits it |
|---|---|
| `data.mjs` | Only you. The map's meaning. The page never writes it. See `data`. |
| `layout.json` | The `layout` command, the engineer's page, and you by hand for a reroute. |
| `proposals.json` | The page and `verdict`. Leave it alone. |
| `history/` | `commit`. One file per revision. Leave it alone. |
| `.axonometric/` | The server's URL, process ID and lock. Leave it alone. |

## 4. Write the first map: the whole system

```sh
axonometric init <home>
```

This writes a starter `data.mjs`. Replace its contents with the real system, following `data`, `chapters` and `design`. Write the whole system in the first pass, not a slice of it. Don't write positions. `build` places every structure that has none.

```sh
axonometric build <home>
```

`build` runs `check`, saves the positions it chose to `layout.json`, and writes `SYSTEM.md` and the page. Errors block it, and each one names the field and the fix. Fix every error in one pass, then build again. Write files with your file-editing tool, not shell heredocs.

Done when `build` succeeds.

## 5. Make it legible

No text overlaps. `check` reports overlapping boxes, name tags on boxes, routes under boxes and overlapping zones. It also reports labels, arrowheads and chips that land on other things, and routes that take a long way round.

```sh
axonometric check <home>
```

Fix each warning with `layout`, or by editing `layout.json`, then run `check` again.

```sh
axonometric layout <home> <structure> --x 14 --y 12
axonometric layout <home> <structure> --w 3 --d 2
```

Values land on half units. A field you leave out keeps its value. `layout` takes the map's lock, so it is safe while a server runs.

`layout` doesn't reroute hops. For a route the router gets wrong, edit `layout.json` and add an entry under `routes`, keyed by the hop's id. List grid points from the edge of one footprint to the edge of the other, with each point sharing `x` or `y` with the one before. Run `check` afterwards: it reports a route that doesn't start and end on a footprint's edge.

```json
"routes": { "h-save": [{ "x": 9, "y": 2 }, { "x": 9, "y": 5 }] }
```

Done when `check` prints 0 warnings, or you can say why each remaining warning is acceptable.

## 6. Look at it

Open the map and look at every chapter in both views. See `visual-check`. Done when each chapter reads cleanly in Iso and Plan view.

## 7. Report

Run `check` again immediately before you report, and report only a map with 0 errors.

```sh
axonometric check <home>
```

Tell the engineer where the files are and how to open the map (`axonometric serve <home>`, or the `<system>.html` file). Say what each chapter teaches, in a line. List the defaults you took. Then ask the 3 to 5 questions only the engineer can answer, not a generic list. Each one becomes a question in `data.mjs` with an ID. See `data`. Don't open issues unless asked.

## 8. Keep it current

`data.mjs` is the only place the map's meaning lives. `SYSTEM.md` and `<system>.html` are generated, and `build` overwrites them. After every change, edit `data.mjs`, then run `build` and `check`.

When the engineer answers a question or rejects an idea, record it, then sweep the whole map for the old wording: decisions, one-liners, chapter stories, deep dives, and the rebuilt `SYSTEM.md`. Grep the outputs for the old names. A banner on top of a stale section isn't enough, because the engineer reads everything. If the engineer says they don't get something, explain it with a concrete example before you resolve it.

## Let the engineer edit

```sh
axonometric serve <home>
```

`serve` runs in the foreground until Ctrl-C, so start it in the background. It prints the page's URL, and `axonometric status <home>` prints it again with the process ID. Pass `--port` to insist on one port (it fails if the port is busy), `--open` to open the engineer's browser, and `--allow-host <name>` behind a reverse proxy.

The server rebuilds and updates open pages whenever `data.mjs` or `layout.json` changes. If `data.mjs` fails validation, the page keeps the last good map and shows the error. Run `check` to see it. The engineer's proposals reach you through `review`.

## Deep dives feed back

When a question needs research, give subagents one shared brief: the interface you own, the requirements that separate the candidates, a usage model for cost, and a fixed deliverable shape. Synthesise their reports into one comparison with the same cost columns for every candidate. Record the result in `overview.deepDives`, and resolve the questions it answers with the date, such as "from the deep dive, 2026-11-02".

State every price with its source and the date you fetched it. Fetch prices live, because cached ones go stale.
