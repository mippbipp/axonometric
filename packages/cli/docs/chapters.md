# The chapter recipe

A whole system at once reads as noise. "Hard to parse" was the first correction a real map got. Split the walkthrough into chapters that each reveal a few structures, so the engineer learns the system in a sensible order.

## The rules

1. Each chapter reveals at most three new structures.
2. Each chapter plays a small flow, and every hop it plays touches only revealed structures. `check` reports a hop with an unrevealed end as an error.
3. Reveals are cumulative. A structure revealed in chapter 2 stays on the map in chapter 3 and after. List only the new structures in `reveals`.
4. The last chapter shows the whole system. By its end every structure is revealed, and `check` reports one that never is. The last chapter has the flow picker, which replays any flow.

A chapter's `plays` lists hop ids, so a hop is written once in `hops` and named by id everywhere else. Put a hop in the chapter where its second end is revealed. List the hops in the order they should play.

A structure the chapters haven't reached yet stays in the side index, dimmed, with the number of the chapter that reveals it.

## Aim for about ten

Start from this arc and change the nouns. Keep its shape.

1. You and X: two structures and one hop each way.
2. Knowing: where the system keeps what it knows.
3. Doing: the parts that act, and the backend they call.
4. Asking first: any check, approval or gate.
5. Learning: the signals, hooks and logs.
6. Reflecting: the scheduled jobs.
7. Many voices: the extra actors or users.
8. Keeping it honest: evals and monitoring.
9. Later: the structures with status `planned`.
10. The whole system: the last chapter, with the flow picker.

A small system needs 4 to 6 chapters. The real map of a 15-structure update pipeline has 8: the timer, one branch and one PR, the build gate, scope and merge, when the gate is red, telling a person, the watchdog, and the whole pipeline.

## Writing a chapter

- `title` names the stop, such as "The Build gate".
- `lede` is one sentence.
- `story` is two or three sentences with one idea the reader should notice. Write it from the engineer's side.
- `reveals` has at most three new ids.
- `plays` lists the hops of one small flow.

The side panel shows the story, the new structures as chips and the hops the chapter plays. It starts with a summary, and each structure's detail unfolds on demand.

## The last chapter

Reveal whatever is still hidden. Play no hops, or a few. With no `plays`, the flow picker starts on "All flows". With `plays`, it offers "This chapter" first. Either way it lists each of the map's flows, so write flows that tell the story end to end. Give the last chapter's `story` the one-paragraph version of how the system behaves.

## Check it

```sh
axonometric check <home>
```

Done when `check` has no errors, and each chapter, read alone, adds something the reader can say in one sentence. If a chapter needs a long story, split it.

A chapter change from the engineer is the same thing as an edit to one chapter's `reveals` or `plays`. See `review`.
