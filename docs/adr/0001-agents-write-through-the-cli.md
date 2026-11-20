# Agents write through the CLI, and page tools only read and move the view

A map page can offer an agent's browser tools through WebMCP, and those tools could include every edit the page makes. We decided the agent changes the map only through its files and the CLI, and page tools only read the map and move the engineer's view. Everything the page writes is the engineer's input, so an agent writing through the page would review its own proposals, step into the engineer's undo history, and pass for the engineer in the revision history. The agent's layout changes still need review, so `layout --propose` records them as pending layout changes marked as the agent's. They stay out of batches, and the engineer accepts or discards them.

## Considered options

- **ui-sdk's generic agent bridge on the page.** Rejected. Its snapshot lists controls rather than what is drawn and stops at 100 entries, and it can press any edit control that its `allow` callback doesn't block.
- **Agent layout changes through the page.** Rejected for the reasons above. The CLI keeps the map's lock and the file revision checks, and works without a browser.
- **Making meaning changes wait too.** Rejected. It would need a proposed `data.mjs` beside the real one, and it would turn the review loop around. The engineer follows meaning changes through git and the revision history.
