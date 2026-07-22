import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = fs.readFileSync(path.join(DOCS_ROOT, 'src/index.css'), 'utf8');

/**
 * The site's chrome font is self-hosted. A remote `@import` inside the bundled
 * stylesheet costs an extra DNS + TLS + round trip that the browser can only
 * start after it has parsed the stylesheet, and none of the font files end up
 * in the build output where a preload could reach them.
 */
describe('index.css font loading', () => {
  it('pulls no stylesheet or asset from a third-party origin', () => {
    const remoteRefs = [...CSS.matchAll(/url\(\s*["']?(https?:)?\/\/[^)]+\)/g)].map(
      (match) => match[0],
    );

    expect(remoteRefs).toEqual([]);
  });

  it('serves every @font-face from a file that exists in public/', () => {
    const fontUrls = [...CSS.matchAll(/url\(\s*["']?(\/fonts\/[^"')]+)/g)].map(
      (match) => match[1],
    );

    expect(fontUrls.length).toBeGreaterThan(0);

    const missing = fontUrls.filter(
      (url) => !fs.existsSync(path.join(DOCS_ROOT, 'public', url)),
    );
    expect(missing).toEqual([]);
  });

  it('declares font-display: swap on every @font-face', () => {
    const faces = CSS.match(/@font-face\s*\{[^}]*\}/g) ?? [];

    expect(faces.length).toBeGreaterThan(0);
    expect(faces.filter((face) => !/font-display:\s*swap/.test(face))).toEqual([]);
  });
});
