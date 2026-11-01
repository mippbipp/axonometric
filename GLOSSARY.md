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

**Hop**:
One arrow from a structure to a structure, with a label and an example payload.
_Avoid_: edge, link, connection

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
The label under a structure's front corner in the iso view. It shows the structure's tag, or its name when it has no tag.
_Avoid_: label, caption

**Code chip**:
The small box on top of a structure that shows its code, such as G.
_Avoid_: badge, icon

**Iso height**:
How tall a structure stands in the iso view. Each shape has its own, and the map files don't set it.
_Avoid_: depth, z

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
