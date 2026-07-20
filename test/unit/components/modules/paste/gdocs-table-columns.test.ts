import { describe, it, expect } from 'vitest';

import { preprocessGoogleDocsHtml } from '../../../../../src/components/modules/paste/google-docs-preprocessor';
import { COLUMNS_CANDIDATE_ATTR, SAFE_STRUCTURAL_TAGS } from '../../../../../src/components/modules/paste/constants';
import { clean, composeSanitizerConfig } from '../../../../../src/components/utils/sanitizer';
import { Table } from '../../../../../src/tools/table';
import type { SanitizerRule } from '../../../../../types/configs/sanitizer-config';

/** Wraps HTML in a Google Docs wrapper, as Google Docs does on copy */
const gdocs = (html: string): string => `<b id="docs-internal-guid-test">${html}</b>`;

const SINGLE_ROW_TABLE =
  '<table><tbody><tr>' +
  '<td><p><span>Left cell</span></p></td>' +
  '<td><p><span>Right cell</span></p></td>' +
  '</tr></tbody></table>';

const MULTI_ROW_TABLE =
  '<table><tbody>' +
  '<tr><td><p>A1</p></td><td><p>B1</p></td></tr>' +
  '<tr><td><p>A2</p></td><td><p>B2</p></td></tr>' +
  '</tbody></table>';

const SINGLE_CELL_TABLE =
  '<table><tbody><tr><td><p>Only cell</p></td></tr></tbody></table>';

const parse = (html: string): HTMLElement => {
  const wrapper = document.createElement('div');

  wrapper.innerHTML = html;

  return wrapper;
};

describe('preprocessGoogleDocsHtml — 2/3-column table columns candidate stamping', () => {
  it('stamps a single-row table with 2 columns as a columns candidate', () => {
    const result = parse(preprocessGoogleDocsHtml(gdocs(SINGLE_ROW_TABLE)));
    const table = result.querySelector('table');

    expect(table).not.toBeNull();
    expect(table?.hasAttribute(COLUMNS_CANDIDATE_ATTR)).toBe(true);
  });

  it('stamps a multi-row table with 2 columns as a columns candidate', () => {
    const result = parse(preprocessGoogleDocsHtml(gdocs(MULTI_ROW_TABLE)));
    const table = result.querySelector('table');

    expect(table).not.toBeNull();
    expect(table?.hasAttribute(COLUMNS_CANDIDATE_ATTR)).toBe(true);
  });

  it('stamps a multi-row table with 3 columns as a columns candidate', () => {
    const threeCol =
      '<table><tbody>' +
      '<tr><td><p>A1</p></td><td><p>B1</p></td><td><p>C1</p></td></tr>' +
      '<tr><td><p>A2</p></td><td><p>B2</p></td><td><p>C2</p></td></tr>' +
      '</tbody></table>';
    const result = parse(preprocessGoogleDocsHtml(gdocs(threeCol)));
    const table = result.querySelector('table');

    expect(table).not.toBeNull();
    expect(table?.hasAttribute(COLUMNS_CANDIDATE_ATTR)).toBe(true);
  });

  it('does NOT stamp a table with 4 columns', () => {
    const fourCol =
      '<table><tbody><tr>' +
      '<td><p>A</p></td><td><p>B</p></td><td><p>C</p></td><td><p>D</p></td>' +
      '</tr></tbody></table>';
    const result = parse(preprocessGoogleDocsHtml(gdocs(fourCol)));
    const table = result.querySelector('table');

    expect(table).not.toBeNull();
    expect(table?.hasAttribute(COLUMNS_CANDIDATE_ATTR)).toBe(false);
  });

  it('does NOT stamp a table whose rows have differing cell counts', () => {
    const ragged =
      '<table><tbody>' +
      '<tr><td><p>A1</p></td><td><p>B1</p></td></tr>' +
      '<tr><td><p>A2</p></td><td><p>B2</p></td><td><p>C2</p></td></tr>' +
      '</tbody></table>';
    const result = parse(preprocessGoogleDocsHtml(gdocs(ragged)));
    const table = result.querySelector('table');

    expect(table).not.toBeNull();
    expect(table?.hasAttribute(COLUMNS_CANDIDATE_ATTR)).toBe(false);
  });

  it('does NOT stamp a single-column multi-row table', () => {
    const singleColumn =
      '<table><tbody>' +
      '<tr><td><p>A1</p></td></tr>' +
      '<tr><td><p>A2</p></td></tr>' +
      '</tbody></table>';
    const result = parse(preprocessGoogleDocsHtml(gdocs(singleColumn)));
    const table = result.querySelector('table');

    expect(table).not.toBeNull();
    expect(table?.hasAttribute(COLUMNS_CANDIDATE_ATTR)).toBe(false);
  });

  it('does NOT stamp a single-row table with only one cell', () => {
    const result = parse(preprocessGoogleDocsHtml(gdocs(SINGLE_CELL_TABLE)));
    const table = result.querySelector('table');

    expect(table).not.toBeNull();
    expect(table?.hasAttribute(COLUMNS_CANDIDATE_ATTR)).toBe(false);
  });

  it('does NOT stamp tables outside a Google Docs wrapper', () => {
    const result = parse(preprocessGoogleDocsHtml(SINGLE_ROW_TABLE));
    const table = result.querySelector('table');

    expect(table).not.toBeNull();
    expect(table?.hasAttribute(COLUMNS_CANDIDATE_ATTR)).toBe(false);
  });

  it('does NOT stamp Google Sheets pastes (spreadsheet rows are tabular data, not layout)', () => {
    const sheets = `<b id="docs-internal-guid-test"><google-sheets-html-origin>${SINGLE_ROW_TABLE}</google-sheets-html-origin></b>`;
    const result = parse(preprocessGoogleDocsHtml(sheets));
    const table = result.querySelector('table');

    expect(table).not.toBeNull();
    expect(table?.hasAttribute(COLUMNS_CANDIDATE_ATTR)).toBe(false);
  });

  it('does NOT stamp a nested table inside a bigger table (only the outer one)', () => {
    const nested =
      '<table><tbody>' +
      '<tr><td>' + SINGLE_ROW_TABLE + '</td><td><p>B1</p></td></tr>' +
      '<tr><td><p>A2</p></td><td><p>B2</p></td></tr>' +
      '</tbody></table>';
    const result = parse(preprocessGoogleDocsHtml(gdocs(nested)));
    const outer = result.querySelector('table');
    const inner = outer?.querySelector('table');

    expect(outer?.hasAttribute(COLUMNS_CANDIDATE_ATTR)).toBe(true);
    expect(inner?.hasAttribute(COLUMNS_CANDIDATE_ATTR)).toBe(false);
  });

  it('converts stamped cell <p> boundaries to <br> so they survive sanitization', () => {
    // html-janitor unwraps nested block elements, so a <p> inside a <td> can
    // never reach the HTML handler. Paragraph boundaries ride as <br> instead
    // and the columns expansion splits cell content on them.
    const twoParagraphCell =
      '<table><tbody><tr>' +
      '<td><p><span>First para</span></p><p><span>Second para</span></p></td>' +
      '<td><p><span>Other cell</span></p></td>' +
      '</tr></tbody></table>';
    const result = parse(preprocessGoogleDocsHtml(gdocs(twoParagraphCell)));
    const stampedCell = result.querySelector(`table[${COLUMNS_CANDIDATE_ATTR}] td`);

    expect(stampedCell).not.toBeNull();
    expect(stampedCell?.querySelector('p')).toBeNull();
    expect(stampedCell?.querySelectorAll('br')).toHaveLength(1);
  });

  it('still converts <p> to <br> inside non-stamped (multi-row) table cells', () => {
    const result = parse(preprocessGoogleDocsHtml(gdocs(MULTI_ROW_TABLE)));
    const cell = result.querySelector('td');

    expect(cell?.querySelector('p')).toBeNull();
  });

  it('stamp survives the whole-document first-pass paste sanitizer', () => {
    // Mirrors the composition in Paste.getDataForHandler: structural tags with
    // empty attribute configs, then tool tags (the Table tool's pasteConfig)
    // composed last — the Table entry is what must carry the stamp whitelist.
    const structuralTagsConfig = Object.fromEntries(
      [...SAFE_STRUCTURAL_TAGS].map((tag) => [tag, {}])
    );

    const tablePasteConfig = Table.pasteConfig;
    const tablePasteTags = tablePasteConfig === false ? [] : tablePasteConfig.tags ?? [];
    const tableToolTags = Object.fromEntries(
      tablePasteTags.flatMap((tagOrConfig): Array<[string, SanitizerRule]> =>
        typeof tagOrConfig === 'string'
          ? [[tagOrConfig.toLowerCase(), {}]]
          : Object.entries(tagOrConfig).map(([tag, attrs]): [string, SanitizerRule] => [tag.toLowerCase(), attrs])
      )
    );

    const config = composeSanitizerConfig(
      {},
      structuralTagsConfig,
      tableToolTags,
      { br: {}, p: {} }
    );

    const preprocessed = preprocessGoogleDocsHtml(gdocs(SINGLE_ROW_TABLE));
    const cleaned = parse(clean(preprocessed, config));
    const table = cleaned.querySelector('table');

    expect(table).not.toBeNull();
    expect(table?.hasAttribute(COLUMNS_CANDIDATE_ATTR)).toBe(true);
  });
});
