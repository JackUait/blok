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

  it('orders videos AV1, VP9, then H.264', () => {
    const av1 = 'video/webm; codecs="av01.0.08M.08, opus"';
    const vp9 = 'video/webm; codecs="vp9, opus"';
    const h264 = 'video/mp4; codecs="avc1.640028, mp4a.40.2"';

    expect(sortBestFirst([{ mimeType: h264 }, { mimeType: vp9 }, { mimeType: av1 }]).map((v) => v.mimeType))
      .toEqual([av1, vp9, h264]);
  });

  it('puts unknown types last', () => {
    expect(rankOf('image/heic')).toBe(Infinity);
    expect(sortBestFirst([{ mimeType: 'image/heic' }, { mimeType: 'image/jpeg' }])[0].mimeType).toBe('image/jpeg');
  });

  it('maps formats to MIME types', () => {
    expect(IMAGE_FORMAT_MIME).toEqual({ avif: 'image/avif', webp: 'image/webp', jpeg: 'image/jpeg', png: 'image/png' });
  });
});
