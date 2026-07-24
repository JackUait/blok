import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrate, migrateLegacyBlocks, LEGACY_GRAMMAR } from '../../../src/migrate';
import type { OutputBlockData, OutputData } from '../../../types';

/**
 * Root-cause verification for two of the migration surface's guarantees:
 *
 *   PURITY — with a caller-supplied `generateId`, migrating the same document
 *   twice must produce EQUAL output, across every legacy type (including the
 *   ones that mint ids for children: lists, containers, table cells). If any
 *   path still reaches an internal random generator, this goes red.
 *
 *   REPORT COMPLETENESS — every lossy field the grammar knows how to drop must
 *   reach `report.lossyFields`. Enforced mechanically: the number of `ctx.warn`
 *   call sites in the grammar source must equal the number of distinct reports
 *   this document produces, so a NEW warn added without report coverage fails.
 */

beforeEach(() => {
  vi.clearAllMocks();
  // Every case here migrates lossy fixtures; silence the default console sink so
  // a failing assertion can never leave console.warn mocked for the next test.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const counterIds = (): (() => string) => {
  let n = 0;

  return () => `id-${n++}`;
};

/** One fixture per grammar entry, chosen to hit every lossy branch. */
const FIXTURES: Record<string, OutputBlockData> = {
  list: {
    id: 'list-1',
    type: 'list',
    data: {
      style: 'ordered',
      meta: { start: 3, counterType: 'upper-roman' },
      items: [
        { content: 'First', items: [{ content: 'Nested A' }, { content: 'Nested B' }] },
        { content: 'Second' },
      ],
    },
  },
  checklist: {
    id: 'check-1',
    type: 'checklist',
    data: { items: [{ text: 'Done', checked: true }, 'bare string item'] },
  },
  linkTool: {
    id: 'link-1',
    type: 'linkTool',
    data: { link: 'https://example.com/a', meta: { title: 'T', site_name: 'Example' } },
  },
  toggleList: {
    id: 'tog-1',
    type: 'toggleList',
    data: {
      title: 'Toggle title',
      body: {
        blocks: [
          { id: 'inner-p', type: 'paragraph', data: { text: 'inside' } },
          { type: 'list', data: { style: 'unordered', items: [{ content: 'x' }, { content: 'y' }] } },
        ],
      },
    },
  },
  callout: {
    id: 'call-1',
    type: 'callout',
    data: { variant: 'warning', body: { blocks: [{ type: 'paragraph', data: { text: 'note body' } }] } },
  },
  image: {
    id: 'img-1',
    type: 'image',
    data: { file: { url: 'https://example.com/p.png' }, withBorder: true, withBackground: true, stretched: true },
  },
  quote: {
    id: 'quote-1',
    type: 'quote',
    data: { text: 'the body', caption: 'the author', alignment: 'center' },
  },
  table: {
    id: 'tab-1',
    type: 'table',
    data: { withHeadings: true, content: [['A', ''], ['B', 'C']] },
  },
  raw: { id: 'raw-1', type: 'raw', data: { html: '<div>markup</div>' } },
  warning: { id: 'warn-1', type: 'warning', data: { title: 'Heads up', message: 'be careful' } },
  attaches: {
    id: 'att-1',
    type: 'attaches',
    data: { file: { url: 'https://example.com/f.pdf', name: 'f.pdf', size: 1024 }, title: 'F' },
  },
};

/** A document containing one block of EVERY legacy type the grammar knows. */
const allTypesDocument = (): OutputData => ({
  time: 1,
  version: '1.0.0',
  // Ids stripped so every block exercises the minting path, not passthrough.
  blocks: Object.values(FIXTURES).map(({ id: _id, ...block }) => block),
});

describe('migration purity', () => {
  it('covers every grammar entry with a fixture (the document is exhaustive)', () => {
    expect(Object.keys(FIXTURES).sort()).toEqual(LEGACY_GRAMMAR.map((entry) => entry.legacyType).sort());
  });

  it('produces equal output for the same document twice, across every legacy type', () => {
    const first = migrateLegacyBlocks(allTypesDocument().blocks, { generateId: counterIds() });
    const second = migrateLegacyBlocks(allTypesDocument().blocks, { generateId: counterIds() });

    expect(first).toEqual(second);

    // Every MINTED id came from the caller's generator — no internal random
    // source leaked into any expansion path. (Ids already present in the input,
    // e.g. on a container's body blocks, are preserved rather than reminted.)
    const preserved = new Set(['inner-p']);
    const foreign = first
      .map((block) => String(block.id))
      .filter((id) => !id.startsWith('id-') && !preserved.has(id));

    expect(foreign, 'ids not traceable to the caller generator or the input').toEqual([]);
  });

  it('never reaches console.warn when the caller takes delivery of the report', () => {
    migrate(allTypesDocument(), { generateId: counterIds(), onLossyField: () => {} });

    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe('lossy-field report completeness', () => {
  const grammarSource = readFileSync(
    resolve(__dirname, '../../../src/components/migration/legacy-grammar.mjs'),
    'utf8'
  );

  it('surfaces every field the grammar can drop', () => {
    const { report } = migrate(allTypesDocument(), { generateId: counterIds() });

    expect(report.lossyFields).toEqual([
      { blockType: 'list', field: 'meta.counterType', verb: 'dropped' },
      { blockType: 'linkTool', field: 'site_name', verb: 'dropped' },
      { blockType: 'image', field: 'withBackground', verb: 'dropped' },
      { blockType: 'quote', field: 'alignment', verb: 'ignored' },
      { blockType: 'attaches', field: 'file metadata', verb: 'dropped' },
    ]);
  });

  it('has report coverage for every ctx.warn call site in the grammar (law)', () => {
    const callSites = grammarSource.match(/ctx\.warn\(/g) ?? [];

    const { report } = migrate(allTypesDocument(), { generateId: counterIds() });
    const distinct = new Set(report.lossyFields.map((entry) => `${entry.blockType}.${entry.field}`));

    expect(
      distinct.size,
      'a ctx.warn() call site has no fixture reaching it — add one to FIXTURES so the report stays exhaustive'
    ).toBe(callSites.length);
  });
});
