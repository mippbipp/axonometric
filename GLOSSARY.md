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
Any edit to the map that isn't a layout change.

**Pending change**:
An edit that hasn't been accepted.
_Avoid_: draft, unsaved change

**Proposal**:
A pending meaning change, note, answer or text suggestion, recorded for the agent.
_Avoid_: change request

**Batch**:
The proposals frozen by one press of "Ready for review".
_Avoid_: review round

**Verdict**:
The agent's decision on one proposal: accepted, changed or rejected, with a reason.
_Avoid_: decision

**Revision**:
An accepted state of the map, saved in its history.
_Avoid_: version, commit
