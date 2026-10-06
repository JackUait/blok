/**
 * Excel puts cell formatting in <style> class rules, not on the cell.
 * No real Excel capture is in the repo: these fixtures follow Excel's
 * documented clipboard shape (.xl65 class rules, <font class=font6> runs).
 */
import { describe, expect, it } from 'vitest';

import {
  preprocessExcelClassStyles,
  wrapCellTextMarks,
} from '../../../../../src/components/modules/paste/excel-class-styles-preprocessor';
import { parseUntrustedHtml } from '../../../../../src/components/utils/inert-html';

const excel = (rules: string, body: string): string =>
  `<html><head><style><!--td {color:black;font-weight:400;}\n${rules}\n--></style></head><body><table>${body}</table></body></html>`;

const run = (html: string): HTMLElement => parseUntrustedHtml(preprocessExcelClassStyles(html));

const td = (root: HTMLElement): HTMLElement => {
  const cell = root.querySelector<HTMLElement>('td');

  if (cell === null) {
    throw new Error('no td');
  }

  return cell;
};

describe('preprocessExcelClassStyles', () => {
  it('turns class bold on a cell into <b> around its text', () => {
    expect(td(run(excel('.xl65 {font-weight:700;}', '<tr><td class=xl65>Bold</td></tr>'))).innerHTML).toBe('<b>Bold</b>');
  });

  it('copies class color, fill and alignment onto the cell style', () => {
    const cell = td(run(excel(
      '.xl66\n\t{mso-style-parent:style0;color:red;background:#FFFF00;mso-pattern:black none;text-align:center;vertical-align:middle;}',
      '<tr><td class=xl66>A</td></tr>',
    )));

    expect(cell.style.color).toBe('red');
    expect(cell.style.backgroundColor).toBe('rgb(255, 255, 0)');
    expect(cell.style.textAlign).toBe('center');
    expect(cell.style.verticalAlign).toBe('middle');
  });

  it('keeps the inline style when it sets the same property', () => {
    const cell = td(run(excel(
      '.xl67 {color:red;font-weight:700;background-color:yellow;}',
      "<tr><td class=xl67 style='color:blue;font-weight:400;background:green'>A</td></tr>",
    )));

    expect(cell.style.color).toBe('blue');
    expect(cell.style.backgroundColor).toBe('green');
    expect(cell.innerHTML).toBe('A');
  });

  it('wraps a <font class> run in marks', () => {
    const cell = td(run(excel(
      '.font6 {color:windowtext;font-size:11.0pt;font-weight:700;font-style:italic;}',
      '<tr><td>Normal <font class="font6">run</font></td></tr>',
    )));

    expect(cell.querySelector('b i, i b')?.textContent).toBe('run');
    expect(cell.innerHTML).not.toContain('windowtext');
  });

  it('wraps every line of a multi-line cell on its own', () => {
    const cell = td(run(excel('.xl65 {font-style:italic;text-decoration:underline line-through;}', '<tr><td class=xl65>a<br>b</td></tr>')));

    expect(cell.innerHTML).toBe('<i><u><s>a</s></u></i><br><i><u><s>b</s></u></i>');
  });

  describe('a mark rule on a table part or a wrapper', () => {
    const page = (rules: string, body: string): string =>
      `<html><head><style>${rules}</style></head><body>${body}</body></html>`;

    /** Re-parsed, as the next pass does: a <b> around a row is hoisted out of the table there. */
    const reparsed = (html: string): HTMLElement => parseUntrustedHtml(preprocessExcelClassStyles(html));

    const expectEveryCellBold = (root: HTMLElement): void => {
      const cells = Array.from(root.querySelectorAll('td'));

      expect(cells.map(cell => cell.innerHTML)).toEqual(cells.map(cell => `<b>${cell.textContent ?? ''}</b>`));
      expect(root.querySelector('b tr, b tbody, b table')).toBeNull();
      expect(Array.from(root.querySelectorAll('b')).filter(b => (b.textContent ?? '') === '')).toEqual([]);
    };

    it.each([
      ['a row', '<table><tr class=r><td>A</td><td>B</td></tr></table>'],
      ['the table', '<table class=r><tr><td>A</td><td>B</td></tr></table>'],
      ['a wrapper div', '<div class=r><table><tr><td>A</td><td>B</td></tr></table></div>'],
    ])('bolds the text of every cell for a rule on %s', (_label, body) => {
      expectEveryCellBold(reparsed(page('.r {font-weight:700;}', body)));
    });

    it('wraps a caption\'s text, not the caption', () => {
      const root = reparsed(page('.r {font-weight:700;}', '<table class=r><caption>Cap</caption><tr><td>A</td></tr></table>'));

      expect(root.querySelector('caption')?.innerHTML).toBe('<b>Cap</b>');
    });
  });

  it('removes the <style> block once its rules are applied', () => {
    expect(run(excel('.xl65 {font-weight:700;}', '<tr><td class=xl65>A</td></tr>')).querySelector('style')).toBeNull();
  });

  it('ignores selectors that are not a single class', () => {
    const html = excel(
      'p.MsoNormal {color:red;}\ntd.xl70 {color:red;}\n.a, .b {color:red;}\n.c .d {color:red;}\n@list l0 {color:red;}',
      '<tr><td class="MsoNormal xl70 a b c d">A</td></tr>',
    );

    expect(preprocessExcelClassStyles(html)).toBe(html);
  });

  it('drops values that could load something or break out of the declaration', () => {
    const cell = td(run(excel('.xl65 {background:url(https://x.test/a.png);color:expression(alert(1));}', '<tr><td class=xl65>A</td></tr>')));

    expect(cell.getAttribute('style') ?? '').toBe('');
  });

  it('returns the input untouched without a <style> block', () => {
    const html = '<table><tr><td class=xl65>A</td></tr></table>';

    expect(preprocessExcelClassStyles(html)).toBe(html);
  });
});

describe('preprocessExcelClassStyles rule reading', () => {
  const boldIn = (styleText: string): string =>
    td(run(`<html><head><style>${styleText}</style></head><body><table><tr><td class=a>A</td></tr></table></body></html>`)).innerHTML;

  it.each([
    ['a rule inside @media', '@media print { .a { font-weight:700 } }', '<b>A</b>'],
    ['a stray } before the rule', '} .a {font-weight:700}', '<b>A</b>'],
    ['an unclosed { after the rule', '.a {font-weight:700} .b {color:red', '<b>A</b>'],
    ['an unclosed rule before it swallows it', '.b {color:red .a {font-weight:700}', 'A'],
    ['braces inside a comment', '/* { } */ .a {font-weight:700}', '<b>A</b>'],
    ['an empty rule body', '.a {} .a {font-style:italic}', '<i>A</i>'],
    ['two rules for one class merge', '.a {font-weight:700} .a {font-style:italic}', '<b><i>A</i></b>'],
    ['an unclosed comment hides the rest', '.a {font-weight:700} /* .a {font-style:italic}', '<b>A</b>'],
  ])('reads %s', (_label, styleText, expected) => {
    expect(boldIn(styleText)).toBe(expected);
  });

  // A hostile clipboard must not freeze the tab. Each shape never completes a match.
  it.each([
    ['no brace at all', 'a'.repeat(200_000)],
    ['a rule that never closes', `.a {${'b'.repeat(200_000)}`],
    ['many comments that never close', '/*a'.repeat(66_000)],
  ])('reads a 200k <style> with %s in linear time', (_label, styleText) => {
    const html = `<html><head><style>${styleText}</style></head><body><table><tr><td class=a>A</td></tr></table></body></html>`;
    const start = performance.now();

    preprocessExcelClassStyles(html);

    expect(performance.now() - start).toBeLessThan(200);
  });
});

describe('wrapCellTextMarks', () => {
  it('reads a 200k declaration string in linear time', () => {
    const cell = parseUntrustedHtml('A');
    const start = performance.now();

    wrapCellTextMarks(cell, 'text-decoration:'.repeat(12_500));

    expect(performance.now() - start).toBeLessThan(200);
  });

  it('reads each mark from its own declaration', () => {
    const cell = parseUntrustedHtml('A');

    wrapCellTextMarks(cell, 'font-weight: 700 !important; font-style: oblique; text-decoration-line: underline line-through');

    expect(cell.innerHTML).toBe('<b><i><u><s>A</s></u></i></b>');
  });

  it('wraps inline runs inside block children, not around them', () => {
    const cell = parseUntrustedHtml('<p>one</p><p>two</p>');

    wrapCellTextMarks(cell, 'font-weight:bold');

    expect(cell.innerHTML).toBe('<p><b>one</b></p><p><b>two</b></p>');
  });

  it('does nothing for normal weight and style', () => {
    const cell = parseUntrustedHtml('A');

    wrapCellTextMarks(cell, 'font-weight:400;font-style:normal;text-decoration:none');

    expect(cell.innerHTML).toBe('A');
  });
});
