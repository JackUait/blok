import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from '../../../../../src/migrate';
import type { OutputBlockData, OutputData } from '../../../../../types';
import { boot, viewTable, type Booted } from './roundtrip-harness';

// @editorjs/table saved shape: string cells, withHeadings, stretched.
const editorJs = (data: Record<string, unknown>): OutputData => ({
  blocks: [{ id: 't', type: 'table', data }] as OutputBlockData[],
});

const migrated = (data: Record<string, unknown>): { out: OutputData; lossy: unknown[] } => {
  const { data: out, report } = migrate(editorJs(data));

  return { out, lossy: report.lossyFields };
};

describe('migrate(): editor.js tables', () => {
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

  it('keeps withHeadings and stretched, and every cell child points at the table', () => {
    const { out, lossy } = migrated({ withHeadings: true, stretched: true, content: [['H1', 'H2'], ['a', 'b']] });
    const table = out.blocks.find(b => b.type === 'table');

    expect(table?.data, JSON.stringify(lossy)).toMatchObject({ withHeadings: true, stretched: true });

    // migrate() output is input data, still HTML.
    const view = viewTable(out, 0, { allowHtml: true });

    expect(view?.grid.flat().map(c => c.texts)).toEqual([['paragraph:H1'], ['paragraph:H2'], ['paragraph:a'], ['paragraph:b']]);
    const children = out.blocks.filter(b => b.type !== 'table');

    expect(children.every(b => b.parent === table?.id)).toBe(true);
  });

  it('a ragged row, <br> and &nbsp; cells survive migrate → editor → save', async () => {
    const { out } = migrated({ withHeadings: false, content: [['one<br>two', '&nbsp;', ''], ['only']] });

    booted = await boot(out);
    const saved = await booted.editor.save();
    const texts = (viewTable(saved)?.grid ?? []).flat().flatMap(c => c.texts).join(' | ');

    // A <br> line may become its own paragraph; the text must stay, in order.
    expect(texts).toMatch(/one.*two/);
    expect(texts).toContain('only');
  });

  it('stretched survives migrate → editor → save', async () => {
    const { out } = migrated({ withHeadings: true, stretched: true, content: [['H'], ['a']] });

    booted = await boot(out);
    const saved = await booted.editor.save();

    expect(viewTable(saved)).toMatchObject({ withHeadings: true, stretched: true });
  });
});
