// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openJsonSession } from '../../agent/harness';

import type { AgentError, AgentResult } from '../../../../types/agent';

const seed = { blocks: [{ id: 'p1', type: 'paragraph', data: { text: [{ text: 'Intro' }] } }] };

const errorOf = (result: AgentResult): AgentError => {
  if (result.ok) {
    throw new Error('Expected a failed batch');
  }

  return result.error;
};

const run = async (commands: unknown[]): Promise<AgentResult> => {
  const session = openJsonSession(structuredClone(seed));

  try {
    return await session.execute({ commands });
  } finally {
    session.close();
  }
};

const markdownBatch = [
  { name: 'block.insert', args: { ref: 'h', type: 'header', data: { level: 2, text: 'Plan' }, position: { after: 'p1' } } },
  { name: 'block.insert', args: { ref: 'intro', type: 'paragraph', data: { text: 'We ship in three steps.' }, position: { after: '$h' } } },
  { name: 'block.insert', args: { ref: 'b1', type: 'list', data: { style: 'unordered', text: 'Write the spec' }, position: { after: '$intro' } } },
  { name: 'block.insert', args: { ref: 'b2', type: 'list', data: { style: 'unordered', text: 'Build it' }, position: { after: '$b1' } } },
  { name: 'block.insert', args: { ref: 'b3', type: 'list', data: { style: 'unordered', text: 'Ship it' }, position: { after: '$b2' } } },
  { name: 'block.insert', args: { ref: 'code', type: 'code', data: { code: 'npm run build' }, position: { after: '$b3' } } },
  { name: 'text.format', args: { id: '$intro', range: 'all', set: { bold: true } } },
];

const columnsBatch = [
  { name: 'doc.setTitle', args: { title: 'Plan comparison' } },
  { name: 'block.insert', args: { type: 'column_list', data: { columnCount: 2 }, children: [
    { type: 'column', id: 'colA', children: [{ type: 'header', id: 'hA', data: { level: 2 } }] },
    { type: 'column', id: 'colB', children: [{ type: 'header', id: 'hB', data: { level: 2 } }] },
  ] } },
  { name: 'text.replace', args: { id: '$hA', with: 'Plan A' } },
  { name: 'text.replace', args: { id: '$hB', with: 'Plan B' } },
  { name: 'table.create', args: { parentId: '$colA', rows: 2, cols: 2, withHeadings: true, cells: [['Item', 'Cost'], ['Setup fee', '$1,200']] } },
  { name: 'table.create', args: { parentId: '$colB', rows: 2, cols: 2, withHeadings: true, cells: [['Item', 'Cost'], ['Setup fee', '$2,400']] } },
];

describe('a failed batch reports every problem it can find', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists the same misplaced ref in every command, and the code block missing its language', async () => {
    const error = errorOf(await run(markdownBatch));

    expect(error).toMatchObject({ code: 'INVALID_ARGS', commandIndex: 0 });
    expect(error.message).toMatch(/"ref" goes next to name and args/);
    const others = error.others ?? [];

    expect(others.filter(other => other.code === 'INVALID_ARGS').map(other => other.commandIndex)).toEqual([1, 2, 3, 4, 5]);
    expect(others).toContainEqual(expect.objectContaining({
      code: 'DATA_REJECTED', commandIndex: 5, message: expect.stringMatching(/missing required field "language"/),
    }));
    // A ref placed inside args still counts as declared: no "$h was not set" noise.
    expect(others.some(other => other.code === 'BLOCK_NOT_FOUND')).toBe(false);
    expect(error.message).toMatch(/6 more problems/);
  });

  it('keeps the first planning error and adds the later ref mistakes and every bad block data', async () => {
    const error = errorOf(await run(columnsBatch));

    expect(error).toMatchObject({
      code: 'BLOCK_NOT_FOUND', commandIndex: 2, path: '/commands/2/args/id',
    });
    expect(error.message).toMatch(/^"\$hA" is not a ref, but block "hA" exists\. Use "hA" without the "\$"\./);
    const others = error.others ?? [];

    expect(others.filter(other => other.code === 'BLOCK_NOT_FOUND').map(other => [other.commandIndex, other.path])).toEqual([
      [3, '/commands/3/args/id'], [4, '/commands/4/args/parentId'], [5, '/commands/5/args/parentId'],
    ]);
    const rejected = others.filter(other => other.code === 'DATA_REJECTED');

    expect(rejected.map(other => other.message)).toEqual([
      expect.stringMatching(/"column_list".*unknown field "columnCount"/),
      expect.stringMatching(/^Block "hA": missing required field "text"/),
      expect.stringMatching(/^Block "hB": missing required field "text"/),
    ]);
    expect(rejected.every(other => other.commandIndex === 1)).toBe(true);
  });

  it('collects every data rejection when planning succeeds', async () => {
    const error = errorOf(await run([
      { name: 'block.insert', args: { type: 'column_list', data: { columnCount: 2 }, children: [
        { type: 'column', children: [{ type: 'header', id: 'hA', data: { level: 2 } }] },
        { type: 'column', children: [{ type: 'header', id: 'hB', data: { level: 2 } }] },
      ] } },
    ]));

    expect(error).toMatchObject({ code: 'DATA_REJECTED', commandIndex: 0 });
    expect(error.message).toMatch(/unknown field "columnCount"/);
    expect((error.others ?? []).map(other => other.message)).toEqual([
      expect.stringMatching(/^Block "hA": missing required field "text"/),
      expect.stringMatching(/^Block "hB": missing required field "text"/),
    ]);
  });

  it('never names a minted block id for a spec that gave none', async () => {
    const error = errorOf(await run([
      { name: 'text.replace', args: { id: '$nope', with: 'x' } },
      { name: 'block.insert', args: { type: 'code', data: { code: 'x' } } },
    ]));

    const other = (error.others ?? []).find(item => item.code === 'DATA_REJECTED');

    expect(other?.message).toMatch(/^The new "code" block: missing required field "language"/);
    expect(other?.path).toBe('/commands/1/args/data');
  });

  it('does not read dollar amounts in table cells as refs', async () => {
    const error = errorOf(await run([
      { name: 'text.replace', args: { id: 'missing', with: 'x' } },
      { name: 'table.create', args: { rows: 1, cols: 2, cells: [['$99 / month', '$0']] } },
    ]));

    expect(error).toMatchObject({ code: 'BLOCK_NOT_FOUND', commandIndex: 0 });
    expect(error.others).toBeUndefined();
    expect(error.message).not.toMatch(/more problem/);
  });

  it('leaves a single-problem failure as it was', async () => {
    const error = errorOf(await run([{ name: 'block.update', args: { id: 'missing', data: { text: 'x' } } }]));

    expect(error).toEqual({
      code: 'BLOCK_NOT_FOUND', commandIndex: 0, path: '/commands/0/args/id', retryable: false,
      message: 'Block "missing" does not exist. Read the document for current ids.', details: { id: 'missing' },
    });
  });

  it('strips details from the extra problems and caps the list', async () => {
    const commands = Array.from({ length: 12 }, (_, index) => ({
      name: 'block.insert', args: { ref: `r${index}`, type: 'paragraph' },
    }));
    const error = errorOf(await run(commands));
    const others = error.others ?? [];

    expect(others.length).toBeLessThanOrEqual(8);
    others.forEach(other => expect(Object.keys(other).sort()).toEqual(['code', 'commandIndex', 'message', 'path']));
    expect(error.message).toMatch(/11 more problems/);
  });
});

// The pre-flight flags an undeclared "$ref" only in these fields. Each must really fail at planning time.
const REF_FIELDS: Array<[string, Record<string, unknown>, string]> = [
  ['doc.read', { rootId: '$zz' }, '/rootId'],
  ['doc.read', { ids: ['p1', '$zz'] }, '/ids/1'],
  ['doc.find', { rootId: '$zz' }, '/rootId'],
  ['markdown.export', { rootId: '$zz' }, '/rootId'],
  ['markdown.insert', { markdown: 'x', parentId: '$zz' }, '/parentId'],
  ['markdown.insert', { markdown: 'x', position: { after: '$zz' } }, '/position/after'],
  ['block.insert', { type: 'paragraph', parentId: '$zz' }, '/parentId'],
  ['block.insert', { type: 'paragraph', position: { before: '$zz' } }, '/position/before'],
  ['block.update', { id: '$zz', data: {} }, '/id'],
  ['block.delete', { id: '$zz' }, '/id'],
  ['block.move', { id: '$zz', position: 'end' }, '/id'],
  ['block.move', { id: 'p1', parentId: '$zz', position: 'end' }, '/parentId'],
  ['block.move', { id: 'p1', position: { after: '$zz' } }, '/position/after'],
  ['block.convert', { id: '$zz', type: 'header' }, '/id'],
  ['block.duplicate', { id: '$zz' }, '/id'],
  ['block.duplicate', { id: 'p1', position: { after: '$zz' } }, '/position/after'],
  ['text.insert', { id: '$zz', at: 0, text: 'x' }, '/id'],
  ['text.delete', { id: '$zz', range: 'all' }, '/id'],
  ['text.replace', { id: '$zz', with: 'x' }, '/id'],
  ['text.format', { id: '$zz', range: 'all', set: { bold: true } }, '/id'],
];

describe('an undeclared ref fails at planning time in every field the pre-flight scans', () => {
  it.each(REF_FIELDS)('%s %j', async (name, args, path) => {
    const error = errorOf(await run([{ name, args }]));

    expect(error).toMatchObject({ code: 'BLOCK_NOT_FOUND', commandIndex: 0, path: `/commands/0/args${path}` });
  });
});
