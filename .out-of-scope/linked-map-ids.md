# Branded ids and a linked-up map

Map ids stay plain strings. Code that follows an id keeps its lookups and the `undefined` cases that come with them. The map isn't turned into a linked-up structure after `check`, and ids aren't branded per kind.

## Why this is out of scope

The request was to stop code downstream of `check` from guarding against ids that point at nothing. Two ways were proposed: brand each kind of id (`StructureId`, `HopId` and so on) through `Schema.brand`, or build a value after `checkMap` whose hops hold their end structures and whose structures hold their group and placement.

Most of those guards don't deal with dangling ids. They deal with two states that are allowed:

- **A structure with no placement.** `build` places it, so `layout.structures[id]` can be missing while the map is valid. `placedStructures`, `zonesOf`, `routeHops`, the scene's boxes and the route-shifting code skip such structures on purpose.
- **A structure not revealed yet.** `routeRevealed` routes only the structures a chapter has revealed so far. Lookups by hop end in routing and in the scene miss for every hop whose ends aren't both revealed.

A linked-up map has to keep both cases. The guards would become matches on "placed or unplaced" and "revealed or not", so they move rather than disappear.

Dangling ids already stop at the boundary. `loadMap` fails with `MapInvalid` when `checkMap` reports any error, so `build`, `serve`, `export` and the page only receive maps whose ids resolve. The other way ids come in is changes sent from the page. The proposal code checks those against the live map, for example "No structure in data.mjs has the id ...", whatever the types say.

Branded ids wouldn't remove guards on their own. The repo turns on `noUncheckedIndexedAccess`, so a lookup in `Record<StructureId, Placement>` still returns `Placement | undefined`. A brand only stops one kind of id from being passed where another belongs. No bug of that kind appears in the history.

Each option would cost more than it saves:

- 25 test files build structures by hand, and more build hops and chapters. Each would need branded constructors or a decode step.
- Ids cross into the DOM as plain strings, for example the canvas's `structure:<id>` keys and the `data-*` attributes the page tests read. Each crossing would need a cast.
- `check` runs its layout and drawing checks even when references are broken, and it reports the reference errors with their file and path. A linked-up map would mean either dropping those warnings while references are broken, or building a partial map. Either one changes what agents see from `check`.

## What would reopen this

- A bug caused by passing one kind of id where another belongs. Branding that one kind would then be a small, targeted fix.
- The layout or drawing checks crashing, or giving misleading warnings, on a map whose references are broken.

## Prior requests

- #113: "Make dangling ids unrepresentable after check, so code downstream drops its undefined guards"
