import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  parseGenericHtmlTable,
  parseClipboardHtml
} from '../../../../src/tools/table/table-cell-clipboard';
import { DATA_ATTR } from '../../../../src/components/constants/data-attributes';

const cellText = (payload: ReturnType<typeof parseGenericHtmlTable>): string =>
  payload?.cells[0]?.[0]?.blocks
    .map((block) => block.data.text)
    .filter((text): text is string => typeof text === 'string')
    .join('') ?? '';

describe('table cell clipboard refuses unsafe URL schemes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('strips a javascript: href pasted inside a foreign table cell', () => {
    const payload = parseGenericHtmlTable(
      '<table><tr><td><a href="javascript:alert(1)">x</a></td></tr></table>'
    );

    expect(cellText(payload)).not.toContain('javascript:');
    expect(cellText(payload)).toContain('x');
  });

  it('keeps a safe href pasted inside a foreign table cell', () => {
    const payload = parseGenericHtmlTable(
      '<table><tr><td><a href="https://example.com">x</a></td></tr></table>'
    );

    expect(cellText(payload)).toContain('https://example.com');
  });

  it('strips a javascript: href from a forged data-blok-table-cells payload', () => {
    const forged = JSON.stringify([[{ blocks: [{ tool: 'paragraph',
      data: { text: '<a href="javascript:alert(1)">x</a>' } }] }]]);
    const payload = parseClipboardHtml(
      `<table ${DATA_ATTR.tableCells}='${forged}'><tr><td>x</td></tr></table>`
    );

    expect(cellText(payload)).not.toContain('javascript:');
  });
});

/**
 * `document.createRange()` anchors the parse in the LIVE document, so markup it
 * builds loads what it asks for — `<img src=x onerror>` runs before the cell's
 * own `clean()` ever sees it. The cell tree comes from `DOMParser`, so ranges
 * must be taken from that inert document instead.
 */
describe('table cell clipboard never parses against the live document', () => {
  it('takes no range from the live document while sanitizing a pasted cell', () => {
    const createRange = vi.spyOn(document, 'createRange');

    parseGenericHtmlTable(
      '<table><tr><td><span style="font-weight:700"><img src="x" onerror="alert(1)"></span>'
      + '<p>text</p></td></tr></table>'
    );

    expect(createRange).not.toHaveBeenCalled();
  });
});
