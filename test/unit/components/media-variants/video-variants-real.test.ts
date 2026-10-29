// @vitest-environment node
// Node has no WebCodecs, so a result here can only be a copy, never a re-encode.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { produceVideoVariant } from '../../../../src/components/media-variants/video-variants';

const FIXTURES = join(process.cwd(), 'test/playwright/fixtures/video');
/** 2 s, 320×240, VP9 profile 0 + Opus. */
const clip = (): File => new File([readFileSync(join(FIXTURES, 'clip.webm'))], 'clip.webm', { type: 'video/webm' });
/** 2 s, 321×241, VP9 profile 1 (4:4:4) + Opus. */
const odd = (): File => new File([readFileSync(join(FIXTURES, 'odd.webm'))], 'odd.webm', { type: 'video/webm' });
const load = (): Promise<unknown> => import('mediabunny');

describe('produceVideoVariant with the real Mediabunny', () => {
  it('copies a long VP9 + Opus video into WebM', async () => {
    const out = await produceVideoVariant(clip(), 'webm', { maxTranscodeDuration: 0, load });

    expect(out?.mimeType).toMatch(/^video\/webm; codecs="vp09\.00\.20\.08/);
    expect(out?.file.size).toBeGreaterThan(0);
  });

  it('copies a short VP9 + Opus video into WebM instead of re-encoding it', async () => {
    const out = await produceVideoVariant(clip(), 'webm', { maxTranscodeDuration: 600, load });

    expect(out?.mimeType).toMatch(/^video\/webm; codecs="vp09\.00\.20\.08/);
  });

  it('makes no MP4 from a long VP9 video, since VP9 cannot be copied into MP4', async () => {
    expect(await produceVideoVariant(clip(), 'mp4', { maxTranscodeDuration: 0, load })).toBeNull();
  });

  it('never copies VP9 profile 1, which some browsers cannot play', async () => {
    expect(await produceVideoVariant(odd(), 'webm', { maxTranscodeDuration: 0, load })).toBeNull();
  });
});
