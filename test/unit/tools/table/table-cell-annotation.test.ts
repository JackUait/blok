import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clean } from '../../../../src/components/utils/sanitizer';
import { INLINE_TEXT_SANITIZE } from '../../../../src/shared/inline-text-sanitize';
import { parseCellContentToBlocks, serializeCellBlocksToHtml } from '../../../../src/tools/table/table-cell-paste';

const HINT = '<span data-blok-annotation="A quote with a <br> in it" data-blok-annotation-subtitle="Anna">the phrase</span>';

describe('a hint inside a table cell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('survives the cell content being split into blocks and joined back', () => {
    const html = `first line<br>see ${HINT} here`;
    const blocks = parseCellContentToBlocks(html);

    expect(blocks.map(block => ('text' in block.data ? block.data.text : null))).toEqual([ 'first line', `see ${HINT} here` ]);
    expect(serializeCellBlocksToHtml(blocks)).toBe(html);
  });

  it('is not split at a <br> written inside the hint text', () => {
    const [ block ] = parseCellContentToBlocks(`see ${HINT} here`);
    const host = document.createElement('div');

    host.innerHTML = clean('text' in block.data ? block.data.text : '', INLINE_TEXT_SANITIZE);

    expect(parseCellContentToBlocks(`see ${HINT} here`)).toHaveLength(1);
    expect(host.querySelector('span')?.getAttribute('data-blok-annotation')).toBe('A quote with a <br> in it');
  });
});
