# Media format variants — design

Date: 2026-09-28. Status: approved in chat, awaiting spec review.

## Goal

When a user adds a photo or a video, Blok converts it into every format the host lists.
The block renders them best-first, so each browser plays the most modern format it supports
and falls back to the most widely supported one.

## Decisions (made with the user)

1. Conversion runs **in the browser**. A host hook can replace it (server, ffmpeg, WASM).
2. It is **opt-in**. Nothing changes until the host lists formats. Not a breaking change.
3. Formats are set **separately for images and videos**, in one editor-level place.
4. Video: the **original is shown at once**; conversion runs in the **background**.
5. While a conversion runs, closing the page shows the **browser's leave-page dialog**.

## Scope split

Two implementation plans:

- **Part 1** — config, `variants` data shape, rendering everywhere, image conversion.
- **Part 2** — video background conversion, progress badge, leave-page guard.

Part 2 depends on Part 1's config, data shape and rendering.

## Config

```ts
new Blok({
  media: {
    formats: {
      image: ['avif', 'webp', 'jpeg'],   // ImageFormat[]
      video: ['av1', 'webm', 'mp4'],     // VideoFormat[]
    },
    convert?(file: File, formats: string[], ctx: MediaConvertContext):
      Promise<{ file: Blob; mimeType: string }[] | null>,
    maxTranscodeDuration?: number,       // seconds, default 600
  },
});
```

- `ImageFormat = 'avif' | 'webp' | 'jpeg' | 'png'`.
- `VideoFormat = 'av1' | 'webm' | 'mp4'`:
  - `'av1'` — WebM container, AV1 video, Opus audio.
  - `'webm'` — WebM container, VP9 video, Opus audio.
  - `'mp4'` — MP4 container, H.264 video, AAC audio.
- AVIF is not a video format: `<video>` cannot play it. The types make `video: ['avif']` a `tsc` error.
- Omitting a list turns conversion off for that kind.
- The order the host writes does not matter. Blok sorts by its own ranking.
- `convert` returns `null` to use the built-in converter (same convention as `compress.transform`).
  `ctx` carries `kind: 'image' | 'video'`, `onProgress(0..1)` and an `AbortSignal`.
- The existing `ImageConfig.compress` keeps working unchanged. When `media.formats.image` is set,
  it decides the output formats; `compress.quality`, `maxWidth` and `maxHeight` still apply.

New public types go in a hand-authored `types/configs/media.d.ts` (Published-types law: no `../src` refs).

## Saved data (additive)

`ImageData` and `VideoData` gain:

```ts
variants?: { url: string; mimeType: string }[];   // best format first
```

- Named `variants`, not `sources`: `ImageConfig.sources` / `VideoConfig.sources` already exist
  (the empty-state Upload/Link switch), and one word for two things would confuse hosts.

- `url` stays and always holds the most widely supported produced format.
  Every consumer that reads only `url` keeps working.
- All variants share the original's pixel size. `naturalWidth`, crop and resize stay valid.

## Ranking

Best first:

- Images: `avif` > `webp` > `jpeg` / `png`.
- Videos: `av1` > `webm` > `mp4`.

The fallback for an image with transparency is PNG, never JPEG. If the host lists `jpeg` but
not `png` and the image has alpha, the original stays as the final fallback.

## Quality

- Encoders use a high quality setting (images: `compress.quality`, default 0.92).
- Video uses copy-first: if the source codec already fits the target container
  (e.g. H.264 `.mp4` → `mp4`), it is remuxed with no re-encode — truly lossless.
- A variant counts only if **every input track survives**. If the browser cannot encode
  the audio and the converter drops it, that format has failed. A silent MP4 is never saved.
- Any format that fails is skipped silently.

## The original

- A file already uploaded stays uploaded. There is no delete hook.
- After conversion, `url` points to the most widely supported produced format.
- The original stays as the **last** source only when that universal format was not produced.
- If nothing is produced, the block keeps the original exactly as today.

## Uploads

- One `uploadByFile` call per variant, through the existing kind-routed uploader.
- `UploadContext` gains an optional `variant?: { mimeType: string; role: 'original' | 'variant' }`,
  so hosts can name and route the files. Additive.

## Images (Part 1)

- On drop, paste or pick, the block shows the existing "Converting…" state.
- Blok encodes every listed format, uploads each, then saves `variants` + `url` in one write.
- Image encoding reuses `compress.ts` (canvas, verify `blob.type` against the silent-PNG trap)
  and `avif-webcodecs.ts` for AVIF.
- SVG and animated GIF skip image conversion. An animated GIF still goes to video; when
  `media.formats.video` is set, that path produces the video list instead of one WebM (Part 2).

## Video (Part 2)

1. The original uploads first. The block plays it at once.
2. Blok converts one format at a time, most compatible first (`mp4`, then `webm`, then `av1`),
   so the universal fallback lands soonest.
3. Each finished file is uploaded and added to `variants`.
4. The block shows a small "Optimizing video… 40%" badge. Playback and editing stay enabled.

- Converter: [Mediabunny](https://mediabunny.dev) Conversion API (MPL-2.0, tree-shakable,
  successor to `webm-muxer` by the same author). Dynamically imported so hosts without
  `media.formats.video` pay nothing. It is bundled, so it goes in `devDependencies`
  (see `test/unit/build/bundle-outputs.test.ts`).
- Videos longer than `maxTranscodeDuration` (default 10 min) are not transcoded.
  A copy-only remux still runs.
- No WebCodecs, or nothing encodable: the original stays, nothing is shown.

## Leave-page guard

- While any conversion or variant upload runs, Blok adds a `beforeunload` handler that calls
  `preventDefault()`. It is removed when the queue empties or the editor is destroyed.
- The browser shows its own generic text; the page cannot set it (MDN).
- It is unreliable on mobile (MDN). There, the block still works with the original.

## Safety

- Background results are written through `writeDerived` / `transactWithoutCapture`
  (`src/tools/image/detached-upload.ts`): no undo step, redo kept.
- Before writing, Blok checks the block still exists (`findLiveBlock`) and still holds the
  same original `url` (`stillHolds`). Otherwise the result is dropped.
- Never mutate the tool's `_data` before `api.blocks.update` (setData diff law).
- Only the uploading client converts. Peers get `variants` through normal sync.
- Conversion is cancelled on editor destroy and block removal.

## Rendering

Every path that emits image or video HTML renders sources best-first:

- Editor: `<picture><source type srcset>…<img></picture>` and `<video><source src type>…</video>`.
- Everything that queries the `<img>` (probe-dimensions, reload attempts, crop editor)
  must survive the `<picture>` wrapper.
- `/view` renderer (`src/view/emitters.ts`) and its JSON schema (`document-schema.ts`,
  `additionalProperties: false`, so `variants` must be declared there).
- Markdown export keeps `![alt](url)`: Markdown cannot carry alternatives, and `url` is the
  most compatible file.
- Clipboard HTML is the holder's sanitized HTML. It must keep an `<img src=url>` / playable
  `<video src=url>`, even if the sanitizer strips `<picture>`/`<source>`.

## Open items to settle in planning (unverified)

- Whether Mediabunny runs in a Web Worker. Measure; fall back to main thread
  (WebCodecs encoding is off-thread either way).
- How conversion should behave when the editor turns read-only mid-run.
- Whether the C# server renderer emits image/video HTML and needs `variants`.
- Per-browser encoder coverage (AAC encode, AV1 encode): detect at runtime, never assume.

## Testing

- Unit: ranking, alpha-aware fallback, track-survival rule, config types (`tsc` rejects
  `video: ['avif']`), upload context `variant`, stale-block/replaced-url drop,
  `beforeunload` add/remove, every renderer emits sources in rank order.
- E2E: image drop produces `<picture>` with listed formats that the browser can encode;
  video drop plays original at once, then gains sources; leave-page guard active only while
  converting. Use photo-like fixtures, never noise (see image compression notes).
- Docs: docs site pages in both locales.
