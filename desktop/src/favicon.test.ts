import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');

function declaredIcons(): string[] {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  return [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
}

describe('favicon', () => {
  it('declares the Blok mark, and every file it points at exists', () => {
    const hrefs = declaredIcons();
    expect(hrefs.length).toBeGreaterThan(0);
    // A favicon link to a missing file is invisible: the tab silently falls
    // back to the browser's blank page icon, which is what it did before.
    for (const href of hrefs) {
      expect(existsSync(join(root, 'public', href.replace(/^\//, '')))).toBe(true);
    }
    expect(hrefs).toContain('/favicon.ico');
  });

  it('draws the mark alone, never the wordmark', () => {
    // `blok-mark.png` is the creature without the "Blok" lettering. The
    // lettering is unreadable at 16px and turns the tab into a smudge, so the
    // served icon must be derived from the mark and not from `blok-logo.png`.
    const mark = readFileSync(join(root, '..', 'public', 'blok-mark.png'));
    expect(readFileSync(join(root, 'public', 'favicon-128x128.png')).equals(mark)).toBe(true);
  });
});
