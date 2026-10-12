// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDocumentAgentSession } from '../../../../src/shared/agent/document-session';
import { createHeadlessAgentSetup, loadStoredDocument } from '../../../../src/view/agent-runtime';
import { blocksToHtml } from '../../../../src/view/blocks-to-html';
import { blocksToPlainText } from '../../../../src/view/blocks-to-plain-text';

import type { LegacyCellContent } from '../../../../src/shared/table/types';
import type { OutputBlockData, OutputData } from '../../../../types/data-formats/output-data';
import type { RichText } from '../../../../types/rich-text';

type StoredSession = ReturnType<typeof createDocumentAgentSession>;
const sessions: StoredSession[] = [];

const openSession = (document: OutputData): StoredSession => {
  const setup = createHeadlessAgentSetup({ runtime: 'node' });
  const session = createDocumentAgentSession({
    document: loadStoredDocument(structuredClone(document), setup.richTextFieldsFor),
    tools: setup.tools,
    contract: setup.contract,
    ports: setup.ports,
    actor: { id: 'table-agent', name: 'Table agent', kind: 'agent' },
  });

  sessions.push(session);

  return session;
};

const storedTable = (cell: LegacyCellContent, children: OutputBlockData[] = []): OutputData => ({
  blocks: [
    {
      id: 'table-old', type: 'table',
      data: { withHeadings: false, withHeadingColumn: false, textSize: 'comfortable', content: [[cell]] },
      content: children.flatMap(block => typeof block.id === 'string' ? [block.id] : []),
    },
    ...children,
  ],
});

const tableOf = (output: OutputData): OutputBlockData => {
  const table = output.blocks.find(block => block.type === 'table');

  if (table === undefined) {
    throw new Error('Expected a saved table.');
  }

  return table;
};

const isArray = (value: unknown): value is unknown[] => Array.isArray(value);
const cellAt = (output: OutputData, row: number, col: number): unknown => {
  const content = tableOf(output).data.content;

  if (!isArray(content)) {
    throw new Error('Expected saved table rows.');
  }
  const cells = content[row];

  if (!isArray(cells)) {
    throw new Error('Expected a saved table row.');
  }

  return cells[col];
};

const insertions: Array<{
  name: 'table.insertRows' | 'table.insertColumns';
  oldRow: number;
  oldCol: number;
  preservedText: string;
  literalText: string;
  lastRow: number;
  lastCol: number;
}> = [
  {
    name: 'table.insertRows', oldRow: 1, oldCol: 0,
    preservedText: 'Added\nOld', literalText: '<b>x</b>\nmarked\nOld', lastRow: 2, lastCol: 0,
  },
  {
    name: 'table.insertColumns', oldRow: 0, oldCol: 1,
    preservedText: 'Added\tOld', literalText: '<b>x</b>\tmarked\tOld', lastRow: 0, lastCol: 2,
  },
];

const storedCases: Array<{ label: string; cell: LegacyCellContent; formatted: string }> = [
  { label: 'legacy-string cell', cell: '<strong>Old</strong>', formatted: '<strong>Old</strong>' },
  {
    label: 'blocks: [] with an HTML text mirror',
    cell: {
      blocks: [], id: 'col-old', rowId: 'row-old', text: '<strong>Old</strong>',
      color: 'red', textColor: 'green', placement: 'bottom-right',
    },
    formatted: '<strong>Old</strong>',
  },
  {
    label: 'dangling-child HTML fallback',
    cell: { blocks: ['missing-child'], id: 'col-old', rowId: 'row-old', text: '<i>Old</i>' },
    formatted: '<i>Old</i>',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  try {
    sessions.splice(0).forEach(session => session.close());
  } finally {
    vi.restoreAllMocks();
  }
});

describe.each(insertions)('$name in a stored headless document', insertion => {
  it.each(storedCases)('preserves $label text and formatting', async fixture => {
    const session = openSession(storedTable(fixture.cell));
    const result = await session.execute({ commands: [{
      name: insertion.name, args: { id: 'table-old', at: 0, cells: [['Added']] },
    }] });
    const saved = session.output();

    expect(blocksToPlainText(saved)).toBe(insertion.preservedText);
    expect(blocksToHtml(saved)).toContain(fixture.formatted);
    expect(result).toMatchObject({ ok: true });
    expect(tableOf(saved)).toMatchObject({
      id: 'table-old', data: { withHeadings: false, withHeadingColumn: false, textSize: 'comfortable' },
    });
    if (typeof fixture.cell !== 'string') {
      expect(cellAt(saved, insertion.oldRow, insertion.oldCol)).toMatchObject(fixture.cell);
    }
    expect(saved.blocks.some(block => block.id === 'missing-child')).toBe(false);
  });

  it('keeps a resolved child authoritative over a stale text mirror', async () => {
    const session = openSession(storedTable(
      { blocks: ['p-old'], id: 'col-old', rowId: 'row-old', text: '<i>Stale mirror</i>' },
      [{ id: 'p-old', type: 'paragraph', parent: 'table-old', data: { text: '<strong>Old</strong>' } }],
    ));
    const result = await session.execute({ commands: [{
      name: insertion.name, args: { id: 'table-old', at: 0, cells: [['Added']] },
    }] });
    const saved = session.output();

    expect(blocksToPlainText(saved)).toBe(insertion.preservedText);
    expect(blocksToHtml(saved)).toContain('<p><strong>Old</strong></p>');
    expect(blocksToHtml(saved)).not.toContain('Stale mirror');
    expect(result).toMatchObject({ ok: true });
    expect(cellAt(saved, insertion.oldRow, insertion.oldCol)).toMatchObject({
      blocks: ['p-old'], id: 'col-old', rowId: 'row-old',
    });
    expect(saved.blocks.find(block => block.id === 'p-old')).toMatchObject({
      id: 'p-old', type: 'paragraph', parent: 'table-old',
      data: { text: [{ text: 'Old', marks: { bold: true } }] },
    });
  });

  it('keeps HTML-looking action strings literal and preserves marked segments', async () => {
    const marked: RichText = [{ text: 'marked', marks: { bold: true, italic: true } }];
    const session = openSession(storedTable(
      { blocks: ['p-old'], id: 'col-old', rowId: 'row-old' },
      [{ id: 'p-old', type: 'paragraph', parent: 'table-old', data: { text: '<strong>Old</strong>' } }],
    ));
    const result = await session.execute({ commands: [{
      name: insertion.name,
      args: { id: 'table-old', at: 0, count: 2, cells: [['<b>x</b>'], [marked]] },
    }] });
    const saved = session.output();

    expect(blocksToPlainText(saved)).toBe(insertion.literalText);
    expect(blocksToHtml(saved)).toContain('<p>&lt;b&gt;x&lt;/b&gt;</p>');
    expect(blocksToHtml(saved)).toContain('<p><strong><i>marked</i></strong></p>');
    expect(result).toMatchObject({ ok: true });
    expect(saved.blocks.filter(block => block.type === 'paragraph' && block.id !== 'p-old').map(block => block.data.text)).toEqual([
      [{ text: '<b>x</b>' }],
      [{ text: 'marked', marks: { bold: true, italic: true } }],
    ]);
    expect(cellAt(saved, insertion.lastRow, insertion.lastCol)).toMatchObject({
      blocks: ['p-old'], id: 'col-old', rowId: 'row-old',
    });
  });
});

it('table.create keeps HTML-looking action strings literal and preserves marked segments', async () => {
  const marked: RichText = [{ text: 'marked', marks: { bold: true, italic: true } }];
  const session = openSession({ blocks: [] });
  const result = await session.execute({ commands: [{
    name: 'table.create', args: { rows: 1, cols: 2, cells: [['<b>x</b>', marked]] },
  }] });
  const saved = session.output();

  expect(blocksToPlainText(saved)).toBe('<b>x</b>\tmarked');
  expect(blocksToHtml(saved)).toContain('<p>&lt;b&gt;x&lt;/b&gt;</p>');
  expect(blocksToHtml(saved)).toContain('<p><strong><i>marked</i></strong></p>');
  expect(result).toMatchObject({ ok: true });
  const children = saved.blocks.filter(block => block.type === 'paragraph');

  expect(children.map(block => block.data.text)).toEqual([
    [{ text: '<b>x</b>' }],
    [{ text: 'marked', marks: { bold: true, italic: true } }],
  ]);
  expect(children.map(block => block.parent)).toEqual([tableOf(saved).id, tableOf(saved).id]);
});
