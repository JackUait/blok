import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../..');
const html = readFileSync(resolve(root, 'index.html'), 'utf-8');

const lockup = (): Element => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const element = doc.querySelector('.playground-wordmark');

  if (!element) {
    throw new Error('header lockup is missing');
  }

  return element;
};

describe('playground header lockup', () => {
  // The favicon carries "Blok" lettering, which turns to mush at header size
  // and repeats the wordmark beside it.
  it('draws the mascot without its lettering', () => {
    const src = lockup().querySelector('img')?.getAttribute('src') ?? '';

    expect(src).toBe('/blok-mark.png');
    expect(existsSync(resolve(root, 'public', src.slice(1)))).toBe(true);
  });

  it('leads home to the editor', () => {
    expect(lockup().tagName).toBe('A');
    expect(lockup().getAttribute('href')).toBe('/editor');
  });

  it('names the release the playground runs', () => {
    expect(lockup().querySelector('#pg-header-version')).not.toBeNull();
  });
});
