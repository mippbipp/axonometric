# The design language

The reference is a "codebase as interactive isometric diagram" picture: khaki paper, black hatched structures, a left index of structures, a right panel with what each does, moving dots that are data packets, an inside view of each structure's steps. The CLI draws all of it. You choose the shapes, names, wording and positions. This topic says how to choose them well.

## What the engineer sees

- **Iso view.** The walkthrough. A chapter rail numbers the chapters. Next and back move between them. Structures show a code chip on top and a name tag under the front corner. Packets carry each hop's payload.
- **Plan view.** The same layout seen from above, as boxes and right-angle arrows, for presenting the whole system. Both views use the same positions and routes.
- **Side index.** Every structure by group. Unrevealed ones are dimmed with their chapter number.
- **Side panel.** Tabs for Details, Questions, Flows, Pending and History. With nothing selected, Details shows the chapter's story. With a structure pinned, it shows the one-liner, with what it does and how it's built folded under it. A clicked packet shows its payload.
- **Keys.** `]` and `→` go to the next chapter, `[` and `←` go back, `v` switches view, `+` and `-` zoom, `0` fits. On a pinned structure, `→` goes inside and `←` comes out.
- **Light and dark themes.** Ink on khaki paper, and pale ink on dark olive.

## Shapes

Pick the shape for the structure's role, so the picture reads without the labels.

| Shape | Use it for |
|---|---|
| `box` | Anything with no better shape. |
| `tall` | The brain: the main service or model. A big block with a ridge. |
| `store` | Three stacked drums: memory, ledgers, databases, directories. |
| `cards` | A deck of thin slabs: a set of tools. |
| `slab` | A wide flat block: an existing backend. |
| `screen` | A thin slab with a screen: a web page, an app, a device. |
| `gate` | A box with a dark band: approval, confirmation, a build gate. |
| `job` | A box with a clock: a scheduled pass. |
| `person` | A standing figure: a user or a maintainer. |
| `document` | A page with a folded corner: a pull request, a report, a config file. |
| `external` | A box in a dashed ring: a source outside the system. |

Letters on boxes aren't enough on their own. Every structure also gets a readable name tag under it.

## Status

Each status has its own look, fixed by the CLI:

- `live` is drawn solid and hatched.
- `planned` is drawn dashed, with no hatching.
- `off` is drawn faint, with a power mark.

Use `planned` for structures in a "later" chapter, and `off` for something that exists and is switched off. Don't invent other words for them.

## Names and wording

Use the project's terms, in chat and in `data.mjs`. Each one has words to avoid.

- **map**, not atlas.
- **structure**, not component or node.
- **hop**, not edge, link or connection.
- **group** and its **zone**, not cluster, layer or plate.
- **chapter**, not step, scene or slide. A **step** is one stage inside a structure.
- **status** is `live`, `planned` or `off`. There is no ghost flag.
- **home folder**, not map folder or workspace.

If the user's repo has a `GLOSSARY.md`, read it and use its terms for the system's own nouns. The repo's glossary is theirs. Don't create one for the map.

For the text itself:

- Plain words from the user's side. "Confirm card", not "HITL prompt".
- A structure's `name` is a noun. `oneLiner` is one sentence. `whatItDoes` is for a newcomer who isn't an engineer. `howItsBuilt` names files, tables and APIs.
- `tag` is the text on the name tag. Short tags fit better, so keep a long name's tag to a few words. The tag text is widest in Iso view, and `check` warns when a name tag lands on a neighbouring box.
- The `code` is 1 to 3 capital letters. The chip fits on the top face, so make it a letter or two.
- Hop labels are short verbs or the thing carried. Payloads are real-looking JSON.
- A chapter lede is one sentence. A story is two or three, with one idea in it.
- A number carries its source and date.
- Text is plain. The page doesn't render HTML or Markdown in structure text.

## Layout

You don't write coordinates. `build` places each structure that has no position next to its group's zone, near the structures its hops connect to. Footprints and positions are on a half-unit grid, in grid units, and the default footprint is 2 by 2. A zone is its members' bounding box with padding, so keep groups together and zones apart.

Aim for a layout where the eye follows the flows left to right or top to bottom, with groups clustered. A hop should not need to pass under a box, so leave a gap of 2 units between structures, as `build` does.

Fix legibility with `axonometric layout` or by editing `layout.json`, then run `axonometric check` again. `check` reports:

- overlapping boxes
- name tags on boxes
- routes under boxes
- overlapping zones
- labels, arrowheads and chips drawn over other things
- routes that take a long way round
- route overrides that don't start and end on a footprint's edge

No text overlaps. A warning about text is a defect in the map, not a style note.

Iso heights follow the shape. You can't set them.

## Hops

Hops route themselves at right angles around boxes. Two hops between the same pair draw side by side, so a request and its reply never sit on top of each other. A hop that passes behind a taller box in the Iso view is drawn faintly over it. If the router can't find a clear route, `check` warns. Move the structures apart, or write a route override. See `process`.

## Exports

`axonometric export <home>` writes an SVG, PNG or Excalidraw file of the map. Pass `--view iso` or `--view plan`, `--chapter` by number or id, `--flow` to spotlight one flow in the last chapter, and `--background paper` or `white`. The default is the last chapter, which shows the whole map.
