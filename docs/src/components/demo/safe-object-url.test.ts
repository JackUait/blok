import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSafeObjectUrl } from '../../../../src/shared/safe-object-url';
import { safeObjectUrl } from './safe-object-url';

// Every type core keeps, read from its source, so a type added there fails here.
const CORE_SAFE_TYPES = [
  ...(readFileSync(resolve(__dirname, '../../../../src/shared/safe-object-url.ts'), 'utf8')
    .match(/const SAFE_TYPES = new Set\(\[([^\]]*)\]/)?.[1] ?? '')
    .matchAll(/'([^']+)'/g),
].map((match) => match[1]);

const TYPES = [
  ...CORE_SAFE_TYPES,
  'text/html',
  'image/svg+xml',
  'application/xml',
  'text/xml',
  'application/xhtml+xml',
  'application/octet-stream',
  'application/zip',
  'video/ogg',
  '',
  'application/pdf',
  'image/png',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'text/html; charset=utf-8',
];

describe('demo safeObjectUrl', () => {
  it('reads the core safe list (a regex break must not pass silently)', () => {
    expect(CORE_SAFE_TYPES).toContain('image/png');
    expect(CORE_SAFE_TYPES.length).toBeGreaterThanOrEqual(20);
  });

  // jsdom has no URL.createObjectURL, so record the Blob each helper passes.
  const seen: Blob[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    seen.length = 0;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: (blob: Blob) => {
        seen.push(blob);

        return 'blob:test';
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(URL, 'createObjectURL');
  });

  it.each(TYPES)('gives a %s file the same blob type as core', (type) => {
    const file = new File(['<script>1</script>'], 'f', { type });

    safeObjectUrl(file);
    createSafeObjectUrl(file);

    expect(seen.map((blob) => blob.type)).toEqual([seen[1].type, seen[1].type]);
  });

  it('never keeps a type that runs as a page', () => {
    safeObjectUrl(new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' }));

    expect(seen[0].type).toBe('text/plain');
  });
});
