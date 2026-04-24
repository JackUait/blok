import { describe, it, expect } from 'vitest';

import { preprocessGoogleDocsHtml } from '../../../../../src/components/modules/paste/google-docs-preprocessor';

/**
 * Regression tests derived from pasting the coffee latte-art Google Doc
 * (doc id 1rz6VEh1yu-Dvr8nZ3VnHHDqkL-QoeIx63SRmMkQ0bzQ). Structure: heading,
 * two paragraphs, sub-heading, numbered list, then a 3-column table whose
 * middle cell is a single image.
 *
 * The user reports:
 *   - styles look "weird" after paste (redundant <b> wrapper inside headings)
 *   - images in a table cell are lost and the table structure is broken
 */
describe('Google Docs paste — coffee doc regressions', () => {
  const FIXTURE = [
    '<meta charset="utf-8">',
    '<b style="font-weight:normal;" id="docs-internal-guid-abc">',
    '<h1 dir="ltr"><span style="font-size:20pt;font-weight:700;">Кодификатор</span></h1>',
    '<h2 dir="ltr"><span style="font-size:14pt;font-weight:700;">Оценка молока:</span></h2>',
    '<div dir="ltr" align="left"><table><tbody>',
    '<tr>',
    '<td><p dir="ltr"><span>Left cell</span></p></td>',
    '<td><p dir="ltr"><span><img src="https://lh3.googleusercontent.com/docsFoo" width="200" height="180" alt=""/></span></p></td>',
    '<td><p dir="ltr"><span>Right cell</span></p></td>',
    '</tr>',
    '</tbody></table></div>',
    '</b>',
  ].join('');

  it('keeps images inside their table cell — no table shredding', () => {
    /**
     * promoteImages previously walked up to the top-level ancestor (the
     * `<table>`) and split every ancestor around the image, destroying the
     * 3-column table into two 1-column halves. Images copied inside a table
     * must stay inside their cell.
     */
    const result = preprocessGoogleDocsHtml(FIXTURE);

    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${result}</div>`, 'text/html');
    const root = doc.body.firstChild as HTMLElement;

    const tables = root.querySelectorAll('table');
    const rows = root.querySelectorAll('tr');
    const cells = root.querySelectorAll('td');
    const topImgs = Array.from(root.children).filter((el) => el.tagName === 'IMG');

    expect(tables.length).toBe(1);
    expect(rows.length).toBe(1);
    expect(cells.length).toBe(3);
    // The image must stay inside a cell, not become a top-level sibling.
    expect(topImgs.length).toBe(0);
    expect(cells[1].querySelector('img')).not.toBeNull();
  });

  it('preserves <img> inside cell content through preprocessor', () => {
    /**
     * After preprocessing, the image must still be inside its original cell
     * wrapper so downstream table sanitization can keep it in place.
     */
    const result = preprocessGoogleDocsHtml(FIXTURE);
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${result}</div>`, 'text/html');
    const cells = doc.querySelectorAll('td');

    expect(cells.length).toBe(3);
    expect(cells[1].querySelector('img')?.getAttribute('src'))
      .toBe('https://lh3.googleusercontent.com/docsFoo');
  });

  it('does not double-bold heading content by wrapping spans in <b>', () => {
    /**
     * Google Docs writes headings as `<h1><span style="font-weight:700">...`.
     * Converting that span to `<b>` produces `<h1><b>...</b></h1>` which the
     * header tool saves as `<strong>...` inside already-bold heading text —
     * visibly doubling the weight and polluting saved data.
     */
    const result = preprocessGoogleDocsHtml(FIXTURE);

    // No <b> or <strong> should be nested directly inside heading tags.
    expect(result).not.toMatch(/<h1[^>]*>\s*<b>/);
    expect(result).not.toMatch(/<h2[^>]*>\s*<b>/);
    expect(result).not.toMatch(/<h1[^>]*>\s*<strong>/);
    expect(result).not.toMatch(/<h2[^>]*>\s*<strong>/);
  });
});
