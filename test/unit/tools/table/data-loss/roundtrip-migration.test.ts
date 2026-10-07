import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutputBlockData, OutputData } from '../../../../../types';
import { migrate } from '../../../../../src/migrate';
import { boot, viewTable, type Booted } from './roundtrip-harness';
import type { HtmlReadOptions } from '../../../helpers/saved-as-html';

const cellTexts = (out: OutputData | undefined, options: HtmlReadOptions = {}): string[][] | undefined =>
  viewTable(out, 0, options)?.grid.map(row => row.map(cell => cell.texts.join(' | ')));

const editorJsTable = (cells: string[]): OutputData => ({
  blocks: [{ id: 't', type: 'table', data: { withHeadings: false, content: [cells] } }] as OutputBlockData[],
});

describe('editor.js string cells holding block markup', () => {
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
    it(`dataModel ${dataModel}: <p> paragraphs in a cell keep their boundary`, async () => {
      booted = await boot(editorJsTable(['<p>first</p><p>second</p>', 'x']), { dataModel });
      const out = await booted.editor.save();

      expect(cellTexts(out)?.[0][0]).not.toBe('paragraph:firstsecond');
      expect(cellTexts(out)?.[0][0]).toMatch(/first.*second/);
    });

    it(`dataModel ${dataModel}: <div> lines in a cell keep their boundary`, async () => {
      booted = await boot(editorJsTable(['one<div>two</div>', 'x']), { dataModel });
      const out = await booted.editor.save();

      expect(cellTexts(out)?.[0][0]).not.toBe('paragraph:onetwo');
    });

    it(`dataModel ${dataModel}: inline sup/sub formatting in a string cell survives`, async () => {
      booted = await boot(editorJsTable(['E = mc<sup>2</sup>', 'H<sub>2</sub>O']), { dataModel });
      const out = await booted.editor.save();

      expect(cellTexts(out)?.[0]).toEqual(['paragraph:E = mc<sup>2</sup>', 'paragraph:H<sub>2</sub>O']);
    });
  }

  it('migrate(): <p> paragraphs in a cell keep their boundary', () => {
    const result = migrate(editorJsTable(['<p>first</p><p>second</p>', 'x'])) as unknown as { data?: OutputData } & OutputData;
    const data = result.data ?? result;
    const texts = data.blocks.filter(b => b.type !== 'table').map(b => (b.data as { text?: string }).text);

    expect(texts).not.toContain('firstsecond');
  });
});
