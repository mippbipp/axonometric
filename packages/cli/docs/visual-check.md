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

Zoom to fit (`0`) before you judge.

## Fix what you find

For overlaps and crowding, change the layout: `axonometric layout <home> <structure> --x ... --y ...`, or edit `layout.json`. For wrong content, edit `data.mjs`. Then run `axonometric check <home>`, and look again. A running server updates the page, but the page you have open may hold an old state, so reload it.

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
