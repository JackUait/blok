import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clean } from '../../../../../src/components/utils/sanitizer';
import { LEGACY_CELL_SANITIZE } from '../../../../../src/components/utils/data-model-transform';
import { parseCellContentToBlocks } from '../../../../../src/tools/table/table-cell-paste';
import { Table } from '../../../../../src/tools/table';
import { blocksToHtml } from '../../../../../src/view';
import type { OutputBlockData } from '../../../../../types';
import { boot, viewTable, type Booted } from './roundtrip-harness';

const tableContentRules = (Table.sanitize as { content: Record<string, unknown> }).content;

describe('which step drops legacy cell structure', () => {
  it('the parser alone keeps two <p> as two paragraphs', () => {
    expect(parseCellContentToBlocks('<p>first</p><p>second</p>').map(i => ('text' in i.data ? i.data.text : ''))).toEqual(['first', 'second']);
  });

  it('the parser alone splits a <div> line', () => {
    expect(parseCellContentToBlocks('one<div>two</div>').map(i => ('text' in i.data ? i.data.text : ''))).toEqual(['one', 'two']);
  });

  it('LEGACY_CELL_SANITIZE keeps the <div> boundary', () => {
    expect(clean('one<div>two</div>', LEGACY_CELL_SANITIZE as never)).toBe('one<div>two</div>');
  });

  it('Table.sanitize.content keeps the <div> boundary', () => {
    expect(clean('one<div>two</div>', tableContentRules as never)).toBe('one<div>two</div>');
  });

  it('Table.sanitize.content keeps <sub> and an equation span', () => {
    expect(clean('H<sub>2</sub>O <span data-latex="x^2">x^2</span>', tableContentRules as never))
      .toBe('H<sub>2</sub>O <span data-latex="x^2">x^2</span>');
  });

  it('widened cell rules add no attributes to <p>/<div>', () => {
    const dirty = '<p onclick="x()" style="color:red" class="c">a</p><div onmouseover="y()" style="position:fixed">b</div>';

    expect(clean(dirty, tableContentRules as never)).toBe('<p>a</p><div>b</div>');
    expect(clean(dirty, LEGACY_CELL_SANITIZE as never)).toBe('<p>a</p><div>b</div>');
  });

  it('LEGACY_CELL_SANITIZE keeps the <p> boundary', () => {
    expect(clean('<p>first</p><p>second</p>', LEGACY_CELL_SANITIZE as never)).toBe('<p>first</p><p>second</p>');
  });

  it('Table.sanitize.content keeps the <p> boundary', () => {
    expect(clean('<p>first</p><p>second</p>', tableContentRules as never)).toBe('<p>first</p><p>second</p>');
  });

  it('Table.sanitize.content keeps <sup>', () => {
    expect(clean('mc<sup>2</sup>', tableContentRules as never)).toBe('mc<sup>2</sup>');
  });

  it('LEGACY_CELL_SANITIZE keeps <sup> (the auto path is fine)', () => {
    expect(clean('mc<sup>2</sup>', LEGACY_CELL_SANITIZE as never)).toBe('mc<sup>2</sup>');
  });

  it('blocksToHtml with toolAttributes still carries cell colours', () => {
    const html = blocksToHtml({
      blocks: [
        { id: 't', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['a'], color: '#fbecdd', textColor: '#d9730d' }]] } },
        { id: 'a', type: 'paragraph', parent: 't', data: { text: 'A' } },
      ] as OutputBlockData[],
    }, { toolAttributes: true });

    expect(html).toMatch(/#fbecdd/i);
  });
});

// html-janitor drops an inline tag that wraps a block element. Losing the bold is fine; losing the text is not.
describe('an inline tag wrapping a block element in a legacy cell', () => {
  const cases = [['<b><p>x</p></b>', 'x'], ['<i><div>y</div></i>', 'y']] as const;
  const textOf = (html: string): string => html.replace(/<[^>]*>/g, '');

  for (const [html, text] of cases) {
    it(`LEGACY_CELL_SANITIZE keeps the text of ${html}`, () => {
      expect(textOf(clean(html, LEGACY_CELL_SANITIZE as never))).toBe(text);
    });

    it(`Table.sanitize.content keeps the text of ${html}`, () => {
      expect(textOf(clean(html, tableContentRules as never))).toBe(text);
    });
  }

  describe('real editor load + save', () => {
    let booted: Booted | null = null;

    beforeEach(() => {
      vi.clearAllMocks();
    });

    afterEach(() => {
      booted?.editor.destroy();
      booted?.holder.remove();
      booted = null;
      vi.restoreAllMocks();
    });

    for (const dataModel of ['auto', 'legacy'] as const) {
      for (const [html, text] of cases) {
        it(`dataModel ${dataModel}: ${html} keeps its text`, async () => {
          booted = await boot({
            blocks: [{ id: 't', type: 'table', data: { withHeadings: false, content: [[html, 'z']] } }] as OutputBlockData[],
          }, { dataModel });
          const out = await booted.editor.save();
          const cell = viewTable(out)?.grid[0]?.[0]?.texts.map(t => textOf(t.replace(/^[a-z]+:/, ''))).join('');

          expect(cell).toBe(text);
        });
      }
    }
  });
});
