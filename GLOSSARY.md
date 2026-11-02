# axonometric

Interactive architecture maps that an agent writes and an engineer walks through, presents and edits.

## Maps

**Map**:
The interactive picture of one system's architecture.
_Avoid_: atlas

**Home folder**:
The folder that holds one map's source files.
_Avoid_: map folder, workspace

**Structure**:
One component of the system, drawn as a box.
_Avoid_: component, node

**Shape**:
What a structure is drawn as, such as a box, a store, a person or an external source.
_Avoid_: type, kind

**Status**:
Whether a structure is live (runs today), planned (designed, not running) or off (exists, switched off).
_Avoid_: ghost

**Step**:
One stage of what happens inside a structure, shown in its inside view.
_Avoid_: phase

**Question**:
An open or resolved question about a structure, with an ID such as Q-G1 that never changes.
_Avoid_: open issue, TODO

**Source**:
A file behind a structure, named by its path from the git repo's root and optionally pinned to the commit the structure's text describes.
_Avoid_: source link, file reference

**Hop**:
One arrow from a structure to a structure, with a label and an example payload.
_Avoid_: edge, link, connection

**Route**:
The right-angle path a hop's arrow takes on the ground grid, from the edge of one footprint to the edge of the other. The router computes it from the layout, around other footprints when it can.
_Avoid_: path, wire, edge

**Bundle**:
Hops from one structure whose routes share a stretch, drawn as separate parallel lines with their own arrowheads.
_Avoid_: trunk, lane, group (a group is a set of structures)

**Route override**:
A route saved by hand in `layout.json` as a list of grid points, followed instead of the automatic route.
_Avoid_: manual route, waypoints

**Flow**:
A named, ordered list of hops.
_Avoid_: path, sequence

**Group**:
A named set of structures that belong together.
_Avoid_: cluster, layer

**Zone**:
The outline drawn around a group's structures.
_Avoid_: plate, container, frame

**Overview**:
The map's title, summary, stats, decisions and account of how the system is built.

**Decision**:
A settled design choice recorded in the overview, optionally linked to an ADR.
_Avoid_: verdict

**Deep dive**:
A research summary recorded in the overview, optionally linked to its document.
_Avoid_: research note

**Problem**:
Something wrong with a map: an error, which blocks building it, or a warning, which doesn't.
_Avoid_: issue, diagnostic

## Walkthrough and views

**Chapter**:
One stop in the walkthrough. It reveals some structures and plays some hops.
_Avoid_: step, scene, slide

**Packet**:
A dot that carries one hop's example payload along the hop while a chapter plays.
_Avoid_: dot, token, pulse

**Iso view**:
The isometric drawing of the map's layout.

**Plan view**:
The same layout drawn straight from above.
_Avoid_: 2D view, flat view

**Name tag**:
The label that names a structure on the map: its tag, or its name when it has no tag. In the Iso view it sits under the structure's front corner; in Plan view, inside the box or beside it.
_Avoid_: label, caption

**Code chip**:
The small box on top of a structure that shows its code, such as G.
_Avoid_: badge, icon

**Iso height**:
How tall a structure stands in the Iso view. Each shape has its own, and the map files don't set it.
_Avoid_: depth, z

**Inside view**:
One structure's steps in order, drawn in place of the map until you come out.
_Avoid_: drill-down, detail view

**Selection**:
The structure that's selected. Its panel is pinned in the side panel until the selection clears.
_Avoid_: focus, active structure

**Multi-selection**:
The set of structures that move, nudge, align and distribute together. It is separate from the selection, which pins one structure's panel, and it opens no panel.
_Avoid_: group selection, marquee

**Spotlight**:
The hops, and the structures at their ends, that the map draws at full strength while it fades the rest. It follows what the pointer is on or the keyboard has focused, else what's pinned, else what the chapter or the picked flow plays.
_Avoid_: focus, highlight

**Side index**:
The list of every structure by group, next to the view.
_Avoid_: sidebar, legend

**Open questions tab**:
The side panel tab that lists every question revealed so far, open ones first.
_Avoid_: issues list

## Editing and review

**Layout change**:
A move, resize or reroute.

**Meaning change**:
Any edit to the map that isn't a layout change. It is either a diagram change or a chapter change.

**Diagram change**:
A meaning change to the map itself: its structures, hops, flows, groups, text, questions or notes. The pending list, the prompt and `review` list diagram changes apart from chapter changes.
_Avoid_: map change

**Chapter change**:
A meaning change to one chapter of the walkthrough: which structures it reveals, which hops it plays, or in what order. It changes that chapter and not the diagram, and shows in the pending look in that chapter only.
_Avoid_: walkthrough change, chapter edit

**Pending change**:
An edit that hasn't been accepted.
_Avoid_: draft, unsaved change

**Proposal**:
A pending meaning change, note, text suggestion, answer or raised question, recorded for the agent. A chapter change is a chapter proposal, and every other kind is a diagram proposal.
_Avoid_: change request

**Note**:
Words the engineer pins to a structure, a hop or an empty spot, for the agent to read. It asks for something that isn't a direct edit.
_Avoid_: comment, annotation

**Text suggestion**:
A proposed new wording for one text of a structure: its one-liner, what it does, how it's built, or a step's name or detail. It records the original text beside the new text, and waits for the agent once it is in a batch.
_Avoid_: text edit, rewrite

**Answer**:
The engineer's reply to an open question, recorded with the day it was given. The agent records who answered when it folds the answer into the map.
_Avoid_: resolution, reply

**Raised question**:
A new question the engineer puts to a structure. It has no question ID until the agent accepts it and assigns one.
_Avoid_: new question, draft question

**Spot**:
An empty point on the half-unit grid, where a note can be pinned.
_Avoid_: position, pin

**Batch**:
The proposals frozen by one press of "Ready for review".
_Avoid_: review round

**Provisional id**:
The id the page gives a structure or group the engineer proposes. The agent either adds the structure to the map under it, or accepts it under another id with a changed verdict, and the page follows the final id.
_Avoid_: temporary id, draft id

**Proposed map**:
The accepted map with every open and frozen proposal applied, as the page draws it. The read-only file and exports never show it.
_Avoid_: preview, draft map

**Verdict**:
The agent's decision on one proposal: accepted, changed or rejected, with a reason.
_Avoid_: decision

**Revision**:
An accepted state of the map, saved in its history. Not to be confused with a file revision.
_Avoid_: version, commit

**File revision**:
The number in a map file that goes up by one each time the file is written. A write names the file revision it was based on, and is refused if the file has moved on.
_Avoid_: version, revision number
