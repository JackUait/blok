# Media Format Variants — Part 2 (video) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a host sets `media.formats.video`, an uploaded video plays at once from the original, then converts in the background into each listed format (most compatible first), uploads each, and adds it to `data.variants`; closing the page mid-conversion asks "Leave site?".

**Architecture:** Three pure-ish units under `src/components/media-variants/`: `video-variants.ts` wraps Mediabunny's Conversion API for ONE format (null = skip); `media-queue.ts` runs jobs one at a time and owns the `beforeunload` guard; `video-background.ts` orders formats, uploads, and composes `{ url, variants }` after each success. The video tool wires them after a successful file upload and writes results as derived data (no undo step), without re-rendering the playing `<video>`.

**Tech Stack:** TypeScript, Mediabunny 1.60 (MPL-2.0, devDependency, dynamic import — bundled like `webm-muxer`), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-28-media-format-variants-design.md` (Part 1 plan: `2026-09-28-media-format-variants-part1.md`).

## Global Constraints

- Opt-in: without `media.formats.video` nothing changes for video uploads.
- Format mapping: `'av1'` → WebM + AV1 + Opus; `'webm'` → WebM + VP9 + Opus; `'mp4'` → MP4 + AVC + AAC.
- Convert one format at a time, most compatible first: `mp4`, `webm`, `av1`.
- Copy-first (Mediabunny default `copy: 'preferred'`): a codec that already fits is remuxed, not re-encoded. Transcodes use `QUALITY_HIGH`.
- A variant counts only if `conversion.isValid` AND `discardedTracks.length === 0` (a dropped audio track is a failure).
- Videos longer than `media.maxTranscodeDuration` (default 600 s) get `copy: { mode: 'forced' }` only.
- Invariant from Part 1: `url` is the LAST entry of `variants`. `video/mp4` is the universal video type; without it the original stays last and stays `url`.
- `<source type>` carries the full MIME with codecs, from `output.getMimeType()`.
- Results are derived data: `dispatchChange({ derived: true, from: ['url'] })`; detached blocks via `deliverToRebuiltBlock`.
- `beforeunload` handler is present only while a media job is queued or running.
- Mediabunny is a devDependency for types and tests only. It is NOT bundled (MPL-2.0 fails the build's license allow-list); hosts pass `media.mediabunny: () => import('mediabunny')` (user decision, 2026-09-28).
- Scoped lint/tests while iterating; no `let` (lint rule), no `!`, no `any`.

## Review Focus

1. **Browser without AAC/H.264 encoders** (Playwright Chromium, Firefox on Linux): MP4 fails, WebM succeeds — the original must stay as `url` and last variant. Pinned in Task 3.
2. **User deletes or replaces the video mid-conversion** — later results must not resurrect old variants on the new video. Pinned in Task 3/4 (isCurrent check with the expected url).
3. **Two videos uploaded at once** — conversions run one after another; the guard stays until both finish. Pinned in Task 2.
4. **Undo of the upload while converting** — the detached path must drop results whose `url` no longer holds. Pinned in Task 4 (via deliverToRebuiltBlock's startedFrom).
5. **Very long video** — only a copy remux is attempted; nothing re-encodes for minutes. Pinned in Task 1.

---

### Task 1: Mediabunny dependency and one-format conversion

**Files:** `package.json`, `yarn.lock` (via `yarn add -D mediabunny@1.60.0`); create `src/components/media-variants/video-variants.ts`; test `test/unit/components/media-variants/video-variants.test.ts`.

**Produces:** `produceVideoVariant(file: File, format: VideoFormat, opts: { maxTranscodeDuration: number; onProgress?: (fraction: number) => void; signal?: AbortSignal }): Promise<ConvertedMedia | null>` and `VIDEO_TARGETS`.

- [ ] Step 1: Test with `vi.mock('mediabunny', …)` fakes of `Input`, `BlobSource`, `Output`, `BufferTarget`, `Mp4OutputFormat`, `WebMOutputFormat`, `Conversion.init`, `ALL_FORMATS`, `QUALITY_HIGH`. Cases:
  - `'mp4'` inits with `video: { codec: 'avc', quality: QUALITY_HIGH }`, `audio: { codec: 'aac', quality: QUALITY_HIGH }`, an Mp4OutputFormat, no `copy` key; returns `{ file: Blob(type = getMimeType()), mimeType }`.
  - `'av1'` → WebM + `av1` + `opus`; `'webm'` → WebM + `vp9` + `opus`.
  - invalid conversion → null; a discarded audio track on a valid conversion → null; `execute` throws → null; empty buffer → null.
  - duration above the cap → `copy: { mode: 'forced' }` passed.
  - progress forwarded; an aborted signal calls `conversion.cancel()` and returns null; input disposed in every case.
- [ ] Step 2: run → FAIL (module missing).
- [ ] Step 3: `yarn add -D mediabunny@1.60.0`; implement with `await import('mediabunny')`.
- [ ] Step 4: run → PASS; run `test/unit/build/bundle-outputs.test.ts` (devDep rule).
- [ ] Step 5: commit `feat(media): convert a video into one format with Mediabunny`.

### Task 2: Serial media queue and leave-page guard

**Files:** create `src/components/media-variants/media-queue.ts`; test `test/unit/components/media-variants/media-queue.test.ts`.

**Produces:** `enqueueMediaJob<T>(job: () => Promise<T>): Promise<T>`, `hasPendingMediaJobs(): boolean`.

- [ ] Step 1: tests — jobs run one at a time in order; a rejecting job does not stop the next; while a job is pending a dispatched cancelable `beforeunload` is `defaultPrevented`; after all settle it is not; two queued jobs keep the guard until the second ends.
- [ ] Step 2: FAIL. Step 3: implement with a module-level `{ pending, tail }` state object. Step 4: PASS. Step 5: commit `feat(media): run media jobs one at a time and guard page leave`.

### Task 3: Background orchestration

**Files:** create `src/components/media-variants/video-background.ts`; test `test/unit/components/media-variants/video-background.test.ts`.

**Consumes:** `sortBestFirst`, `ConvertedMedia`, `MediaVariant`, `VideoFormat`.
**Produces:**
```ts
interface BackgroundVideoDeps {
  produce(format: VideoFormat, onProgress: (fraction: number) => void): Promise<ConvertedMedia | null>;
  upload(file: File, variant: { mimeType: string; role: 'variant' }): Promise<{ url: string }>;
  isCurrent(expectedUrl: string): boolean;
  write(next: { url: string; variants?: MediaVariant[] }): void;
  onProgress?(percent: number): void;
}
convertVideoInBackground(original: { file: File; url: string }, formats: readonly VideoFormat[], deps): Promise<void>
```
- [ ] Step 1: tests —
  - order is mp4, webm, av1 whatever the listed order; duplicates ignored;
  - mp4 made → after it `write({ url: mp4Url, variants: [mp4] ... })` then after webm `variants: [webm, mp4]`, url mp4 (original dropped);
  - mp4 NOT made, webm made → `url` stays the original, `variants: [webm, original]`;
  - nothing made → no write;
  - upload failure of one format → skipped, others continue;
  - `isCurrent(expected)` false before a format → stop, no more produce calls; expected url follows the last write;
  - progress across formats reaches 100.
- [ ] Step 2 FAIL, Step 3 implement, Step 4 PASS, Step 5 commit `feat(media): convert a video into every listed format in the background`.

### Task 4: Video tool wiring and progress badge

**Files:** modify `src/tools/video/uploader.ts` (add `uploadVariant(file, variant)`), `src/tools/video/index.ts`; tests in `test/unit/tools/video/uploader.test.ts`, `test/unit/tools/video/index.test.ts` (mock `video-variants`).

- [ ] Step 1: tests —
  - uploader `uploadVariant` sends `{ kind: 'video', tool: 'video', variant }` through `api.uploader` when configured, else tool `uploadByFile`, else a blob URL;
  - tool: with `api.config.media.formats.video = ['webm']`, after a file upload the original url is saved at once; once the mocked conversion resolves, `save()` has `variants` ending with the url; the `<video>` element is the same node (not re-rendered);
  - without formats, no conversion is attempted;
  - a new upload/link before conversion ends → the stale result is not written;
  - while converting, a `[data-blok-testid="video-converting"]` status shows "Converting… N%" (key `tools.image.converting`), removed when done;
  - a `convert` hook returning an array is used instead of the built-in converter.
- [ ] Step 2 FAIL, Step 3 implement, Step 4 PASS (+ whole `test/unit/tools/video`), Step 5 commit `feat(video): convert uploads into the configured formats in the background`.

### Task 5: End-to-end

**Files:** create `test/playwright/tests/tools/video-format-variants.spec.ts`, fixture `test/playwright/fixtures/video/clip.webm` (2 s, 320×240, VP9 + Opus).

- [ ] Tests (capability-agnostic): the original plays at once; eventually `variants` exists or conversion finished with nothing made; if it exists, `url` is its last entry and is either an mp4 or the original; the badge shows then disappears; a cancelable `beforeunload` is prevented while the badge shows. Run under the e2e lock, `--project=chromium-default`.
- [ ] Commit `test(e2e): videos gain their configured formats in the background`.

### Task 6: Docs and final gates

- [ ] Replace the "`formats.video` has no effect yet" sentence in `api-data.ts` + `en.json` + `ru.json` with the video behaviour (formats, background conversion, leave-page dialog, `maxTranscodeDuration`). Run docs prose + ru-coverage tests.
- [ ] tsc, scoped lint, related suites (media-variants, tools/video, tools/image, architecture, build, view), e2e; rebase, push to main.
