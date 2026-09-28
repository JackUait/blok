import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ConvertedMedia, MediaVariant, VideoFormat } from '../../../../types/configs/media';
import { convertVideoInBackground } from '../../../../src/components/media-variants/video-background';

const MIME: Record<VideoFormat, string> = {
  mp4: 'video/mp4; codecs="avc1.64001f, mp4a.40.2"',
  webm: 'video/webm; codecs="vp09.00.10.08, opus"',
  av1: 'video/webm; codecs="av01.0.04M.08, opus"',
};

const original = { file: new File([new Uint8Array(4)], 'clip.mov', { type: 'video/quicktime' }), url: 'https://cdn/clip.mov' };

interface Harness {
  produced: VideoFormat[];
  writes: Array<{ url: string; variants?: MediaVariant[] }>;
  deps: Parameters<typeof convertVideoInBackground>[2];
}

const harness = (makeable: VideoFormat[], overrides: Partial<Harness['deps']> = {}): Harness => {
  const produced: VideoFormat[] = [];
  const writes: Array<{ url: string; variants?: MediaVariant[] }> = [];
  const deps: Harness['deps'] = {
    produce: async (format, onProgress): Promise<ConvertedMedia | null> => {
      produced.push(format);
      onProgress(1);

      return makeable.includes(format) ? { file: new Blob([format], { type: MIME[format] }), mimeType: MIME[format] } : null;
    },
    upload: async (file) => ({ url: `https://cdn/${file.name}` }),
    isCurrent: () => true,
    write: (next) => {
      writes.push(next);
    },
    ...overrides,
  };

  return { produced, writes, deps };
};

describe('convertVideoInBackground', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('makes the most compatible format first, whatever the listed order', async () => {
    const h = harness(['mp4', 'webm', 'av1']);

    await convertVideoInBackground(original, ['av1', 'webm', 'mp4', 'webm'], h.deps);

    expect(h.produced).toEqual(['mp4', 'webm', 'av1']);
  });

  it('swaps url to the MP4 once it exists and adds better formats in front of it', async () => {
    const h = harness(['mp4', 'webm']);

    await convertVideoInBackground(original, ['mp4', 'webm'], h.deps);

    expect(h.writes).toEqual([
      { url: 'https://cdn/clip.mp4', variants: undefined },
      {
        url: 'https://cdn/clip.mp4',
        variants: [
          { url: 'https://cdn/clip.webm', mimeType: MIME.webm },
          { url: 'https://cdn/clip.mp4', mimeType: MIME.mp4 },
        ],
      },
    ]);
  });

  it('keeps the original as url, and last, when no MP4 could be made', async () => {
    const h = harness(['webm', 'av1']);

    await convertVideoInBackground(original, ['mp4', 'webm', 'av1'], h.deps);

    expect(h.writes.at(-1)).toEqual({
      url: 'https://cdn/clip.mov',
      variants: [
        { url: 'https://cdn/clip.av1.webm', mimeType: MIME.av1 },
        { url: 'https://cdn/clip.webm', mimeType: MIME.webm },
        { url: 'https://cdn/clip.mov', mimeType: 'video/quicktime' },
      ],
    });
  });

  it('writes nothing when no format could be made', async () => {
    const h = harness([]);

    await convertVideoInBackground(original, ['mp4', 'webm'], h.deps);

    expect(h.writes).toEqual([]);
  });

  it('skips a format whose upload fails and carries on', async () => {
    const h = harness(['mp4', 'webm'], {
      upload: async (file) => {
        if (file.type.startsWith('video/mp4')) throw new Error('415');

        return { url: `https://cdn/${file.name}` };
      },
    });

    await convertVideoInBackground(original, ['mp4', 'webm'], h.deps);

    expect(h.writes.at(-1)?.variants?.map((v) => v.url)).toEqual(['https://cdn/clip.webm', 'https://cdn/clip.mov']);
  });

  it('stops before the next format once the block shows another video', async () => {
    const block = { url: 'https://cdn/clip.mov' };
    const h = harness(['mp4', 'webm', 'av1'], {
      isCurrent: (url) => url === block.url,
      write: (next) => {
        // The user replaces the video right after the MP4 lands.
        block.url = 'https://cdn/other.mp4';
        h.writes.push(next);
      },
    });

    await convertVideoInBackground(original, ['mp4', 'webm', 'av1'], h.deps);

    expect(h.produced).toEqual(['mp4']);
    expect(h.writes).toHaveLength(1);
  });

  it('drops a format that finishes after the block changed', async () => {
    const block = { url: 'https://cdn/clip.mov' };
    const h = harness(['webm'], {
      isCurrent: (url) => url === block.url,
      produce: async () => {
        block.url = 'https://cdn/other.mp4';

        return { file: new Blob(['w'], { type: MIME.webm }), mimeType: MIME.webm };
      },
    });

    await convertVideoInBackground(original, ['webm'], h.deps);

    expect(h.writes).toEqual([]);
  });

  it('reports progress across all formats', async () => {
    const seen: number[] = [];
    const h = harness(['mp4', 'webm'], { onProgress: (p) => seen.push(p) });

    await convertVideoInBackground(original, ['mp4', 'webm'], h.deps);

    expect(seen.at(-1)).toBe(100);
    expect(seen).toContain(50);
  });
});
