# The visual check

`check` finds what a program can measure. It can't tell you whether the map reads well. Look at it before you report. Use whatever browser tool you have, such as a browser MCP server, a browser automation CLI or a screenshot tool.

## Open the map

Serve it, and open the URL.

```sh
axonometric serve <home>
axonometric status <home>
```

`serve` runs until Ctrl-C, so start it in the background. It prints the URL, and `status` prints it again. The default is `http://127.0.0.1:5178`, or the next free port. Use `--port 0` to take any free port. A second `serve` on the same home folder refuses and prints the first one's URL.

Or open the built file, `<system>.html` in the home folder's parent. Some in-app browsers show a `file://` page as a static snapshot with no scripts or fonts. If clicks do nothing, serve it instead.

Stop the server when you're done with it.

## Page tools

When your browser tool can call what a page registers through WebMCP, the check is faster and exact. The page's tools read what the engineer sees and move the view, and never change the map. `present` says how to check for them, what each one takes, and when they refuse.

- `read_view` lists every structure and hop the chapter shows, with its box on screen. Compare the boxes instead of reading pixels. A structure's box is its outline, which in Iso reaches up to its full height, so boxes can overlap with no text colliding. Overlapping boxes, or a hop box that doesn't reach the boxes of its `from` and `to`, tell you where to look in a screenshot.
- `go_to_chapter` with a number from 1 walks every chapter, and `set_view` with `plan` or `iso` switches the view. Each call shows the engineer a notice, so tell them before you start. Don't use these on a page the engineer has open and is working in. Open your own tab on the served URL, or ask first.
- `pin`, `go_inside` and `pick_flow` do what clicking does, so they cover most of steps 4 and 5 below. Then `read_view` shows `pinned`, `inside` and `spotlight`. They don't open a packet or show the panel's text, so click a packet in a browser as the last section says.

A box shows where something is, not whether it reads well. Keep looking at a screenshot of each chapter in both views. Without page tools, or without WebMCP in your browser, click and export as below.

## What to look at

Open the page at about 1280 by 800. Then:

1. Go to each chapter in turn, with the rail or `]`. Look at all of them, not a sample.
2. Switch to Plan view (the Iso and Plan buttons, or `v`) and go through every chapter again.
3. Switch the theme once and look at the last chapter.
4. Pin a structure by clicking it. The panel should say **Pinned** and offer to go inside if the structure has steps. Click a packet and read its payload.
5. In the last chapter, press each flow in the picker. Its hops should light up and the rest should fade.

In each chapter, check:

- Every structure that should be revealed is there, and nothing else is.
- No text overlaps another text, a box or a route. Name tags sit under their boxes.
- Every arrow starts and ends at the right structures, and none runs under a box.
- Zones are apart, with the right structures inside.
- The story and lede match what is on screen.
- Every label can be read at this zoom.

The last chapter draws every hop, so it is the most crowded view. If its routes or labels crowd each other, change the map. Cut the hops that add nothing the chapters didn't already show, such as a reply nobody needs, or move the structures apart (see below). Put each story in a flow, so the picker can fade the rest. A picked flow labels only its own hops, and its labels may sit over the faded routes, so far fewer of them are hidden. And check that earlier chapters stay small: a chapter that plays many hops is a reason to split it.

Zoom to fit (`0`) before you judge.

## Fix what you find

For overlaps and crowding, change the layout: `axonometric layout <home> <structure> --x ... --y ...`, or reroute a hop with `axonometric layout <home> --hop <hop> --route auto`. Never edit `layout.json` by hand. For wrong content, edit `data.mjs`. Then run `axonometric check <home>`, and look again. A running server updates the page, but the page you have open may hold an old state, so reload it.

## No browser

Export the views and look at the images instead.

```sh
axonometric export <home> --format png --view iso --chapter 3 --output out/iso-3.png
axonometric export <home> --format png --view plan --output out/plan-last.png
```

Without `--chapter`, `export` draws the last chapter. A chapter is a number from 1 or an id. `--background white` draws on white. Export every chapter in both views, and read each image.

If you can't see images either, say so in your report, and rely on `check`. Don't say you looked.

## The map must respond

A map can look perfect in a screenshot while nothing responds to a click. Always click one structure and one packet in a real browser when you have one. If the pinned panel doesn't open, tell the engineer.
