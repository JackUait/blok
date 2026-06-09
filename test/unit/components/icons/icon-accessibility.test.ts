import { describe, it, expect } from 'vitest';
import * as Icons from '../../../../src/components/icons';

/**
 * Every icon is decorative — the host button carries the aria-label. Each
 * exported SVG must therefore be hidden from the accessibility tree and
 * unfocusable in IE/legacy-Edge (focusable="false").
 */
describe('icon accessibility attributes', () => {
  const iconEntries = Object.entries(Icons).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string'
  );

  it('exports at least one icon string', () => {
    expect(iconEntries.length).toBeGreaterThan(0);
  });

  it.each(iconEntries)('%s carries aria-hidden and focusable="false"', (_name, svg) => {
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain('focusable="false"');
  });

  it('buildIconColumnsCount output carries aria-hidden and focusable="false"', () => {
    const svg = Icons.buildIconColumnsCount(3);

    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain('focusable="false"');
  });
});
