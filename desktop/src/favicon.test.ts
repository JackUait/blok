import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');

describe('favicon', () => {
  it('declares the Blok mark, and every file it points at exists', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    const hrefs = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)].map((m) => m[1]!);
    expect(hrefs.length).toBeGreaterThan(0);
    // A favicon link to a missing file is invisible: the tab silently falls
    // back to the browser's blank page icon, which is what it did before.
    for (const href of hrefs) {
      expect(existsSync(join(root, 'public', href.replace(/^\//, '')))).toBe(true);
    }
    expect(hrefs).toContain('/favicon.ico');
  });
});
