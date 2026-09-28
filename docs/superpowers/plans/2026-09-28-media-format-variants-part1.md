# Media Format Variants — Part 1 (config, data, rendering, images) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A host sets `media.formats.image`; every image a user uploads is encoded into each listed format the browser can produce, uploaded, saved as `variants`, and rendered best-first — in the editor, `/view`, and the video renderers (ready for Part 2).

**Architecture:** A new `src/components/media-variants/` module owns the ranking table, image variant encoding (reusing `compress.ts` / `avif-webcodecs.ts`), stored-data normalisation and the upload fan-out. The image `Uploader.handleFile` calls it when `api.config.media.formats.image` is set; otherwise nothing changes. Tools store `variants?: MediaVariant[]` next to `url` (which keeps the most compatible file). Renderers emit `<picture><source>…<img>` / `<video><source>…`.

**Tech Stack:** TypeScript, Vitest (jsdom), Playwright, OffscreenCanvas + WebCodecs (existing), hand-authored `types/*.d.ts`.

**Spec:** `docs/superpowers/specs/2026-09-28-media-format-variants-design.md`

## Global Constraints

- Opt-in: with no `media.formats.image`, upload behaviour and saved data are byte-for-byte unchanged.
- Additive only: no existing field, type or default changes. Not `BREAKING`.
- Data field is `variants` (never `sources` — `ImageConfig.sources` / `VideoConfig.sources` already exist).
- `variants` is ordered best-first; `url` always holds the most compatible produced file.
- Image rank: `image/avif` > `image/webp` > `image/jpeg` = `image/png`.
- An image with alpha never gets a JPEG variant; its universal fallback is PNG.
- The original is uploaded (role `'original'`) only when no universal format (`jpeg` / `png`) was produced; it is then the last variant and the `url`.
- Every variant keeps the original's pixel size, except when `compress.maxWidth` / `maxHeight` shrinks all of them equally.
- Every encode verifies `blob.type === requested` (silent-PNG trap).
- `convert` hook returning `null` (or throwing) = use the built-in converter.
- Published-types law: nothing under `types/` imports from `src/`.
- Comments: short, only for what silently breaks.
- Scope lint and tests to changed files while iterating (`yarn lint <files>`, `yarn test <files>`).

## Review Focus

1. **Replacing a converted image with a link or a new plain upload** — the old `variants` must be dropped, or the `<picture>` keeps showing the previous image. Pinned in Task 6.
2. **Stored data with a hostile or malformed `variants` entry** (`javascript:` URL, missing `mimeType`, non-array) — it is ignored, never rendered. Pinned in Tasks 3 and 8.
3. **A browser that encodes none of the listed formats** (Safari with `['avif','webp']`) — the upload still succeeds with the original and no `variants`. Pinned in Task 4.
4. **Copying a converted image to another app** — the clipboard HTML still carries a working `<img src=url>`. Pinned in Task 9.
5. **Reload-on-error for a `<picture>` image** — the retry path resets `img.src`; the image must still be the one shown. Pinned in Task 10 (e2e).

---

## File Structure

- Create `types/configs/media.d.ts` — `ImageFormat`, `VideoFormat`, `MediaVariant`, `ConvertedMedia`, `MediaConvertContext`, `MediaConfig`.
- Modify `types/configs/index.d.ts`, `types/configs/blok-config.d.ts`, `types/configs/uploader.d.ts`, `types/tools/image.d.ts`, `types/tools/video.d.ts`, `types/index.d.ts`.
- Create `src/components/media-variants/rank.ts` — MIME table + best-first sort.
- Create `src/components/media-variants/read-variants.ts` — normalise stored `variants`.
- Create `src/components/media-variants/image-variants.ts` — encode one bitmap into many formats.
- Create `src/components/media-variants/upload-variants.ts` — upload fan-out + original-fallback rule.
- Modify `src/tools/image/compress.ts` — export the encode helpers.
- Modify `src/components/modules/api/index.ts` — `api.config.media`.
- Modify `src/tools/image/uploader.ts`, `src/tools/image/index.ts`, `src/tools/image/ui.ts`.
- Modify `src/tools/video/index.ts`, `src/tools/video/ui.ts`.
- Modify `src/view/emitters.ts`, `src/view/document-schema.ts`.
- Tests under `test/unit/components/media-variants/`, existing tool/view test files, one new Playwright spec.
- Docs: `docs/src/components/api/api-data.ts`, `docs/src/components/tools/tools-data.ts`, `docs/src/i18n/en.json`, `docs/src/i18n/ru.json`.

---

### Task 1: Public types

**Files:**
- Create: `types/configs/media.d.ts`
- Modify: `types/configs/index.d.ts`, `types/configs/blok-config.d.ts` (next to `uploader?: BlokUploader;` ~line 690), `types/configs/uploader.d.ts` (`UploadContext`), `types/tools/image.d.ts` (`ImageData`), `types/tools/video.d.ts` (`VideoData`), `types/index.d.ts:245`
- Test: `test/unit/types/media-config-typecheck.ts`

**Interfaces:**
- Produces: `ImageFormat`, `VideoFormat`, `MediaVariant { url; mimeType }`, `ConvertedMedia { file: Blob; mimeType }`, `MediaConvertContext { kind; onProgress?; signal? }`, `MediaConfig { formats?; convert?; maxTranscodeDuration? }`, `BlokConfig.media`, `UploadContext.variant`, `ImageData.variants`, `VideoData.variants`, `API['config']` gains `media`.

- [ ] **Step 1: Write the failing type test**

```ts
// test/unit/types/media-config-typecheck.ts
/**
 * Type-level tests for `media` config. Not executed — it only needs to compile.
 * Run with: tsc --noEmit --strict test/unit/types/media-config-typecheck.ts
 */
import type { BlokConfig, API, UploadContext } from '../../../types';
import type { ImageData } from '../../../types/tools/image';
import type { VideoData } from '../../../types/tools/video';

const ok: BlokConfig['media'] = {
  formats: { image: ['avif', 'webp', 'jpeg'], video: ['av1', 'webm', 'mp4'] },
  convert: async (_file, _formats, ctx) => (ctx.kind === 'image' ? null : []),
  maxTranscodeDuration: 600,
};
void ok;

// AVIF is an image format; `<video>` cannot play it.
// @ts-expect-error — not a VideoFormat
const badVideo: BlokConfig['media'] = { formats: { video: ['avif'] } };
void badVideo;

// @ts-expect-error — not an ImageFormat
const badImage: BlokConfig['media'] = { formats: { image: ['mp4'] } };
void badImage;

const image: ImageData = { url: 'a.jpg', variants: [{ url: 'a.avif', mimeType: 'image/avif' }] };
const video: VideoData = { url: 'a.mp4', variants: [{ url: 'a.webm', mimeType: 'video/webm' }] };
void image; void video;

const ctx: UploadContext = { kind: 'image', variant: { mimeType: 'image/avif', role: 'variant' } };
void ctx;

declare const api: API;
const formats: readonly string[] | undefined = api.config.media?.formats?.image;
void formats;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsc --noEmit --strict --skipLibCheck test/unit/types/media-config-typecheck.ts`
Expected: FAIL — `Property 'media' does not exist`, `'variants' does not exist`, `'variant' does not exist`.

- [ ] **Step 3: Write the types**

```ts
// types/configs/media.d.ts
/** Image formats Blok can produce. */
export type ImageFormat = 'avif' | 'webp' | 'jpeg' | 'png';

/**
 * Video formats Blok can produce.
 * - `'av1'`: WebM, AV1 video, Opus audio.
 * - `'webm'`: WebM, VP9 video, Opus audio.
 * - `'mp4'`: MP4, H.264 video, AAC audio.
 */
export type VideoFormat = 'av1' | 'webm' | 'mp4';

/** One stored rendition of a media asset. */
export interface MediaVariant {
  /** Public URL of this rendition. */
  url: string;
  /** Full MIME type, e.g. `image/avif` or `video/webm; codecs="vp9, opus"`. */
  mimeType: string;
}

/** One file returned by a custom {@link MediaConfig.convert}. */
export interface ConvertedMedia {
  file: Blob;
  mimeType: string;
}

export interface MediaConvertContext {
  kind: 'image' | 'video';
  /** Progress from 0 to 1. */
  onProgress?(fraction: number): void;
  /** Aborted when the editor or the block goes away. */
  signal?: AbortSignal;
}

/**
 * Automatic conversion of uploaded photos and videos into several formats.
 * Off unless a `formats` list is set for that kind.
 */
export interface MediaConfig {
  /**
   * Formats to produce per kind. The order does not matter: Blok stores and
   * renders them best-first, and the most compatible one becomes `url`.
   */
  formats?: {
    image?: ImageFormat[];
    video?: VideoFormat[];
  };
  /**
   * Replace the built-in converter. Return `null` to use Blok's own.
   * @param file - the file the user picked
   * @param formats - the formats listed for `ctx.kind`
   * @param ctx - kind, progress and cancellation
   */
  convert?(file: File, formats: readonly string[], ctx: MediaConvertContext): Promise<ConvertedMedia[] | null>;
  /** Videos longer than this (seconds) are not re-encoded. Default 600. */
  maxTranscodeDuration?: number;
}
```

In `types/configs/index.d.ts` add `export * from './media';`.

In `types/configs/blok-config.d.ts`: add `import type { MediaConfig } from './media';` next to the uploader import, and after `uploader?: BlokUploader;`:

```ts
  /**
   * Convert uploaded photos and videos into several formats, rendered best-first.
   * Off unless `formats.image` or `formats.video` is set.
   */
  media?: MediaConfig;
```

In `types/configs/uploader.d.ts`, inside `UploadContext`:

```ts
  /**
   * Set when this upload is one of several renditions of the same asset.
   * `role: 'original'` is the untouched file the user picked.
   */
  variant?: { mimeType: string; role: 'original' | 'variant' };
```

In `types/tools/image.d.ts` add `import { MediaVariant } from '../configs/media';` and to `ImageData`:

```ts
  /** Other renditions, best format first. `url` is the most compatible one. */
  variants?: MediaVariant[];
```

Same field + import in `VideoData` (`types/tools/video.d.ts`).

In `types/index.d.ts:245` change the pick to `Readonly<Pick<BlokConfig, 'linkPaste' | 'link' | 'media'>>`.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx tsc --noEmit --strict --skipLibCheck test/unit/types/media-config-typecheck.ts`
Expected: no output, exit 0.
Also run: `yarn test test/unit/architecture/published-types-no-src-refs.test.ts test/unit/architecture/blok-class-api-parity-law.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add types/configs/media.d.ts types/configs/index.d.ts types/configs/blok-config.d.ts types/configs/uploader.d.ts types/tools/image.d.ts types/tools/video.d.ts types/index.d.ts test/unit/types/media-config-typecheck.ts
git commit -m "feat(media): public types for media format variants"
```

---

### Task 2: `api.config.media`

**Files:**
- Modify: `src/components/modules/api/index.ts` (the `config` object, ~line 40)
- Test: `test/unit/components/modules/api-config.test.ts`

**Interfaces:**
- Consumes: `BlokConfig.media` (Task 1).
- Produces: `api.config.media: MediaConfig | undefined`, read live (getter).

- [ ] **Step 1: Write the failing tests** (append inside `describe('API.config')`)

```ts
  it('exposes the media config slice', () => {
    const convert = async (): Promise<null> => null;
    const api = makeApi({ media: { formats: { image: ['avif', 'jpeg'] }, convert } });

    expect(api.methods.config.media?.formats?.image).toEqual(['avif', 'jpeg']);
    expect(api.methods.config.media?.convert).toBe(convert);
  });

  it('returns undefined media when unset', () => {
    const api = makeApi({});

    expect(api.methods.config.media).toBeUndefined();
  });
```

- [ ] **Step 2: Run to verify fail**

Run: `yarn test test/unit/components/modules/api-config.test.ts`
Expected: FAIL — `media` is `undefined` in the first test.

- [ ] **Step 3: Implement** — in the `config` object add:

```ts
        get media() {
          return apiConfig.media;
        },
```

- [ ] **Step 4: Run to verify pass** — same command, Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/modules/api/index.ts test/unit/components/modules/api-config.test.ts
git commit -m "feat(media): expose media config to tools via api.config"
```

---

### Task 3: Ranking and stored-data normalisation

**Files:**
- Create: `src/components/media-variants/rank.ts`, `src/components/media-variants/read-variants.ts`
- Test: `test/unit/components/media-variants/rank.test.ts`, `test/unit/components/media-variants/read-variants.test.ts`

**Interfaces:**
- Produces:
  - `IMAGE_FORMAT_MIME: Record<ImageFormat, string>`
  - `UNIVERSAL_IMAGE_MIMES: ReadonlySet<string>` = `{'image/jpeg','image/png'}`
  - `rankOf(mimeType: string): number` (lower = better; unknown = `Infinity`)
  - `sortBestFirst<T extends { mimeType: string }>(items: readonly T[]): T[]` (stable)
  - `readVariants(value: unknown): MediaVariant[] | undefined`

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/components/media-variants/rank.test.ts
import { describe, it, expect } from 'vitest';
import { rankOf, sortBestFirst, IMAGE_FORMAT_MIME } from '../../../../src/components/media-variants/rank';

describe('media variant ranking', () => {
  it('orders images AVIF, WebP, then JPEG and PNG', () => {
    const sorted = sortBestFirst([
      { mimeType: 'image/jpeg' },
      { mimeType: 'image/avif' },
      { mimeType: 'image/png' },
      { mimeType: 'image/webp' },
    ]).map((v) => v.mimeType);

    expect(sorted).toEqual(['image/avif', 'image/webp', 'image/jpeg', 'image/png']);
  });

  it('orders videos AV1, VP9, then H.264 and ignores codec parameters for the container', () => {
    const sorted = sortBestFirst([
      { mimeType: 'video/mp4; codecs="avc1.640028, mp4a.40.2"' },
      { mimeType: 'video/webm; codecs="vp9, opus"' },
      { mimeType: 'video/webm; codecs="av01.0.08M.08, opus"' },
    ]).map((v) => v.mimeType.split(';')[0] + (v.mimeType.includes('av01') ? '+av1' : ''));

    expect(sorted).toEqual(['video/webm+av1', 'video/webm', 'video/mp4']);
  });

  it('puts unknown types last', () => {
    expect(rankOf('image/heic')).toBe(Infinity);
    expect(sortBestFirst([{ mimeType: 'image/heic' }, { mimeType: 'image/jpeg' }])[0].mimeType).toBe('image/jpeg');
  });

  it('maps formats to MIME types', () => {
    expect(IMAGE_FORMAT_MIME).toEqual({ avif: 'image/avif', webp: 'image/webp', jpeg: 'image/jpeg', png: 'image/png' });
  });
});
```

```ts
// test/unit/components/media-variants/read-variants.test.ts
import { describe, it, expect } from 'vitest';
import { readVariants } from '../../../../src/components/media-variants/read-variants';

describe('readVariants', () => {
  it('keeps well-formed entries in stored order', () => {
    expect(readVariants([
      { url: 'https://x/a.avif', mimeType: 'image/avif' },
      { url: 'https://x/a.jpg', mimeType: 'image/jpeg' },
    ])).toEqual([
      { url: 'https://x/a.avif', mimeType: 'image/avif' },
      { url: 'https://x/a.jpg', mimeType: 'image/jpeg' },
    ]);
  });

  it('drops script URLs, empty URLs and entries without a MIME type', () => {
    expect(readVariants([
      { url: 'javascript:alert(1)', mimeType: 'image/avif' },
      { url: '', mimeType: 'image/webp' },
      { url: 'https://x/a.png' },
      { url: 'https://x/a.jpg', mimeType: 'image/jpeg', extra: 1 },
    ])).toEqual([{ url: 'https://x/a.jpg', mimeType: 'image/jpeg' }]);
  });

  it('returns undefined for non-arrays and for arrays with nothing usable', () => {
    expect(readVariants(undefined)).toBeUndefined();
    expect(readVariants('https://x/a.jpg')).toBeUndefined();
    expect(readVariants([{ url: 42, mimeType: 'image/jpeg' }])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `yarn test test/unit/components/media-variants/rank.test.ts test/unit/components/media-variants/read-variants.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```ts
// src/components/media-variants/rank.ts
import type { ImageFormat } from '../../../types/configs/media';

export const IMAGE_FORMAT_MIME: Record<ImageFormat, string> = {
  avif: 'image/avif',
  webp: 'image/webp',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

/** Formats every browser shows. One of these must end up as `url`. */
export const UNIVERSAL_IMAGE_MIMES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png']);

/**
 * Lower is better. WebM holds both AV1 and VP9, so the codec parameter decides.
 * @param mimeType - full MIME type, codec parameters allowed
 */
export const rankOf = (mimeType: string): number => {
  const [base] = mimeType.toLowerCase().split(';');
  const type = base.trim();

  switch (type) {
    case 'image/avif': return 0;
    case 'image/webp': return 1;
    case 'image/jpeg':
    case 'image/png': return 2;
    case 'video/webm': return /av01/i.test(mimeType) ? 0 : 1;
    case 'video/mp4': return 2;
    default: return Infinity;
  }
};

export const sortBestFirst = <T extends { mimeType: string }>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => rankOf(a.mimeType) - rankOf(b.mimeType));
```

```ts
// src/components/media-variants/read-variants.ts
import type { MediaVariant } from '../../../types/configs/media';
import { hasUnsafeUrlProtocol } from '../../shared/url-policy';

/**
 * Stored data is untrusted (hand-edited JSON, old versions), so only clean
 * `{ url, mimeType }` pairs reach a renderer.
 * @param value - `data.variants` as stored
 */
export const readVariants = (value: unknown): MediaVariant[] | undefined => {
  if (!Array.isArray(value)) return undefined;

  const clean = value.flatMap((entry: unknown): MediaVariant[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { url, mimeType } = entry as Record<string, unknown>;

    if (typeof url !== 'string' || url === '' || typeof mimeType !== 'string' || mimeType === '') return [];
    if (hasUnsafeUrlProtocol(url, 'src')) return [];

    return [{ url, mimeType }];
  });

  return clean.length > 0 ? clean : undefined;
};
```

- [ ] **Step 4: Run to verify pass** — same command, Expected: PASS. If `hasUnsafeUrlProtocol('javascript:…','src')` returns false, read `src/shared/url-policy.ts:27` and also reject `SCRIPT_CAPABLE_SCHEME_PATTERN.test(url)` explicitly.

- [ ] **Step 5: Commit**

```bash
git add src/components/media-variants/rank.ts src/components/media-variants/read-variants.ts test/unit/components/media-variants/
git commit -m "feat(media): variant ranking and stored-data normalisation"
```

---

### Task 4: Encode an image into every listed format

**Files:**
- Modify: `src/tools/image/compress.ts` — export `encodeCanvas`, `targetSize`-free helper, `decode`, `canDecode`, `toFile`
- Create: `src/components/media-variants/image-variants.ts`
- Test: `test/unit/components/media-variants/image-variants.test.ts`

**Interfaces:**
- Consumes: `IMAGE_FORMAT_MIME`, `sortBestFirst` (Task 3); from `compress.ts`: `encodeCanvas(bitmap, size, type, quality): Promise<Blob|null>`, `decode(file): Promise<ImageBitmap|null>`, `canDecode(): boolean`; `encodeAvifWithVideoEncoder(bitmap, size, quality)` from `avif-webcodecs.ts`.
- Produces: `produceImageVariants(file: File, formats: readonly ImageFormat[], opts: { quality: number; maxWidth?: number; maxHeight?: number }): Promise<ConvertedMedia[]>` — best-first, empty when nothing could be made. Never throws. `hasAlpha(bitmap: ImageBitmap): boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/components/media-variants/image-variants.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { avifMock } = vi.hoisted(() => ({ avifMock: vi.fn<() => Promise<Blob | null>>(async () => null) }));

vi.mock('../../../../src/tools/image/avif-webcodecs', () => ({ encodeAvifWithVideoEncoder: avifMock }));

import { produceImageVariants } from '../../../../src/components/media-variants/image-variants';

/** MIME types the fake canvas can encode. Anything else comes back as PNG. */
const encodable = new Set<string>();
/** Alpha value the fake canvas reports for every pixel. */
const state = { alpha: 255, width: 40, height: 30 };
const encodedSizes: Array<{ type: string; width: number; height: number }> = [];

const install = (): void => {
  (globalThis as Record<string, unknown>).createImageBitmap = vi.fn(async () => ({
    width: state.width, height: state.height, close: vi.fn(),
  }));

  class FakeOffscreenCanvas {
    constructor(public width: number, public height: number) {}
    getContext(): unknown {
      return {
        drawImage: vi.fn(),
        getImageData: (_x: number, _y: number, w: number, h: number) => {
          const data = new Uint8ClampedArray(w * h * 4).fill(255);

          for (let i = 3; i < data.length; i += 4) data[i] = state.alpha;

          return { data };
        },
      };
    }
    async convertToBlob({ type }: { type: string }): Promise<Blob> {
      encodedSizes.push({ type, width: this.width, height: this.height });

      return new Blob([new Uint8Array(4)], { type: encodable.has(type) ? type : 'image/png' });
    }
  }
  (globalThis as Record<string, unknown>).OffscreenCanvas = FakeOffscreenCanvas;
};

const photo = (type = 'image/jpeg'): File => new File([new Uint8Array(8)], 'photo.jpg', { type });

describe('produceImageVariants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    encodable.clear();
    encodedSizes.length = 0;
    state.alpha = 255;
    install();
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns every encodable listed format, best first, whatever the listed order', async () => {
    encodable.add('image/webp').add('image/jpeg');

    const out = await produceImageVariants(photo(), ['jpeg', 'webp'], { quality: 0.92 });

    expect(out.map((v) => v.mimeType)).toEqual(['image/webp', 'image/jpeg']);
    expect(out.every((v) => v.file.type === v.mimeType)).toBe(true);
  });

  it('skips a format the browser silently turns into PNG', async () => {
    encodable.add('image/jpeg');

    const out = await produceImageVariants(photo(), ['webp', 'jpeg'], { quality: 0.92 });

    expect(out.map((v) => v.mimeType)).toEqual(['image/jpeg']);
  });

  it('uses the WebCodecs AVIF encoder when the canvas cannot make AVIF', async () => {
    encodable.add('image/jpeg');
    avifMock.mockResolvedValueOnce(new Blob([new Uint8Array(2)], { type: 'image/avif' }));

    const out = await produceImageVariants(photo(), ['avif', 'jpeg'], { quality: 0.92 });

    expect(out.map((v) => v.mimeType)).toEqual(['image/avif', 'image/jpeg']);
  });

  it('never makes a JPEG of a transparent image', async () => {
    encodable.add('image/jpeg').add('image/png').add('image/webp');
    state.alpha = 0;

    const out = await produceImageVariants(photo('image/png'), ['webp', 'jpeg', 'png'], { quality: 0.92 });

    expect(out.map((v) => v.mimeType)).toEqual(['image/webp', 'image/png']);
  });

  it('keeps the original pixel size unless a cap is set', async () => {
    encodable.add('image/jpeg');

    await produceImageVariants(photo(), ['jpeg'], { quality: 0.92 });
    await produceImageVariants(photo(), ['jpeg'], { quality: 0.92, maxWidth: 20 });

    expect(encodedSizes.filter((e) => e.type === 'image/jpeg').map((e) => [e.width, e.height]))
      .toEqual([[40, 30], [20, 15]]);
  });

  it('returns nothing for SVG, GIF, or when the browser cannot decode', async () => {
    encodable.add('image/jpeg');

    expect(await produceImageVariants(photo('image/svg+xml'), ['jpeg'], { quality: 0.92 })).toEqual([]);
    expect(await produceImageVariants(photo('image/gif'), ['jpeg'], { quality: 0.92 })).toEqual([]);

    delete (globalThis as Record<string, unknown>).OffscreenCanvas;
    expect(await produceImageVariants(photo(), ['jpeg'], { quality: 0.92 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `yarn test test/unit/components/media-variants/image-variants.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

In `src/tools/image/compress.ts`, add `export` to `encodeCanvas`, `targetSize`, `canDecode`, `decode`. Change `targetSize`'s parameter type from `Resolved` to `{ maxWidth?: number; maxHeight?: number }` (it only reads those two). No behaviour change; run `yarn test test/unit/tools/image/compress.test.ts` to confirm it stays green.

```ts
// src/components/media-variants/image-variants.ts
import type { ConvertedMedia, ImageFormat } from '../../../types/configs/media';
import { canDecode, decode, encodeCanvas, targetSize } from '../../tools/image/compress';
import { encodeAvifWithVideoEncoder } from '../../tools/image/avif-webcodecs';
import { IMAGE_FORMAT_MIME, sortBestFirst } from './rank';

/** A canvas would flatten a vector or an animation. */
const SKIPPED_TYPES = new Set(['image/gif', 'image/svg+xml']);

export interface ImageVariantOptions {
  quality: number;
  maxWidth?: number;
  maxHeight?: number;
}

/**
 * Full-resolution scan: a downscaled check averages a tiny transparent area
 * back to 255 and would let a JPEG destroy it.
 * @param bitmap - decoded image
 */
export const hasAlpha = (bitmap: ImageBitmap): boolean => {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');

  if (!ctx) return true;
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);

  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }

  return false;
};

const encodeOne = async (
  bitmap: ImageBitmap,
  size: { width: number; height: number },
  mime: string,
  quality: number,
): Promise<Blob | null> => {
  try {
    return (await encodeCanvas(bitmap, size, mime, quality))
      ?? (mime === 'image/avif' ? await encodeAvifWithVideoEncoder(bitmap, size, quality) : null);
  } catch {
    return null;
  }
};

/**
 * Encode `file` into every listed format this browser can produce.
 * @returns best-first; empty when nothing could be made
 */
export const produceImageVariants = async (
  file: File,
  formats: readonly ImageFormat[],
  opts: ImageVariantOptions,
): Promise<ConvertedMedia[]> => {
  if (!file.type.startsWith('image/') || SKIPPED_TYPES.has(file.type) || !canDecode()) return [];

  const bitmap = await decode(file);

  if (!bitmap) return [];

  try {
    const size = targetSize(bitmap.width, bitmap.height, opts);
    const alpha = formats.includes('jpeg') && hasAlpha(bitmap);
    const mimes = [...new Set(formats)]
      .map((format) => IMAGE_FORMAT_MIME[format])
      .filter((mime) => !(alpha && mime === 'image/jpeg'));
    const made: ConvertedMedia[] = [];

    for (const mime of mimes) {
      const blob = await encodeOne(bitmap, size, mime, opts.quality);

      if (blob) made.push({ file: blob, mimeType: mime });
    }

    return sortBestFirst(made);
  } catch {
    return [];
  } finally {
    bitmap.close();
  }
};
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn test test/unit/components/media-variants/image-variants.test.ts test/unit/tools/image/compress.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/image/compress.ts src/components/media-variants/image-variants.ts test/unit/components/media-variants/image-variants.test.ts
git commit -m "feat(media): encode an image into every listed format"
```

---

### Task 5: Upload fan-out with the original-fallback rule

**Files:**
- Create: `src/components/media-variants/upload-variants.ts`
- Test: `test/unit/components/media-variants/upload-variants.test.ts`

**Interfaces:**
- Consumes: `ConvertedMedia`, `MediaVariant`, `UNIVERSAL_IMAGE_MIMES`, `sortBestFirst`.
- Produces:
  ```ts
  type VariantUpload = (file: File, variant: { mimeType: string; role: 'original' | 'variant' }, onProgress: (percent: number) => void) => Promise<{ url: string; fileName?: string }>;
  uploadImageVariants(original: File, produced: readonly ConvertedMedia[], upload: VariantUpload, onProgress?: (percent: number) => void): Promise<{ url: string; fileName?: string; variants?: MediaVariant[] }>
  ```
  `url`/`fileName` = the LAST (most compatible) uploaded entry. `variants` includes that entry too (the full best-first list), and is `undefined` when only one file was uploaded — a single rendition is just `url`. File names: original base name + format extension (`photo.avif`).

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/components/media-variants/upload-variants.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { uploadImageVariants } from '../../../../src/components/media-variants/upload-variants';

const blob = (type: string): Blob => new Blob([new Uint8Array(3)], { type });
const original = new File([new Uint8Array(9)], 'photo.PNG', { type: 'image/png' });

const recorder = () => {
  const calls: Array<{ name: string; type: string; role: string }> = [];
  const upload = vi.fn(async (file: File, variant: { mimeType: string; role: 'original' | 'variant' }) => {
    calls.push({ name: file.name, type: file.type, role: variant.role });

    return { url: `https://cdn/${file.name}`, fileName: file.name };
  });

  return { calls, upload };
};

describe('uploadImageVariants', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uploads each variant and makes the most compatible one the url', async () => {
    const { calls, upload } = recorder();

    const out = await uploadImageVariants(original, [
      { file: blob('image/avif'), mimeType: 'image/avif' },
      { file: blob('image/png'), mimeType: 'image/png' },
    ], upload);

    expect(out.url).toBe('https://cdn/photo.png');
    expect(out.variants).toEqual([
      { url: 'https://cdn/photo.avif', mimeType: 'image/avif' },
      { url: 'https://cdn/photo.png', mimeType: 'image/png' },
    ]);
    expect(calls.map((c) => c.role)).toEqual(['variant', 'variant']);
  });

  it('adds the original last when no universal format was produced', async () => {
    const { calls, upload } = recorder();

    const out = await uploadImageVariants(original, [
      { file: blob('image/webp'), mimeType: 'image/webp' },
    ], upload);

    expect(out.url).toBe('https://cdn/photo.PNG');
    expect(out.variants.map((v) => v.mimeType)).toEqual(['image/webp', 'image/png']);
    expect(calls.at(-1)).toMatchObject({ name: 'photo.PNG', role: 'original' });
  });

  it('uploads only the original when nothing was produced', async () => {
    const { calls, upload } = recorder();

    const out = await uploadImageVariants(original, [], upload);

    expect(out.url).toBe('https://cdn/photo.PNG');
    expect(out.variants).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it('reports overall progress across all uploads', async () => {
    const seen: number[] = [];
    const upload = vi.fn(async (_f: File, _v: unknown, onProgress: (p: number) => void) => {
      onProgress(100);

      return { url: 'u' };
    });

    await uploadImageVariants(original, [
      { file: blob('image/avif'), mimeType: 'image/avif' },
      { file: blob('image/jpeg'), mimeType: 'image/jpeg' },
    ], upload, (p) => seen.push(p));

    expect(seen).toEqual([50, 100]);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `yarn test test/unit/components/media-variants/upload-variants.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/components/media-variants/upload-variants.ts
import type { ConvertedMedia, MediaVariant } from '../../../types/configs/media';
import { UNIVERSAL_IMAGE_MIMES, sortBestFirst } from './rank';

export type VariantRole = 'original' | 'variant';

export type VariantUpload = (
  file: File,
  variant: { mimeType: string; role: VariantRole },
  onProgress: (percent: number) => void,
) => Promise<{ url: string; fileName?: string }>;

const EXTENSION: Record<string, string> = {
  'image/avif': 'avif',
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

const nameFor = (original: string, mime: string): string => {
  const dot = original.lastIndexOf('.');
  const base = dot > 0 ? original.slice(0, dot) : original;

  return `${base}.${EXTENSION[mime] ?? 'bin'}`;
};

/**
 * Upload every rendition, best first. The last one uploaded is the most
 * compatible and becomes `url`.
 */
export const uploadImageVariants = async (
  original: File,
  produced: readonly ConvertedMedia[],
  upload: VariantUpload,
  onProgress?: (percent: number) => void,
): Promise<{ url: string; fileName?: string; variants?: MediaVariant[] }> => {
  const jobs: Array<{ file: File; mimeType: string; role: VariantRole }> = sortBestFirst(produced).map((item) => ({
    file: new File([item.file], nameFor(original.name, item.mimeType), { type: item.mimeType }),
    mimeType: item.mimeType,
    role: 'variant',
  }));

  if (!jobs.some((job) => UNIVERSAL_IMAGE_MIMES.has(job.mimeType))) {
    jobs.push({ file: original, mimeType: original.type, role: 'original' });
  }

  const variants: MediaVariant[] = [];
  let last: { url: string; fileName?: string } = { url: '' };

  for (const [index, job] of jobs.entries()) {
    last = await upload(job.file, { mimeType: job.mimeType, role: job.role }, (percent) =>
      onProgress?.(Math.round(((index + percent / 100) / jobs.length) * 100)));
    variants.push({ url: last.url, mimeType: job.mimeType });
  }

  return { url: last.url, fileName: last.fileName, variants: variants.length > 1 ? variants : undefined };
};
```

- [ ] **Step 4: Run to verify pass** — same command, Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/media-variants/upload-variants.ts test/unit/components/media-variants/upload-variants.test.ts
git commit -m "feat(media): upload image renditions with an original fallback"
```

---

### Task 6: Image uploader + image tool store and clear `variants`

**Files:**
- Modify: `src/tools/image/uploader.ts` (constructor, `handleFile`, `UploadResult`), `src/tools/image/index.ts` (constructor ~103, `save` ~131, `resultDelta` ~537, `showResult` ~545, `writeEnteredUrl` ~383)
- Test: `test/unit/tools/image/uploader.test.ts`, `test/unit/tools/image/index.test.ts`

**Interfaces:**
- Consumes: `produceImageVariants` (Task 4), `uploadImageVariants` (Task 5), `readVariants` (Task 3), `api.config.media` (Task 2).
- Produces: `UploadResult.variants?: MediaVariant[]`; `new Uploader(config, assets, media?: () => MediaConfig | undefined)` — a getter so a runtime config change is read per upload.

- [ ] **Step 1: Write the failing uploader tests** (new `describe` in `uploader.test.ts`; add `vi.mock` of `produceImageVariants` at the top next to the existing `compress` mock)

```ts
vi.mock('../../../../src/components/media-variants/image-variants', () => ({
  produceImageVariants: vi.fn(async () => []),
}));
import { produceImageVariants } from '../../../../src/components/media-variants/image-variants';
const produceMock = vi.mocked(produceImageVariants);

  describe('handleFile with media formats', () => {
    const photo = (): File => new File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });

    it('uploads every rendition and returns them as variants', async () => {
      produceMock.mockResolvedValueOnce([
        { file: new Blob(['a'], { type: 'image/avif' }), mimeType: 'image/avif' },
        { file: new Blob(['j'], { type: 'image/jpeg' }), mimeType: 'image/jpeg' },
      ]);
      const uploadByFile = vi.fn(async (file: File) => ({ url: `https://cdn/${file.name}` }));
      const uploader = new Uploader({ uploader: { uploadByFile } }, undefined, () => ({ formats: { image: ['avif', 'jpeg'] } }));

      const result = await uploader.handleFile(photo());

      expect(result.url).toBe('https://cdn/photo.jpg');
      expect(result.variants?.map((v) => v.mimeType)).toEqual(['image/avif', 'image/jpeg']);
      expect(compressImageMock).not.toHaveBeenCalled();
    });

    it('passes the variant to the editor-level uploader context', async () => {
      produceMock.mockResolvedValueOnce([{ file: new Blob(['j'], { type: 'image/jpeg' }), mimeType: 'image/jpeg' }]);
      const seen: UploadContext[] = [];
      const assets = {
        isConfigured: (kind: AssetKind) => kind === 'image',
        uploadByFile: vi.fn(async (_f: File, ctx: UploadContext) => { seen.push(ctx); return { url: 'u' }; }),
        uploadByUrl: vi.fn(),
      };
      const uploader = new Uploader({}, assets, () => ({ formats: { image: ['jpeg'] } }));

      await uploader.handleFile(photo());

      expect(seen[0]).toMatchObject({ kind: 'image', tool: 'image', variant: { mimeType: 'image/jpeg', role: 'variant' } });
    });

    it('uses the host convert hook and falls back to built-in when it returns null', async () => {
      const convert = vi.fn(async () => [{ file: new Blob(['w'], { type: 'image/webp' }), mimeType: 'image/webp' }]);
      const uploadByFile = vi.fn(async (file: File) => ({ url: file.name }));
      const uploader = new Uploader({ uploader: { uploadByFile } }, undefined, () => ({ formats: { image: ['webp'] }, convert }));

      const result = await uploader.handleFile(photo());

      expect(convert).toHaveBeenCalledWith(expect.any(File), ['webp'], expect.objectContaining({ kind: 'image' }));
      expect(produceMock).not.toHaveBeenCalled();
      expect(result.variants?.map((v) => v.mimeType)).toEqual(['image/webp', 'image/jpeg']);

      convert.mockResolvedValueOnce(null as never);
      await uploader.handleFile(photo());
      expect(produceMock).toHaveBeenCalledTimes(1);
    });

    it('keeps the old single-file path when no image formats are set', async () => {
      const uploadByFile = vi.fn(async () => ({ url: 'u' }));
      const result = await new Uploader({ uploader: { uploadByFile } }, undefined, () => ({ formats: { video: ['mp4'] } })).handleFile(photo());

      expect(result.variants).toBeUndefined();
      expect(compressImageMock).toHaveBeenCalledTimes(1);
      expect(produceMock).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run to verify fail**

Run: `yarn test test/unit/tools/image/uploader.test.ts`
Expected: FAIL — `variants` undefined / `produceMock` not called.

- [ ] **Step 3: Implement the uploader**

```ts
// src/tools/image/uploader.ts — additions
import type { MediaConfig, MediaVariant, ConvertedMedia } from '../../../types/configs/media';
import { produceImageVariants } from '../../components/media-variants/image-variants';
import { uploadImageVariants, type VariantRole } from '../../components/media-variants/upload-variants';

export interface UploadResult {
  url: string;
  fileName?: string;
  variants?: MediaVariant[];
}

  constructor(
    private readonly config: ImageConfig,
    private readonly assets?: AssetUploaderApi,
    private readonly media: () => MediaConfig | undefined = () => undefined,
  ) {}

  public async handleFile(file: File, options: UploadOptions = {}): Promise<UploadResult> {
    this.validateFile(file);

    const formats = this.media()?.formats?.image;

    if (formats !== undefined && formats.length > 0) {
      const produced = await this.convert(file, formats);

      return uploadImageVariants(file, produced, (part, variant, onProgress) =>
        this.uploadOne(part, onProgress, variant), options.onProgress);
    }

    const uploaded = (await compressImage(file, this.config.compress)) ?? file;

    return this.uploadOne(uploaded, options.onProgress);
  }

  private async convert(file: File, formats: NonNullable<NonNullable<MediaConfig['formats']>['image']>): Promise<ConvertedMedia[]> {
    const custom = this.media()?.convert;

    if (custom !== undefined) {
      try {
        const out = await custom(file, formats, { kind: 'image' });

        if (out !== null) return out;
      } catch {
        // A failing hook must not lose the upload: use the built-in converter.
      }
    }
    const compress = typeof this.config.compress === 'object' ? this.config.compress : {};

    return produceImageVariants(file, formats, {
      quality: compress.quality ?? 0.92,
      maxWidth: compress.maxWidth,
      maxHeight: compress.maxHeight,
    });
  }

  private async uploadOne(
    file: File,
    onProgress?: (percent: number) => void,
    variant?: { mimeType: string; role: VariantRole },
  ): Promise<UploadResult> {
    if (this.assets?.isConfigured('image', 'uploadByFile')) {
      return this.assets.uploadByFile(file, { kind: 'image', tool: 'image', onProgress, variant });
    }
    if (this.config.uploader?.uploadByFile) {
      return this.config.uploader.uploadByFile(file, { onProgress });
    }

    return { url: URL.createObjectURL(file), fileName: file.name };
  }
```

Replace the old tail of `handleFile` with the `uploadOne` call (same three branches, unchanged order). Note: the `convert` hook result must be sorted — `uploadImageVariants` already sorts.

- [ ] **Step 4: Run to verify the uploader passes**

Run: `yarn test test/unit/tools/image/uploader.test.ts test/unit/architecture/asset-uploader-wiring-law.test.ts`
Expected: PASS. If the wiring law fails because the constructor call changed, update the law's expected pattern only if it asserts the exact argument list — read the test first; it must still see `new Uploader(this.config, this.api.uploader`.

- [ ] **Step 5: Write the failing image-tool tests** (in `test/unit/tools/image/index.test.ts`, following that file's existing tool factory — read its top 80 lines for the helper that builds `api`/`block` and add `config: { media: … }` to the fake `api.config`)

```ts
  describe('variants', () => {
    it('saves stored variants and drops malformed ones', () => {
      const tool = createImageTool({ data: { url: 'https://x/a.jpg', variants: [
        { url: 'https://x/a.avif', mimeType: 'image/avif' },
        { url: 'javascript:1', mimeType: 'image/webp' },
      ] } });

      expect(tool.save().variants).toEqual([{ url: 'https://x/a.avif', mimeType: 'image/avif' }]);
    });

    it('omits variants from saved data when there are none', () => {
      expect('variants' in createImageTool({ data: { url: 'https://x/a.jpg' } }).save()).toBe(false);
    });

    it('drops old variants when the user enters a link instead', async () => {
      const tool = createImageTool({ data: { url: 'https://x/a.jpg', variants: [{ url: 'https://x/a.avif', mimeType: 'image/avif' }] } });

      tool.render();
      await enterLink(tool, 'https://y/b.png'); // use the file's existing helper for the Link tab / onPaste pattern

      expect(tool.save().variants).toBeUndefined();
    });

    it('stores variants from a finished upload', async () => {
      // Arrange the Uploader mock (the file already mocks ./uploader or compress — follow it) so handleFile resolves
      // { url: 'https://cdn/a.jpg', variants: [{ url: 'https://cdn/a.avif', mimeType: 'image/avif' }, { url: 'https://cdn/a.jpg', mimeType: 'image/jpeg' }] }
      const tool = createImageTool({ data: {} });

      tool.render();
      await pickFile(tool, new File(['x'], 'a.jpg', { type: 'image/jpeg' }));

      expect(tool.save()).toMatchObject({
        url: 'https://cdn/a.jpg',
        variants: [{ url: 'https://cdn/a.avif', mimeType: 'image/avif' }, { url: 'https://cdn/a.jpg', mimeType: 'image/jpeg' }],
      });
    });
  });
```

If `createImageTool`, `enterLink` or `pickFile` do not exist under those names, use the file's existing equivalents; do not create a second factory.

- [ ] **Step 6: Run to verify fail**

Run: `yarn test test/unit/tools/image/index.test.ts -t "variants"`
Expected: FAIL.

- [ ] **Step 7: Implement in `src/tools/image/index.ts`**

- Constructor: `this.data = { ...options.data, url: options.data?.url ?? '', variants: readVariants(options.data?.variants) };` and `this.uploader = new Uploader(this.config, this.api.uploader, () => this.api.config?.media);`
- `save()`: after `fileName`, add `if (this.data.variants !== undefined) out.variants = this.data.variants.map((v) => ({ ...v }));`
- `resultDelta(result)`: `delta.variants = result.variants;` — always set, so a plain result CLEARS stale variants in the detached path.
- `showResult(result)`: `this.data = { ...this.data, url: result.url, fileName: result.fileName ?? this.data.fileName, variants: result.variants };`
- `writeEnteredUrl(url)`: `this.data = { ...this.data, url, variants: undefined };`
- Check every other `this.data = { ...this.data, url…` assignment in the file (`grep -n "url:" src/tools/image/index.ts`). Any write that changes `url` to a new asset must also set `variants: undefined`; a write that restores a previous `url` (undo-style `before`) must restore the previous `variants` too — capture it next to `before`.

- [ ] **Step 8: Run to verify pass**

Run: `yarn test test/unit/tools/image/index.test.ts test/unit/tools/image/uploader.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/tools/image/uploader.ts src/tools/image/index.ts test/unit/tools/image/uploader.test.ts test/unit/tools/image/index.test.ts
git commit -m "feat(image): convert uploads into the configured formats and keep them as variants"
```

---

### Task 7: Editor rendering — `<picture>` for images, `<source>` for video, video keeps `variants`

**Files:**
- Modify: `src/tools/image/ui.ts` (`renderImage`, ~line 65), `src/tools/video/ui.ts` (~line 35-50), `src/tools/video/index.ts` (constructor ~71, `save` ~84, every `url` write)
- Test: `test/unit/tools/image/ui.test.ts`, `test/unit/tools/video/ui.test.ts`, `test/unit/tools/video/index.test.ts`

**Interfaces:**
- Consumes: `MediaVariant`, `readVariants`.
- Produces: image DOM `figure > picture[display:contents] > source[type][srcset]* + img[src=url]` (inside the crop wrapper when cropped); video DOM `video > source[src][type]*` with `video[src]` removed when variants exist.

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/tools/image/ui.test.ts — new describe
  describe('renderImage with variants', () => {
    const variants = [
      { url: 'https://x/a.avif', mimeType: 'image/avif' },
      { url: 'https://x/a.webp', mimeType: 'image/webp' },
      { url: 'https://x/a.jpg', mimeType: 'image/jpeg' },
    ];

    it('wraps the img in a picture with one source per better format, best first', () => {
      const figure = renderImage({ url: 'https://x/a.jpg', variants });
      const picture = figure.querySelector('picture');

      expect(picture).not.toBeNull();
      expect(Array.from(picture!.querySelectorAll('source')).map((s) => [s.getAttribute('type'), s.getAttribute('srcset')]))
        .toEqual([['image/avif', 'https://x/a.avif'], ['image/webp', 'https://x/a.webp']]);
      expect(picture!.querySelector('img')?.getAttribute('src')).toBe('https://x/a.jpg');
      expect(picture!.style.display).toBe('contents');
    });

    it('keeps the crop wrapper around the picture', () => {
      const figure = renderImage({ url: 'https://x/a.jpg', variants, crop: { x: 10, y: 10, w: 50, h: 50 } });

      expect(figure.querySelector('[data-role="image-crop"] > picture > img')).not.toBeNull();
    });

    it('renders a bare img when there are no variants', () => {
      expect(renderImage({ url: 'https://x/a.jpg' }).querySelector('picture')).toBeNull();
    });
  });
```

The existing file imports `renderImage`; if it uses a non-null-assert-free style (project rule: no `!`), replace `picture!` with a guard: `if (!picture) throw new Error('no picture');`.

```ts
// test/unit/tools/video/ui.test.ts — new describe
  describe('renderVideo with variants', () => {
    it('emits one source per variant in stored order and no src attribute', () => {
      const figure = renderVideo({ url: 'https://x/a.mp4', variants: [
        { url: 'https://x/a.webm', mimeType: 'video/webm; codecs="vp9, opus"' },
        { url: 'https://x/a.mp4', mimeType: 'video/mp4' },
      ] });
      const video = figure.querySelector('video');

      if (!video) throw new Error('no video');
      expect(video.hasAttribute('src')).toBe(false);
      expect(Array.from(video.querySelectorAll('source')).map((s) => [s.getAttribute('src'), s.getAttribute('type')]))
        .toEqual([['https://x/a.webm', 'video/webm; codecs="vp9, opus"'], ['https://x/a.mp4', 'video/mp4']]);
    });

    it('keeps the src attribute when there are no variants', () => {
      expect(renderVideo({ url: 'https://x/a.mp4' }).querySelector('video')?.getAttribute('src')).toBe('https://x/a.mp4');
    });
  });
```

```ts
// test/unit/tools/video/index.test.ts — follow the file's factory
  it('round-trips clean variants through save and drops them when the url is replaced', async () => {
    const tool = createVideoTool({ data: { url: 'https://x/a.mp4', variants: [{ url: 'https://x/a.webm', mimeType: 'video/webm' }, { url: 'javascript:1', mimeType: 'video/mp4' }] } });

    expect(tool.save().variants).toEqual([{ url: 'https://x/a.webm', mimeType: 'video/webm' }]);

    tool.render();
    await enterLink(tool, 'https://y/b.mp4');
    expect(tool.save().variants).toBeUndefined();
  });
```

- [ ] **Step 2: Run to verify fail**

Run: `yarn test test/unit/tools/image/ui.test.ts test/unit/tools/video/ui.test.ts test/unit/tools/video/index.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/tools/image/ui.ts` — after the `img` is built, and before it is appended:

```ts
  // The <source>s list only the formats better than `url`; `url` stays on the
  // <img> so everything that queries `img` keeps working.
  const better = (data.variants ?? []).filter((v) => v.url !== data.url);
  const content: HTMLElement = better.length === 0 ? img : wrapInPicture(img, better);
```

and append `content` (not `img`) in both the crop and no-crop branches. Add:

```ts
function wrapInPicture(img: HTMLImageElement, variants: MediaVariant[]): HTMLElement {
  const picture = document.createElement('picture');

  // contents: the picture adds no box, so crop and sizing styles on the img still apply.
  picture.style.display = 'contents';
  for (const variant of variants) {
    const source = document.createElement('source');

    source.setAttribute('type', variant.mimeType);
    source.setAttribute('srcset', variant.url);
    picture.appendChild(source);
  }
  picture.appendChild(img);

  return picture;
}
```

`bindIntrinsicAspect(img, …)` keeps its `img` argument. Import `MediaVariant` from `../../../types/configs/media`.

`src/tools/video/ui.ts` — replace `video.setAttribute('src', data.url);` with:

```ts
  const variants = data.variants ?? [];

  if (variants.length === 0) {
    video.setAttribute('src', data.url);
  } else {
    for (const variant of variants) {
      const source = document.createElement('source');

      source.setAttribute('src', variant.url);
      source.setAttribute('type', variant.mimeType);
      video.appendChild(source);
    }
  }
```

`controls.ts:415` already reads `video.currentSrc || video.getAttribute('src')`, so the seek preview follows the chosen source.

`src/tools/video/index.ts`:
- constructor: `variants: readVariants(options.data?.variants)`.
- `save()`: `if (this.data.variants !== undefined) out.variants = this.data.variants.map((v) => ({ ...v }));`
- every write that sets a new `url` (`grep -n "url" src/tools/video/index.ts`: ~315 `writeEnteredUrl`, ~399 `showResult`) sets `variants: undefined`; a write that restores `before` (~338) restores the prior `variants` captured with it.

- [ ] **Step 4: Run to verify pass** — same command, Expected: PASS. Also run `yarn test test/unit/tools/video/controls.test.ts test/unit/tools/image/index.test.ts` to confirm nothing that queries `img`/`video` regressed.

- [ ] **Step 5: Commit**

```bash
git add src/tools/image/ui.ts src/tools/video/ui.ts src/tools/video/index.ts test/unit/tools/image/ui.test.ts test/unit/tools/video/ui.test.ts test/unit/tools/video/index.test.ts
git commit -m "feat(media): render stored variants best-first in the editor"
```

---

### Task 8: `/view` renderer and document schema

**Files:**
- Modify: `src/view/emitters.ts` (`image` ~497, `video` ~503), `src/view/document-schema.ts` (`image` ~380 and `video` `$defs`)
- Test: `test/unit/view/blocks-to-html.test.ts`, `test/unit/view/document-schema.test.ts`

**Interfaces:**
- Consumes: `readVariants`, `env.url(name, value, blockType)` (applies host `transformUrl` + unsafe-protocol filter). `env.url` only accepts `'href' | 'src'`; for `srcset` call `env.url('src', …)` and rename the attribute (the value is a single URL, no descriptors).

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/view/blocks-to-html.test.ts — follow the file's `doc(...)` helper
  describe('media variants', () => {
    it('renders an image as a picture with better formats first', () => {
      const html = blocksToHtml(doc([{ type: 'image', data: { url: 'https://x/a.jpg', alt: 'A', variants: [
        { url: 'https://x/a.avif', mimeType: 'image/avif' },
        { url: 'https://x/a.jpg', mimeType: 'image/jpeg' },
      ] } }]));

      expect(html).toContain('<picture><source srcset="https://x/a.avif" type="image/avif"><img src="https://x/a.jpg" alt="A"></picture>');
    });

    it('renders video sources in stored order', () => {
      const html = blocksToHtml(doc([{ type: 'video', data: { url: 'https://x/a.mp4', variants: [
        { url: 'https://x/a.webm', mimeType: 'video/webm' },
        { url: 'https://x/a.mp4', mimeType: 'video/mp4' },
      ] } }]));

      expect(html).toContain('<video controls><source src="https://x/a.webm" type="video/webm"><source src="https://x/a.mp4" type="video/mp4"></video>');
    });

    it('drops a variant whose URL the policy rejects', () => {
      const html = blocksToHtml(doc([{ type: 'image', data: { url: 'https://x/a.jpg', variants: [{ url: 'javascript:alert(1)', mimeType: 'image/avif' }] } }]));

      expect(html).not.toContain('javascript:');
      expect(html).not.toContain('<picture>');
    });
  });
```

```ts
// test/unit/view/document-schema.test.ts — follow the file's validate helper
  it('accepts variants on image and video blocks', () => {
    // use the same validator call the file uses for other image/video cases
    expect(validateDoc({ blocks: [
      { type: 'image', data: { url: 'a.jpg', variants: [{ url: 'a.avif', mimeType: 'image/avif' }] } },
      { type: 'video', data: { url: 'a.mp4', variants: [{ url: 'a.webm', mimeType: 'video/webm' }] } },
    ] }).valid).toBe(true);
  });
```

- [ ] **Step 2: Run to verify fail**

Run: `yarn test test/unit/view/blocks-to-html.test.ts test/unit/view/document-schema.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/view/document-schema.ts` — add to both `image.properties` and `video.properties`:

```ts
        variants: {
          type: 'array',
          description: 'Other renditions, best format first. `url` is the most compatible one.',
          items: {
            type: 'object',
            required: ['url', 'mimeType'],
            additionalProperties: false,
            properties: { url: { type: 'string' }, mimeType: { type: 'string' } },
          },
        },
```

`src/view/emitters.ts`:

```ts
  image: (block, env) => {
    const img = `<img${env.url('src', block.data.url, block.type)} alt="${env.escape(str(block.data, 'alt'))}">`;
    const sources = (readVariants(block.data.variants) ?? [])
      .filter((v) => v.url !== block.data.url)
      .map((v) => {
        const src = env.url('src', v.url, block.type);

        return src === '' ? '' : `<source${src.replace(' src=', ' srcset=')} type="${env.escape(v.mimeType)}">`;
      })
      .join('');
    const media = sources === '' ? img : `<picture>${sources}${img}</picture>`;

    return trail(`<figure>${media}${figcaption(block, env)}</figure>`, block, env);
  },

  video: (block, env) => {
    const controls = block.data.hideControls === true ? '' : ' controls';
    const autoplay = block.data.autoplay === true ? ' autoplay' : '';
    const loop = block.data.loop === true ? ' loop' : '';
    const sources = (readVariants(block.data.variants) ?? [])
      .map((v) => {
        const src = env.url('src', v.url, block.type);

        return src === '' ? '' : `<source${src} type="${env.escape(v.mimeType)}">`;
      })
      .join('');
    const srcAttr = sources === '' ? env.url('src', block.data.url, block.type) : '';
    const video = `<video${srcAttr}${controls}${autoplay}${loop}>${sources}</video>`;

    return trail(`<figure>${video}${figcaption(block, env)}</figure>`, block, env);
  },
```

Import `readVariants` from `../components/media-variants/read-variants`. Then check `test/unit/view/index.purity.test.ts` — the view entry has a purity law; if importing from `src/components/` breaks it, move `read-variants.ts` to `src/shared/read-variants.ts` (update Task 3's imports) and re-run.

- [ ] **Step 4: Run to verify pass**

Run: `yarn test test/unit/view/blocks-to-html.test.ts test/unit/view/document-schema.test.ts test/unit/view/index.purity.test.ts test/unit/view/blocks-to-html.mutants.test.ts test/unit/view/golden-harness.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/view/emitters.ts src/view/document-schema.ts test/unit/view/blocks-to-html.test.ts test/unit/view/document-schema.test.ts
git commit -m "feat(view): render media variants best-first and accept them in the schema"
```

---

### Task 9: Copy to other apps keeps a working image

**Files:**
- Test: `test/unit/components/modules/blockSelection.test.ts` (find the existing copy test that asserts `text/html`; follow it)
- Modify only if the test fails: the sanitizer config used by `appendNonListBlock` (`src/components/modules/blockSelection.ts:709`)

- [ ] **Step 1: Write the test**

```ts
  it('copies an image with variants as a plain img pointing at the compatible url', async () => {
    // Build a selected image block whose holder contains the Task 7 DOM:
    // <figure><picture style="display:contents"><source type="image/avif" srcset="https://x/a.avif"><img src="https://x/a.jpg" alt=""></picture></figure>
    // then run the same copy call the neighbouring tests use and read clipboardData 'text/html'.
    const html = copiedHtml; // from the helper

    expect(html).toContain('src="https://x/a.jpg"');
    expect(html).not.toContain('javascript:');
  });
```

- [ ] **Step 2: Run it**

Run: `yarn test test/unit/components/modules/blockSelection.test.ts -t "variants"`
Expected: either PASS (the sanitizer unwraps `picture`/drops `source`, keeping the `img`) — then this is a pin, commit it; or FAIL because the whole `img` was dropped — then add `picture: {}` is NOT allowed to be whitelisted blindly: read `sanitizerConfig` in that module, make the copy path unwrap `picture` (replace each `picture` with its `img` in `ownClone(block.holder)` before `clean(...)`), and re-run until PASS.

- [ ] **Step 3: Commit**

```bash
git add test/unit/components/modules/blockSelection.test.ts src/components/modules/blockSelection.ts
git commit -m "test(copy): an image with variants copies as a working img"
```

---

### Task 10: End-to-end — drop a photo, get a `<picture>`

**Files:**
- Create: `test/playwright/tests/tools/image-format-variants.spec.ts` (copy the harness of `image-compression.spec.ts`: `createBlok`, `uploadFixtureImage`, `PHOTO_FIXTURE_PATH`, `SHOT_FIXTURE_PATH`)

- [ ] **Step 1: Write the spec**

```ts
// Boot like image-compression.spec.ts, but put the formats at editor level and record every upload:
//   new window.Blok({ holder, data: { blocks: [{ type: 'image', data: {} }] },
//     media: { formats: { image: ['avif', 'webp', 'jpeg'] } },
//     tools: { image: { class: window.BlokImage, config: { uploader: { uploadByFile: async (file) => {
//       window.__uploads = [...(window.__uploads ?? []), { type: file.type, name: file.name }];
//       return { url: URL.createObjectURL(file), fileName: file.name };
//     } } } } } })

test('a dropped photo is saved with every format this browser can encode, best first', async ({ page }) => {
  await createBlok(page);
  await uploadPhoto(page);

  const saved = await page.evaluate(async () => (await window.blokInstance!.save()).blocks[0].data);
  const types = (saved.variants as Array<{ mimeType: string }>).map((v) => v.mimeType);

  // JPEG is encodable everywhere, so it is always last and always the url.
  expect(types.at(-1)).toBe('image/jpeg');
  expect(saved.url).toBe((saved.variants as Array<{ url: string }>).at(-1)?.url);
  // Whatever else this engine made is in rank order.
  const rank = ['image/avif', 'image/webp', 'image/jpeg'];
  expect([...types].sort((a, b) => rank.indexOf(a) - rank.indexOf(b))).toEqual(types);
});

test('the rendered image shows the picture element and a loaded img', async ({ page }) => {
  await createBlok(page);
  await uploadPhoto(page);

  const img = page.locator(IMAGE_BLOCK_SELECTOR).getByRole('img');

  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  expect(await img.evaluate((el) => el.parentElement?.tagName)).toBe(
    // A browser that made only JPEG has nothing better to offer, so no <picture>.
    await page.evaluate(async () => ((await window.blokInstance!.save()).blocks[0].data.variants.length > 1 ? 'PICTURE' : 'FIGURE')),
  );
});

test('a transparent PNG never becomes a JPEG', async ({ page }) => {
  await createBlok(page); // formats: ['webp', 'jpeg', 'png'] for this test
  await uploadShot(page);

  const saved = await page.evaluate(async () => (await window.blokInstance!.save()).blocks[0].data);
  expect((saved.variants as Array<{ mimeType: string }>).map((v) => v.mimeType)).not.toContain('image/jpeg');
});

test('saved variants survive a reload', async ({ page }) => {
  await createBlok(page);
  await uploadPhoto(page);
  const first = await page.evaluate(async () => (await window.blokInstance!.save()).blocks[0].data);

  // Re-create the editor from the saved data (same helper, pass `data`).
  const second = await reboot(page, first);
  expect(second.variants).toEqual(first.variants);
});
```

Check `test/playwright/fixtures/image/shot.png` actually has transparency before relying on it (`node -e` with a PNG reader, or open it in the browser and read one pixel's alpha via canvas). If it does not, add a small transparent PNG fixture.

Replace every `!` with a guard (project rule). Add `createBlok`'s `formats` parameter instead of editing it per test.

- [ ] **Step 2: Run it**

Run: `yarn e2e test/playwright/tests/tools/image-format-variants.spec.ts`
Expected: PASS in chromium, firefox, webkit (build runs automatically).

- [ ] **Step 3: Commit**

```bash
git add test/playwright/tests/tools/image-format-variants.spec.ts
git commit -m "test(e2e): photos are saved and shown in every configured format"
```

---

### Task 11: Documentation (en + ru)

**Files:**
- Modify: `docs/src/components/api/api-data.ts` (after the `uploader` option ~line 615), `docs/src/i18n/en.json` and `docs/src/i18n/ru.json` (`api.configuration.table.media.description`), `docs/src/components/tools/tools-data.ts` (image + video `saveDataShape` gain `variants?`), plus `api.configuration.table.uploader` description gains the `variant` context sentence.

- [ ] **Step 1: Add the option row** (same text in `api-data.ts` literal and `en.json`; follow `docs/CLAUDE.md` reference-prose law — no dashes joining clauses, ≤34-word sentences)

```ts
      {
        option: "media",
        type: "MediaConfig",
        default: "undefined",
        description:
          "Convert every uploaded photo into several formats. The editor then shows the best one each browser supports. It is off until you list formats.\n\n- `formats.image` takes `'avif'`, `'webp'`, `'jpeg'` and `'png'`.\n- The order you write does not matter. Blok stores and renders them best first.\n- The most compatible format becomes `url`, so readers that ignore `variants` still work.\n- A format the browser cannot encode is skipped. The original is kept as the fallback when no JPEG or PNG was made.\n- A transparent image never gets a JPEG.\n\nEach rendition is a separate upload. Your uploader receives `variant: { mimeType, role }` in its context.\n\n`convert(file, formats, ctx)` replaces the built-in converter. Return `null` to use Blok's own.",
      },
```

`ru.json`: the same five-part structure translated (use the `blok-translations` skill's conventions for tone; keep the identical block shape).

- [ ] **Step 2: Run the docs guards**

Run: `cd docs && yarn vitest run src/i18n/reference-prose.test.ts src/components/api/api-data.ru-coverage.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add docs/src/components/api/api-data.ts docs/src/components/tools/tools-data.ts docs/src/i18n/en.json docs/src/i18n/ru.json
git commit -m "docs(media): document the media formats config"
```

---

### Task 12: Final gates

- [ ] Run `yarn lint` on every changed file (list from `git diff --name-only <first commit of this plan>^..HEAD`).
- [ ] Run the related tests: `yarn test test/unit/components/media-variants test/unit/tools/image test/unit/tools/video test/unit/view test/unit/components/modules/api-config.test.ts test/unit/architecture`.
- [ ] Run `npx tsc --noEmit -p tsconfig.json` (needs `NODE_OPTIONS=--max-old-space-size=8192`).
- [ ] Run `yarn test test/unit/build/bundle-outputs.test.ts` and the dist-weight check if present (new module must not add runtime deps).
- [ ] `git pull --rebase && git push`; `git status` shows up to date.
