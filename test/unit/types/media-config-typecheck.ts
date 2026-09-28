/**
 * Type-level tests for the `media` config.
 * Run with: tsc --noEmit --strict test/unit/types/media-config-typecheck.ts
 *
 * This file is NOT executed — it only needs to compile.
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

void image;
void video;

const ctx: UploadContext = { kind: 'image', variant: { mimeType: 'image/avif', role: 'variant' } };

void ctx;

declare const api: API;
const formats: readonly string[] | undefined = api.config.media?.formats?.image;

void formats;
