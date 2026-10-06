/**
 * Type-level tests for the `media` config.
 * Run with: tsc --noEmit --strict test/unit/types/media-config-typecheck.ts
 *
 * This file is NOT executed — it only needs to compile.
 */
import type { BlokConfig, API, UploadContext } from '../../../types';
import type { ImageData } from '../../../types/tools/image';
import type { VideoData } from '../../../types/tools/video';

const _ok: BlokConfig['media'] = {
  formats: { image: ['avif', 'webp', 'jpeg'], video: ['av1', 'webm', 'mp4'] },
  convert: async (_file, _formats, ctx) => (ctx.kind === 'image' ? null : []),
  maxTranscodeDuration: 600,
  mediabunny: async () => ({ Conversion: {} }),
};

// AVIF is an image format; `<video>` cannot play it.
// @ts-expect-error — not a VideoFormat
const _badVideo: BlokConfig['media'] = { formats: { video: ['avif'] } };

// @ts-expect-error — not an ImageFormat
const _badImage: BlokConfig['media'] = { formats: { image: ['mp4'] } };

const _image: ImageData = { url: 'a.jpg', variants: [{ url: 'a.avif', mimeType: 'image/avif' }] };
const _video: VideoData = { url: 'a.mp4', variants: [{ url: 'a.webm', mimeType: 'video/webm' }] };

const _ctx: UploadContext = { kind: 'image', variant: { mimeType: 'image/avif', role: 'variant' } };

declare const api: API;
const _formats: readonly string[] | undefined = api.config.media?.formats?.image;
