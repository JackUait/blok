import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { SanitizerConfigBuilder } from '../../../../../src/components/modules/paste/sanitizer-config';
import type { BlockToolAdapter } from '../../../../../src/components/tools/block';
import type { ToolsCollection } from '../../../../../src/components/tools/collection';

/**
 * `sanitizeTable` allowlists `<img src>` so pasted table images survive, which
 * means re-parsing its output in the live document starts those image loads at
 * paste time — an attacker-chosen URL is fetched from the victim's browser.
 */
describe('sanitizeTable parses into an inert document', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an element that does not belong to the live document', () => {
    const builder = new SanitizerConfigBuilder(
      {} as unknown as ToolsCollection<BlockToolAdapter>,
      {}
    );
    const table = document.createElement('table');

    table.innerHTML = '<tr><td>cell</td></tr>';

    const sanitized = builder.sanitizeTable(table, { table: true,
      tr: true,
      td: true });

    expect(sanitized).not.toBeNull();
    expect(sanitized?.ownerDocument).not.toBe(document);
    expect(sanitized?.tagName.toLowerCase()).toBe('table');
  });
});
