import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf-8');

describe('playground boot', () => {
  // The editor is a short skeleton (or empty) while it loads, so a footer right under it shows, then jumps away when content lands.
  it('keeps the footer below the fold while the editor loads', () => {
    const rule = html.match(/(?:^|\n)\s*#tab-editor\s*\{([^}]*)\}/)?.[1] ?? '';
    const footer = html.indexOf('<footer class="playground-footer">');

    // The footer follows the tab panels, so the panel's height is what pushes it down.
    expect(html.indexOf('<div id="tab-editor"')).toBeLessThan(footer);

    expect(rule).toMatch(/min-height:\s*100dvh/);
  });
});
