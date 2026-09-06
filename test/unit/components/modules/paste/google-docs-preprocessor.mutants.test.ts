import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { preprocessGoogleDocsHtml } from '../../../../../src/components/modules/paste/google-docs-preprocessor';
import { COLUMNS_CANDIDATE_ATTR } from '../../../../../src/components/modules/paste/constants';
import { mapToNearestPresetColor } from '../../../../../src/components/utils/color-mapping';

/**
 * Clipboard HTML from Google Docs always arrives inside this wrapper, and the
 * preprocessor only runs its Docs-specific passes (image promotion, layout
 * table unwrapping, columns stamping, anchor colours) when it finds one.
 */
const gdocs = (html: string): string => `<b id="docs-internal-guid-test">${html}</b>`;

const parse = (html: string): HTMLElement => {
  const holder = document.createElement('div');

  holder.innerHTML = html;

  return holder;
};

const tableOf = (html: string): HTMLTableElement | null => parse(html).querySelector('table');

describe('preprocessGoogleDocsHtml — surviving-mutant coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('default light text detection (browser clipboard colours)', () => {
    /**
     * Every colour here sits on one side of the `luminance > 0.75` line that
     * decides whether a browser-copied colour is the page's own light text
     * (dropped) or the author's formatting (kept as a <mark>). The parser feeding
     * that number handles rgb/hsl/hex separately, so each format and each hue
     * branch needs its own witness: a wrong constant, a flipped comparison or a
     * dropped anchor in one of those regexes silently turns real formatting into
     * plain text, or paints every paragraph with the page's own colour.
     */
    const cases: Array<{ colour: string; light: boolean }> = [
      { colour: 'hsl(60, 80%, 45%)', light: true },
      { colour: 'hsl(30, 60%, 70%)', light: false },
      { colour: '#1ef', light: true },
      { colour: '#0f870f', light: false },
      { colour: 'hsl(205, 5%, 75%)', light: false },
      { colour: 'hsl(0,0%,75%)', light: false },
      { colour: 'hsl(245, 30%, 80%)', light: true },
      { colour: 'x#eee', light: false },
      { colour: '#00ff87', light: true },
      { colour: 'rgb(0, 0, 15)', light: false },
      { colour: '#eeex', light: false },
      { colour: 'hsl(0,0%,80%)', light: true },
      { colour: 'xhsl(0,0%,80%)', light: false },
      { colour: 'hsl(0,0%,80%)x', light: false },
      { colour: 'hsl(60, 90%, 0%)', light: false },
      { colour: 'rgb(0, 255, 135)', light: true },
      { colour: 'xrgb(255,255,255)', light: false },
      { colour: 'rgb(255,255,255)x', light: false },
    ];

    for (const { colour, light } of cases) {
      it(`${light ? 'drops' : 'keeps'} the colour of a browser span painted ${colour}`, () => {
        const result = preprocessGoogleDocsHtml(`<span style="color: ${colour}">tinted</span>`);

        expect(result.includes('<mark')).toBe(!light);
        expect(result).toContain('tinted');
      });
    }
  });

  describe('bold, italic and headings', () => {
    it('reads font-weight written with a space before the colon', () => {
      const result = preprocessGoogleDocsHtml(gdocs('<span style="font-weight : 700">weighted</span>'));

      expect(result).toContain('<b>');
    });

    it('reads font-style written with a space before the colon', () => {
      const result = preprocessGoogleDocsHtml(gdocs('<span style="font-style : italic">slanted</span>'));

      expect(result).toContain('<i>');
    });

    it('does not bold a font-weight span inside a heading', () => {
      const result = preprocessGoogleDocsHtml(gdocs('<h1><span style="font-weight:700">title</span></h1>'));

      expect(result).not.toContain('<b>');
      expect(result).toContain('title');
    });

    it('does not bold a font-weight span nested deep inside a heading', () => {
      const result = preprocessGoogleDocsHtml(gdocs('<h3><em><span style="font-weight:700">deep</span></em></h3>'));

      expect(result).not.toContain('<b>');
    });

    it('bolds a font-weight span that has no heading ancestor', () => {
      const result = preprocessGoogleDocsHtml(gdocs('<p><em><span style="font-weight:700">deep</span></em></p>'));

      expect(result).toContain('<b>');
    });

    it('leaves a span whose style carries no formatting untouched', () => {
      const result = preprocessGoogleDocsHtml('<span style="font-size: 16px">plain</span>');

      expect(result).toContain('<span');
      expect(result).toContain('plain');
    });

    it('merges neighbouring converted spans into one wrapper', () => {
      const result = preprocessGoogleDocsHtml(
        gdocs('<span style="font-weight:700">alpha</span><span style="font-weight:700">beta</span>')
      );

      expect(result).toBe('<b>alphabeta</b>');
    });
  });

  describe('colour values are trimmed before they are mapped', () => {
    it('maps a colour written with trailing whitespace to the same preset', () => {
      const result = preprocessGoogleDocsHtml(
        gdocs('<span style="color: #ff0000 ; background-color: #ffff00 ;">tinted</span>')
      );

      expect(result).toContain(`color: ${mapToNearestPresetColor('#ff0000', 'text')}`);
      expect(result).toContain(`background-color: ${mapToNearestPresetColor('#ffff00', 'bg')}`);
    });

    it('drops the colour of text that is entirely a link, whitespace included', () => {
      const result = preprocessGoogleDocsHtml(gdocs('<span style="color: #1155cc"><a href="https://a.test"> link </a></span>'));

      expect(result).not.toContain('<mark');
    });

    it('keeps the colour of a span that only partly overlaps a link', () => {
      const result = preprocessGoogleDocsHtml(
        gdocs('<span style="color: #d44c47">before<a href="https://a.test">link</a></span>')
      );

      expect(result).toContain('<mark');
    });
  });

  describe('anchor background colours', () => {
    const YELLOW_BG = mapToNearestPresetColor('#ffff00', 'bg');

    /**
     * A colour left behind on the `<a>` makes the pasted link render in the
     * source app's link colour instead of Blok's, and a background left there is
     * dropped outright: the sanitizer allows only href/target/rel on an anchor.
     */
    it('moves an anchor background into a mark and strips both colours from the anchor', () => {
      const result = preprocessGoogleDocsHtml(
        gdocs('<a href="https://a.test" style="color: #1155cc; background-color: #ffff00;">link</a>')
      );
      const anchor = parse(result).querySelector('a');

      expect(result).toContain(`<mark style="background-color: ${YELLOW_BG};">`);
      expect(anchor?.getAttribute('style')).toBe('');
    });

    it('reads an anchor background written without a space after the colon', () => {
      const result = preprocessGoogleDocsHtml(gdocs('<a href="https://a.test" style="background-color:#ffff00">link</a>'));

      expect(result).toContain(`<mark style="background-color: ${YELLOW_BG};">`);
    });

    it('reads an anchor background written with a space before the colon', () => {
      const result = preprocessGoogleDocsHtml(gdocs('<a href="https://a.test" style="background-color : #ffff00">link</a>'));

      expect(result).toContain(`<mark style="background-color: ${YELLOW_BG};">`);
    });

    it('trims an anchor background before mapping it', () => {
      const result = preprocessGoogleDocsHtml(gdocs('<a href="https://a.test" style="background-color: #ffff00 ;">link</a>'));

      expect(result).toContain(`<mark style="background-color: ${YELLOW_BG};">`);
    });

    it('leaves a transparent anchor background alone', () => {
      const result = preprocessGoogleDocsHtml(gdocs('<a href="https://a.test" style="background-color: transparent">link</a>'));

      expect(result).not.toContain('<mark');
    });

    it('leaves an inherited anchor background alone', () => {
      const result = preprocessGoogleDocsHtml(gdocs('<a href="https://a.test" style="background-color: inherit">link</a>'));

      expect(result).not.toContain('<mark');
    });

    it('does not touch anchor colours outside Google Docs content', () => {
      const result = preprocessGoogleDocsHtml('<a href="https://a.test" style="background-color: #ffff00">link</a>');

      expect(result).not.toContain('<mark');
    });
  });

  describe('image promotion out of nested wrappers', () => {
    it('splits every ancestor around an image in the middle of a paragraph', () => {
      const result = preprocessGoogleDocsHtml(
        gdocs('<div>head<p>alpha<img src="i.png">omega<b>beta</b></p>tail</div>')
      );

      expect(result).toBe('<div>head<p>alpha</p></div><img src="i.png"><div><p>omega<b>beta</b></p>tail</div>');
    });

    it('emits no empty half when the image starts its paragraph', () => {
      const result = preprocessGoogleDocsHtml(gdocs('<div><p><img src="j.png">omega</p>tail</div>'));

      expect(result).toBe('<img src="j.png"><div><p>omega</p>tail</div>');
    });

    it('emits no empty half when the image ends its paragraph', () => {
      const result = preprocessGoogleDocsHtml(gdocs('<div>head<p>alpha<img src="k.png"></p></div>'));

      expect(result).toBe('<div>head<p>alpha</p></div><img src="k.png">');
    });

    /**
     * Promoting a cell image splits every ancestor at the image boundary, which
     * for a table means cutting it into half-tables around the picture.
     */
    it('leaves an image inside a table cell in its cell', () => {
      const result = parse(preprocessGoogleDocsHtml(
        gdocs('<table><tbody><tr><td><p><img src="cell.png"></p></td><td><p>text</p></td></tr></tbody></table>')
      ));

      expect(result.querySelectorAll('td img')).toHaveLength(1);
      expect(result.querySelectorAll('table')).toHaveLength(1);
    });

    it('leaves an image nested deep inside a table cell in its cell', () => {
      const result = parse(preprocessGoogleDocsHtml(
        gdocs('<table><tbody><tr><td><div><p><span><img src="deep.png"></span></p></div></td><td><p>text</p></td></tr></tbody></table>')
      ));

      expect(result.querySelectorAll('td img')).toHaveLength(1);
      expect(result.querySelectorAll('table')).toHaveLength(1);
    });
  });

  describe('paragraphs inside table cells', () => {
    /**
     * Such a paragraph has empty text, so a spacer test that looks at text alone
     * deletes it and the image with it.
     */
    it('keeps a paragraph that holds only an image', () => {
      const result = preprocessGoogleDocsHtml(
        '<table><tbody><tr><td><p><img src="pic.png"></p><p>caption</p></td></tr></tbody></table>'
      );

      expect(result).toContain('<img src="pic.png">');
      expect(result).toContain('caption');
    });

    it('drops a whitespace-only spacer paragraph', () => {
      const result = preprocessGoogleDocsHtml(
        '<table><tbody><tr><td><p>a</p><p>&nbsp;</p><p>b</p></td></tr></tbody></table>'
      );
      const cell = parse(result).querySelector('td');

      expect(cell?.innerHTML).toBe('a<br>b');
    });

    it('leaves a cell that holds no paragraph untouched', () => {
      const result = preprocessGoogleDocsHtml('<table><tbody><tr><td>a<br></td></tr></tbody></table>');
      const cell = parse(result).querySelector('td');

      expect(cell?.innerHTML).toBe('a<br>');
    });
  });

  describe('columns candidate stamping', () => {
    it('stamps a single-row two-column table with an empty attribute value', () => {
      const table = tableOf(preprocessGoogleDocsHtml(
        gdocs('<table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>')
      ));

      expect(table?.getAttribute(COLUMNS_CANDIDATE_ATTR)).toBe('');
    });

    it('stamps a single-row two-column table built from header cells', () => {
      const table = tableOf(preprocessGoogleDocsHtml(
        gdocs('<table><tbody><tr><th>A</th><th>B</th></tr></tbody></table>')
      ));

      expect(table?.hasAttribute(COLUMNS_CANDIDATE_ATTR)).toBe(true);
    });

    it('stamps a single-row three-column table', () => {
      const table = tableOf(preprocessGoogleDocsHtml(
        gdocs('<table><tbody><tr><td>A</td><td>B</td><td>C</td></tr></tbody></table>')
      ));

      expect(table?.hasAttribute(COLUMNS_CANDIDATE_ATTR)).toBe(true);
    });

    /**
     * A row may legally hold a non-cell child (`<template>` is parser-allowed
     * inside `<tr>`). Counting it as a column inflates the column count, and a
     * three-column layout stops being a columns candidate: the paste arrives as
     * a table instead of side-by-side columns.
     */
    it('counts a row\'s cells, not every element the row holds', () => {
      const table = tableOf(preprocessGoogleDocsHtml(
        gdocs('<table><tbody><tr><template><td>hidden</td></template><td>A</td><td>B</td><td>C</td></tr></tbody></table>')
      ));

      expect(table?.hasAttribute(COLUMNS_CANDIDATE_ATTR)).toBe(true);
    });

    it('does not stamp a single-row four-column table', () => {
      const table = tableOf(preprocessGoogleDocsHtml(
        gdocs('<table><tbody><tr><td>A</td><td>B</td><td>C</td><td>D</td></tr></tbody></table>')
      ));

      expect(table?.hasAttribute(COLUMNS_CANDIDATE_ATTR)).toBe(false);
    });

    it('does not stamp a text-only multi-row two-column table', () => {
      const table = tableOf(preprocessGoogleDocsHtml(
        gdocs('<table><tbody><tr><td>A1</td><td>B1</td></tr><tr><td>A2</td><td>B2</td></tr></tbody></table>')
      ));

      expect(table?.hasAttribute(COLUMNS_CANDIDATE_ATTR)).toBe(false);
    });

    it('does not stamp a text-only multi-row three-column table', () => {
      const table = tableOf(preprocessGoogleDocsHtml(
        gdocs('<table><tbody><tr><td>A1</td><td>B1</td><td>C1</td></tr><tr><td>A2</td><td>B2</td><td>C2</td></tr></tbody></table>')
      ));

      expect(table?.hasAttribute(COLUMNS_CANDIDATE_ATTR)).toBe(false);
    });

    it('stamps a multi-row two-column table that holds an image', () => {
      const table = tableOf(preprocessGoogleDocsHtml(
        gdocs('<table><tbody><tr><td><img src="p1.png"></td><td>B1</td></tr><tr><td><img src="p2.png"></td><td>B2</td></tr></tbody></table>')
      ));

      expect(table?.hasAttribute(COLUMNS_CANDIDATE_ATTR)).toBe(true);
    });

    it('does not stamp a multi-row three-column table that holds an image', () => {
      const table = tableOf(preprocessGoogleDocsHtml(
        gdocs('<table><tbody><tr><td><img src="p1.png"></td><td>B1</td><td>C1</td></tr><tr><td>A2</td><td>B2</td><td>C2</td></tr></tbody></table>')
      ));

      expect(table?.hasAttribute(COLUMNS_CANDIDATE_ATTR)).toBe(false);
    });

    it('does not stamp a ragged table that holds an image', () => {
      const table = tableOf(preprocessGoogleDocsHtml(
        gdocs('<table><tbody><tr><td><img src="p1.png"></td><td>B1</td></tr><tr><td>A2</td><td>B2</td><td>C2</td></tr></tbody></table>')
      ));

      expect(table?.hasAttribute(COLUMNS_CANDIDATE_ATTR)).toBe(false);
    });

    /** Columns cannot live in a table cell, so a nested table is never a layout. */
    it('does not stamp a table nested inside another table', () => {
      const tables = parse(preprocessGoogleDocsHtml(gdocs(
        '<table><tbody><tr><td><table><tbody><tr><td>i1</td><td>i2</td></tr></tbody></table></td><td>outer</td></tr></tbody></table>'
      ))).querySelectorAll('table');

      expect(tables).toHaveLength(2);
      expect(tables[0].hasAttribute(COLUMNS_CANDIDATE_ATTR)).toBe(true);
      expect(tables[1].hasAttribute(COLUMNS_CANDIDATE_ATTR)).toBe(false);
    });

    it('counts only the table\'s own rows, not a nested table\'s rows', () => {
      const tables = parse(preprocessGoogleDocsHtml(gdocs(
        '<table><tbody><tr><td><table><tbody><tr><td>i1</td></tr><tr><td>i2</td></tr><tr><td>i3</td></tr></tbody></table></td><td>outer</td></tr></tbody></table>'
      ))).querySelectorAll('table');

      expect(tables).toHaveLength(2);
      expect(tables[0].hasAttribute(COLUMNS_CANDIDATE_ATTR)).toBe(true);
    });

    it('does not stamp anything in a Google Sheets paste', () => {
      const table = tableOf(preprocessGoogleDocsHtml(gdocs(
        '<google-sheets-html-origin></google-sheets-html-origin><table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>'
      )));

      expect(table?.hasAttribute(COLUMNS_CANDIDATE_ATTR)).toBe(false);
    });

    /** Every later step reads `rows[0]`, so a rowless table has to leave early. */
    it('leaves a table with no rows alone', () => {
      const result = parse(preprocessGoogleDocsHtml(
        gdocs('<table><caption><img src="cap.png"></caption></table>')
      ));

      expect(result.querySelectorAll('table')).toHaveLength(1);
      expect(result.querySelectorAll('img')).toHaveLength(1);
    });
  });

  describe('layout single-column tables', () => {
    it('unwraps a single-cell table into its content', () => {
      const result = parse(preprocessGoogleDocsHtml(
        gdocs('<table><tbody><tr><td><p>only cell</p></td></tr></tbody></table>')
      ));

      expect(result.querySelectorAll('table')).toHaveLength(0);
      expect(result.textContent).toContain('only cell');
    });

    it('unwraps a multi-row single-column table that holds an image', () => {
      const result = parse(preprocessGoogleDocsHtml(gdocs(
        '<table><tbody><tr><td><p><img src="photo.png"></p></td></tr><tr><td><p>caption</p></td></tr></tbody></table>'
      )));

      expect(result.querySelectorAll('table')).toHaveLength(0);
      expect(result.querySelectorAll('img')).toHaveLength(1);
    });

    it('keeps a text-only multi-row single-column table as a table', () => {
      const result = parse(preprocessGoogleDocsHtml(gdocs(
        '<table><tbody><tr><td><p>r1</p></td></tr><tr><td><p>r2</p></td></tr></tbody></table>'
      )));

      expect(result.querySelectorAll('table')).toHaveLength(1);
    });

    it('does not unwrap a single-cell table nested inside another table', () => {
      const result = parse(preprocessGoogleDocsHtml(gdocs(
        '<table><tbody><tr><td><table><tbody><tr><td>inner</td></tr></tbody></table></td><td>outer</td></tr></tbody></table>'
      )));

      expect(result.querySelectorAll('table')).toHaveLength(2);
    });

    it('does not unwrap a single-cell table in a Google Sheets paste', () => {
      const result = parse(preprocessGoogleDocsHtml(gdocs(
        '<google-sheets-html-origin></google-sheets-html-origin><table><tbody><tr><td>only cell</td></tr></tbody></table>'
      )));

      expect(result.querySelectorAll('table')).toHaveLength(1);
    });

    it('does not unwrap a ragged table that holds an image', () => {
      const result = parse(preprocessGoogleDocsHtml(gdocs(
        '<table><tbody><tr><td><img src="p1.png"></td></tr><tr><td>A2</td><td>B2</td></tr></tbody></table>'
      )));

      expect(result.querySelectorAll('table')).toHaveLength(1);
    });

    it('does not unwrap a layout table outside Google Docs content', () => {
      const result = parse(preprocessGoogleDocsHtml('<table><tbody><tr><td><p>only cell</p></td></tr></tbody></table>'));

      expect(result.querySelectorAll('table')).toHaveLength(1);
    });
  });
});
