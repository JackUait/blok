import { describe, it, expect } from 'vitest';
import { readVariants } from '../../../src/shared/read-variants';

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

describe('readVariants with the block url', () => {
  const list = [
    { url: 'https://x/a.avif', mimeType: 'image/avif' },
    { url: 'https://x/a.jpg', mimeType: 'image/jpeg' },
  ];

  it('keeps the list when the url is one of its entries', () => {
    expect(readVariants(list, 'https://x/a.jpg')).toEqual(list);
  });

  it('drops the whole list when the url is not in it, since it describes another image', () => {
    expect(readVariants(list, 'https://x/NEW.jpg')).toBeUndefined();
  });
});
