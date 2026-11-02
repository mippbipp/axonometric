import { Effect, Schema } from "effect";
import { dual } from "effect/Function";

// What the page does with an SVG file once `svgFileOf` has drawn it: turn it
// into a PNG and save it. The drawing itself is shared with the `export`
// command, in @axonometric/drawing.

/** An SVG file's text and its size in pixels. */
export interface SvgFile {
  readonly text: string;
  readonly width: number;
  readonly height: number;
}

/** An export couldn't be made, for a reason the engineer can read. */
export class ExportFailed extends Schema.TaggedError<
  ExportFailed,
  { readonly brand: unique symbol }
>()("ExportFailed", {
  reason: Schema.String,
}) {}

/**
 * Draws an SVG file to a canvas at `scale` and returns it as a PNG. The SVG
 * goes to the image as a `data:` URL, which doesn't taint the canvas the way
 * a `blob:` URL can on a page opened from disk.
 */
export const pngOf: {
  (scale: number): (svg: SvgFile) => Effect.Effect<Blob, ExportFailed>;
  (svg: SvgFile, scale: number): Effect.Effect<Blob, ExportFailed>;
} = dual(2, (svg: SvgFile, scale: number) =>
  Effect.gen(function* () {
    const image = new Image();

    image.width = svg.width;
    image.height = svg.height;
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.text)}`;

    yield* Effect.tryPromise({
      try: () => image.decode(),
      catch: () =>
        ExportFailed.make({ reason: "The browser couldn't draw the SVG." }),
    });

    const canvas = document.createElement("canvas");

    canvas.width = Math.round(svg.width * scale);
    canvas.height = Math.round(svg.height * scale);
    canvas
      .getContext("2d")
      ?.drawImage(image, 0, 0, canvas.width, canvas.height);

    return yield* Effect.callback<Blob, ExportFailed>((resume) => {
      canvas.toBlob((blob) => {
        resume(
          blob === null
            ? Effect.fail(
                ExportFailed.make({
                  reason: "The browser couldn't make a PNG of the map.",
                })
              )
            : Effect.succeed(blob)
        );
      }, "image/png");
    });
  })
);

/** How long a download link's object URL lives, so the save can start. */
const revokeAfterMs = 10_000;

/**
 * Saves `blob` as `name` through a download link, which works in the
 * read-only file opened from disk as well as the served page.
 */
export const download: {
  (name: string): (blob: Blob) => void;
  (blob: Blob, name: string): void;
} = dual(2, (blob: Blob, name: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking at once can cancel the save in some browsers.
  // oxlint-disable-next-line effecttsgo/global-timers -- the download link is plain DOM, outside any Effect runtime
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, revokeAfterMs);
});
