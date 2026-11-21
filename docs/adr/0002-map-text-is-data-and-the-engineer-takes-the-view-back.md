# Page tools treat map text as data, and the engineer takes the view back for good

Page tools (ADR 0001) return names, labels and ids the map's author wrote, so they can hold anything, including text that reads like an order to the agent. We decided every page tool's description says that text is data, never instructions, and every tool carries `untrustedContentHint`, rather than escaping or leaving out the text, because the agent needs the real names to talk about the map. On the page, the engineer outranks the agent. Any press, key or wheel clears the agent's notice and spotlight, and so does pointing at something, pinning, or changing the chapter or flow. The agent's spotlight does not come back when the engineer returns to where they were, because a spotlight that reappears after the engineer moved on looks like the agent took the view back.

## Considered options

- **Escape or strip map text in tool results.** Rejected. The agent would name structures differently from the page, and no escaping stops text from reading as an instruction.
- **Restore the agent's spotlight when the engineer's target goes back to what it was.** Rejected for the reason above. `present.md` tells the agent to call `read_view` and ask once the engineer takes over.
