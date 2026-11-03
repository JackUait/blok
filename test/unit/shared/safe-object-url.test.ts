import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSafeObjectUrl } from '../../../src/shared/safe-object-url';

const HTML = '<script>alert(document.domain)</script>';

describe('createSafeObjectUrl', () => {
  const made: Blob[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    made.length = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((obj) => {
      if (obj instanceof Blob) {
        made.push(obj);
      }

      return `blob:https://host.test/${made.length}`;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const typeFor = (type: string | undefined, options?: { svgImage?: boolean }): string => {
    createSafeObjectUrl(new Blob([HTML], type === undefined ? {} : { type }), options);

    return made[made.length - 1].type;
  };

  it.each([
    'text/html',
    'TEXT/HTML; charset=utf-8',
    'image/svg+xml',
    'application/xhtml+xml',
    'text/xml',
    'application/xml',
    'application/octet-stream',
    'application/zip',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'video/ogg',
    'application/x-unknown',
  ])('re-types %s as text/plain, so the URL runs no script when opened', (type) => {
    expect(typeFor(type)).toBe('text/plain');
  });

  it('re-types an untyped blob as text/plain', () => {
    expect(typeFor(undefined)).toBe('text/plain');
  });

  it.each([
    'text/plain',
    'application/pdf',
    'application/json',
    'text/csv',
    'text/javascript',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/avif',
    'video/mp4',
    'video/webm',
    'audio/mpeg',
    'audio/ogg',
    'audio/wav',
  ])('keeps %s, which a browser never runs as a page', (type) => {
    expect(typeFor(type)).toBe(type);
  });

  it.each(['text/plain;charset=utf-8', 'IMAGE/PNG'])('reads %s by its base type and keeps it', (type) => {
    expect(typeFor(type)).toBe(type.toLowerCase());
  });

  it('keeps the bytes when it re-types', async () => {
    createSafeObjectUrl(new Blob([HTML], { type: 'text/html' }));

    expect(await made[0].text()).toBe(HTML);
  });

  it('keeps an SVG type only for an image that never opens as a page', () => {
    expect(typeFor('image/svg+xml', { svgImage: true })).toBe('image/svg+xml');
    expect(typeFor('text/html', { svgImage: true })).toBe('text/plain');
  });

  it('returns the object URL', () => {
    expect(createSafeObjectUrl(new Blob(['x'], { type: 'image/png' }))).toBe('blob:https://host.test/1');
  });
});
