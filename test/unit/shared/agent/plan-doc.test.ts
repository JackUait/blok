// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkEnvelope } from '../../../../src/shared/agent/envelope';
import { AgentFailure } from '../../../../src/shared/agent/errors';
import { planBatch } from '../../../../src/shared/agent/planner';
import { PREPARE_PENDING } from '../../../../src/shared/agent/plan-state';
import { DocSnapshot } from '../../../../src/shared/agent/snapshot';
import { coreCommandMap, plannerContext, planOn, stubPorts } from './fixtures';

import type { AgentPorts } from '../../../../src/shared/agent/types';
import type { AgentCommand, AgentWarning, OutputBlockData, OutputData } from '../../../../types';
import type { PageIcon } from '../../../../types/tools/page';

type PreparedMarkdown = Awaited<ReturnType<AgentPorts['markdownToBlocks']>>;

const doc: OutputData = {
  id: 'document',
  version: 'fixture',
  time: 8,
  title: 'Old',
  icon: { type: 'emoji', value: 'A' },
  blocks: [
    { id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] },
      tunes: { align: { side: 'left' } }, lastEditedAt: 8, lastEditedBy: 'human' },
    { id: 'container', type: 'toggle', data: { text: [{ text: 'Container' }] },
      tunes: { color: 'gray' }, content: ['first', 'nested'] },
    { id: 'nested', type: 'toggle', data: { text: [{ text: 'Nested' }] },
      parent: 'container', content: ['leaf'] },
    { id: 'leaf', type: 'paragraph', data: { text: [{ text: 'Leaf' }] }, parent: 'nested' },
    { id: 'first', type: 'paragraph', data: { text: [{ text: 'First' }] }, parent: 'container' },
    { id: 'outside', type: 'paragraph', data: { text: [{ text: 'Outside' }] } },
  ],
};

const forest: PreparedMarkdown = {
  blocks: [
    { id: 'p', type: 'toggle',
      data: { text: [{ text: 'Imported', marks: { bold: true } }], meta: { labels: ['kept'] } },
      tunes: { color: { background: 'gray' } }, content: ['md-first', 'md-nested'] },
    { id: 'md-nested', type: 'toggle', data: { text: [{ text: 'Imported nested' }] },
      parent: 'p', content: ['md-leaf'] },
    { id: 'md-leaf', type: 'paragraph', data: { text: [{ text: 'Imported leaf' }] }, parent: 'md-nested' },
    { id: 'md-first', type: 'paragraph', data: { text: [{ text: 'Imported first', marks: { italic: true } }] },
      tunes: { align: { side: 'right' } }, parent: 'p' },
    { id: 'md-tail', type: 'paragraph', data: { text: [{ text: 'Imported tail' }] } },
  ],
  warnings: [],
};

const single: PreparedMarkdown = {
  blocks: [{ id: 'md-one', type: 'paragraph', data: { text: [{ text: 'Imported' }] } }],
  warnings: [],
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const failOf = (run: () => unknown): AgentFailure['error'] => {
  try {
    run();
  } catch (error) {
    if (error instanceof AgentFailure) {
      return error.error;
    }
    throw error;
  }
  throw new Error('Expected an AgentFailure');
};

const blockOf = (output: OutputData, id: string): OutputBlockData => {
  const found = output.blocks.find(block => block.id === id);

  if (found === undefined) {
    throw new Error(`Missing output block "${id}"`);
  }

  return found;
};

const capturedDocument = (documents: OutputData[]): OutputData => {
  const captured = documents[0];

  if (captured === undefined) {
    throw new Error('The Markdown export port received no document');
  }

  return captured;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('document field planning', () => {
  it('sets a flat title without changing blocks, metadata or the caller', () => {
    const source = structuredClone(doc);
    const before = structuredClone(source);
    const commands: AgentCommand[] = [{ name: 'doc.setTitle', args: { title: 'New' } }];
    const commandsBefore = structuredClone(commands);
    const { plan, draft } = planOn(source, commands);
    const output = draft.toOutput();

    expect(output.title).toBe('New');
    expect(output).not.toHaveProperty('page');
    expect(output.icon).toEqual({ type: 'emoji', value: 'A' });
    expect(output.blocks).toEqual([
      before.blocks[0], before.blocks[1], before.blocks[4],
      before.blocks[2], before.blocks[3], before.blocks[5],
    ]);
    expect(output).toMatchObject({ id: 'document', version: 'fixture', time: 8 });
    expect(plan.edits).toEqual([{ op: 'setPageField', key: 'title', value: 'New' }]);
    expect(plan.results).toEqual([{}]);
    expect(plan.changed).toEqual({ created: [], updated: [], moved: [], removed: [] });
    expect([...plan.touched]).toEqual([]);
    expect(source).toEqual(before);
    expect(commands).toEqual(commandsBefore);
  });

  it('clears only the title with an empty string', () => {
    const { plan, draft } = planOn(doc, [{ name: 'doc.setTitle', args: { title: '' } }]);
    const output = draft.toOutput();

    expect(output).not.toHaveProperty('title');
    expect(output.icon).toEqual({ type: 'emoji', value: 'A' });
    expect(output).not.toHaveProperty('page');
    expect(plan.edits).toEqual([{ op: 'setPageField', key: 'title', value: '' }]);
    expect(plan.results).toEqual([{}]);
  });

  it.each([
    { label: 'embedded NUL', title: 'P\u0000lans', clean: 'Plans' },
    { label: 'NUL-only title', title: '\u0000', clean: '' },
  ])('normalizes a $label before the flat edit and subsequent export', ({ title, clean }) => {
    const source = structuredClone(doc);
    const before = structuredClone(source);
    const commands: AgentCommand[] = [
      { name: 'doc.setTitle', args: { title } },
      { name: 'markdown.export', args: {} },
    ];
    const commandsBefore = structuredClone(commands);
    const documents: OutputData[] = [];
    const { plan, draft } = planOn(source, commands, {
      ports: stubPorts({ blocksToMarkdown: output => {
        documents.push(output);

        return { markdown: 'Clean title', warnings: [] };
      } }),
    });
    const output = draft.toOutput();

    expect(output.title).toBe(clean === '' ? undefined : clean);
    expect(plan.edits).toEqual([{ op: 'setPageField', key: 'title', value: clean }]);
    expect(capturedDocument(documents)).toEqual(output);
    if (clean === '') {
      expect(output).not.toHaveProperty('title');
      expect(capturedDocument(documents)).not.toHaveProperty('title');
    }
    expect(output.icon).toEqual({ type: 'emoji', value: 'A' });
    expect(output).not.toHaveProperty('page');
    expect(plan.results).toEqual([{}, { markdown: 'Clean title' }]);
    expect(source).toEqual(before);
    expect(commands).toEqual(commandsBefore);
  });

  const normalizedIcons: Array<{ label: string; icon: PageIcon; clean: PageIcon }> = [
    { label: 'emoji', icon: { type: 'emoji', value: 'A\u0000B' }, clean: { type: 'emoji', value: 'AB' } },
    { label: 'image', icon: { type: 'image', url: 'https://example.test/i\u0000con.png' },
      clean: { type: 'image', url: 'https://example.test/icon.png' } },
    { label: 'NUL-only emoji', icon: { type: 'emoji', value: '\u0000' }, clean: { type: 'emoji', value: '' } },
    { label: 'NUL-only image', icon: { type: 'image', url: '\u0000' }, clean: { type: 'image', url: '' } },
  ];

  it.each(normalizedIcons)('normalizes a $label before the flat edit and subsequent export', ({ icon, clean }) => {
    const source = structuredClone(doc);
    const before = structuredClone(source);
    const commands: AgentCommand[] = [
      { name: 'doc.setIcon', args: { icon } },
      { name: 'markdown.export', args: {} },
    ];
    const commandsBefore = structuredClone(commands);
    const documents: OutputData[] = [];
    const { plan, draft } = planOn(source, commands, {
      ports: stubPorts({ blocksToMarkdown: output => {
        documents.push(output);

        return { markdown: 'Clean icon', warnings: [] };
      } }),
    });
    const output = draft.toOutput();

    expect(output.icon).toEqual(clean);
    expect(plan.edits).toEqual([{ op: 'setPageField', key: 'icon', value: clean }]);
    expect(capturedDocument(documents)).toEqual(output);
    expect(output.title).toBe('Old');
    expect(output).not.toHaveProperty('page');
    expect(plan.results).toEqual([{}, { markdown: 'Clean icon' }]);
    expect(icon).toEqual(commandsBefore[0]?.args.icon);
    expect(output.icon).not.toBe(icon);
    expect(source).toEqual(before);
    expect(commands).toEqual(commandsBefore);
  });

  const icons: Array<{ label: string; icon: PageIcon }> = [
    { label: 'emoji', icon: { type: 'emoji', value: 'B' } },
    { label: 'image', icon: { type: 'image', url: 'https://example.test/icon.png' } },
    { label: 'empty emoji', icon: { type: 'emoji', value: '' } },
    { label: 'empty image', icon: { type: 'image', url: '' } },
  ];

  it.each(icons)('sets a flat $label icon without mutating its input', ({ icon }) => {
    const source = structuredClone(doc);
    const sourceBefore = structuredClone(source);
    const commands: AgentCommand[] = [{ name: 'doc.setIcon', args: { icon } }];
    const commandsBefore = structuredClone(commands);
    const { plan, draft } = planOn(source, commands);
    const output = draft.toOutput();

    expect(output.icon).toEqual(icon);
    expect(output.title).toBe('Old');
    expect(output).not.toHaveProperty('page');
    expect(plan.edits).toEqual([{ op: 'setPageField', key: 'icon', value: icon }]);
    expect(plan.results).toEqual([{}]);
    expect(plan.changed).toEqual({ created: [], updated: [], moved: [], removed: [] });
    expect([...plan.touched]).toEqual([]);
    expect(output.icon).not.toBe(icon);
    expect(source).toEqual(sourceBefore);
    expect(commands).toEqual(commandsBefore);
  });

  it('clears only the icon with null', () => {
    const { plan, draft } = planOn(doc, [{ name: 'doc.setIcon', args: { icon: null } }]);
    const output = draft.toOutput();

    expect(output).not.toHaveProperty('icon');
    expect(output.title).toBe('Old');
    expect(output).not.toHaveProperty('page');
    expect(plan.edits).toEqual([{ op: 'setPageField', key: 'icon', value: null }]);
    expect(plan.results).toEqual([{}]);
  });

  const invalidTitles: Array<{ label: string; args: Record<string, unknown> }> = [
    { label: 'missing', args: {} },
    { label: 'null', args: { title: null } },
    { label: 'number', args: { title: 7 } },
    { label: 'object', args: { title: { text: 'No' } } },
  ];

  it.each(invalidTitles)('rejects a $label title at the public envelope boundary', ({ args }) => {
    const ctx = plannerContext();
    const snapshot = DocSnapshot.fromOutput(doc);
    const before = snapshot.toOutput();
    const error = failOf(() => {
      const checked = checkEnvelope({ commands: [{ name: 'doc.setTitle', args }] }, coreCommandMap(), ctx.validate);

      return planBatch({ snapshot, batch: checked.batch, ctx, stamp: { actorId: 'agent', at: 1 }, warnings: [] });
    });

    expect(error).toMatchObject({ code: 'INVALID_ARGS', commandIndex: 0 });
    expect(snapshot.toOutput()).toEqual(before);
  });

  const invalidIcons: Array<{ label: string; icon: unknown }> = [
    { label: 'undefined', icon: undefined },
    { label: 'number', icon: 7 },
    { label: 'string', icon: 'B' },
    { label: 'array', icon: [] },
    { label: 'missing emoji value', icon: { type: 'emoji' } },
    { label: 'non-string emoji value', icon: { type: 'emoji', value: 7 } },
    { label: 'missing image URL', icon: { type: 'image' } },
    { label: 'non-string image URL', icon: { type: 'image', url: null } },
    { label: 'unknown kind', icon: { type: 'other', value: 'B' } },
  ];

  it.each(invalidIcons)('rejects a $label icon inside planning', ({ icon }) => {
    expect(failOf(() => planOn(doc, [
      { name: 'doc.setTitle', args: { title: 'Earlier' } },
      { name: 'doc.setIcon', args: { icon } },
    ]))).toMatchObject({ code: 'INVALID_ARGS', commandIndex: 1, path: '/commands/1/args/icon' });
    expect(doc.title).toBe('Old');
    expect(doc.icon).toEqual({ type: 'emoji', value: 'A' });
  });
});

describe('Markdown insertion planning', () => {
  it('adds a fresh-ID forest in canonical content order and preserves stored data and tunes', () => {
    const source = structuredClone(doc);
    const sourceBefore = structuredClone(source);
    const snapshot = DocSnapshot.fromOutput(source);
    const snapshotBefore = snapshot.toOutput();
    const converted = structuredClone(forest);
    const convertedBefore = structuredClone(converted);
    const commands: AgentCommand[] = [{
      name: 'markdown.insert', args: { markdown: 'converted in preparation', position: { after: 'p' } },
    }];
    const commandsBefore = structuredClone(commands);
    const { plan, draft } = planBatch({
      snapshot, batch: { commands },
      ctx: plannerContext({ prepared: new Map<number, unknown>([[0, converted]]) }),
      stamp: { actorId: 'agent', at: 1 }, warnings: [],
    });

    expect(draft.childrenOf('n1')).toEqual(['n2', 'n3']);
    expect(draft.childrenOf('n3')).toEqual(['n4']);
    expect(draft.childrenOf(null)).toEqual(['p', 'n1', 'n5', 'container', 'outside']);
    expect(plan.results).toEqual([{ ids: ['n1', 'n5'] }]);
    expect(draft.toOutput().blocks.map(block => block.id)).toEqual([
      'p', 'n1', 'n2', 'n3', 'n4', 'n5', 'container', 'first', 'nested', 'leaf', 'outside',
    ]);
    expect(draft.get('n1')?.data).toEqual({
      text: [{ text: 'Imported', marks: { bold: true } }], meta: { labels: ['kept'] },
    });
    expect(draft.get('n1')?.tunes).toEqual({ color: { background: 'gray' } });
    expect(draft.get('n2')?.data).toEqual({ text: [{ text: 'Imported first', marks: { italic: true } }] });
    expect(draft.get('n2')?.tunes).toEqual({ align: { side: 'right' } });
    expect(draft.get('n2')?.parent).toBe('n1');
    expect(draft.get('n3')?.parent).toBe('n1');
    expect(draft.get('n4')?.parent).toBe('n3');
    expect(draft.get('n5')?.parent).toBeNull();
    expect(blockOf(draft.toOutput(), 'p')).toEqual(blockOf(snapshotBefore, 'p'));
    expect(draft.toOutput().blocks.filter(block => block.id !== undefined && snapshot.has(block.id)))
      .toEqual(snapshotBefore.blocks);
    expect(plan.changed).toEqual({
      created: ['n1', 'n2', 'n3', 'n4', 'n5'], updated: [], moved: [], removed: [],
    });
    expect([...plan.touched]).toEqual(['n1', 'n2', 'n3', 'n4', 'n5']);
    expect(draft.toOutput()).toMatchObject({ title: 'Old', icon: { type: 'emoji', value: 'A' } });
    expect(plan.edits.map(edit => edit.op)).toEqual(['insert', 'insert']);
    expect(plan.warnings).toEqual([]);
    expect(snapshot.toOutput()).toEqual(snapshotBefore);
    expect(source).toEqual(sourceBefore);
    expect(commands).toEqual(commandsBefore);
    expect(converted).toEqual(convertedBefore);
  });

  it('remaps table cell references to fresh children without rewriting ordinary strings', () => {
    const converted: PreparedMarkdown = {
      blocks: [
        { id: 'md-table', type: 'table', data: {
          withHeadings: true, withHeadingColumn: false, label: 'p',
          content: [[
            { blocks: ['p'], placement: 'top-center' },
            { blocks: ['md-right'], placement: 'top-right' },
          ]],
        } },
        { id: 'p', type: 'paragraph', parent: 'md-table',
          data: { text: [{ text: 'Left', marks: { bold: true } }] } },
        { id: 'md-right', type: 'paragraph', parent: 'md-table',
          data: { text: [{ text: 'Right', marks: { italic: true } }] } },
      ],
      warnings: [],
    };
    const before = structuredClone(converted);
    const source = structuredClone(doc);
    const sourceBefore = structuredClone(source);
    const { plan, draft } = planOn(source, [{ name: 'markdown.insert', args: { markdown: 'prepared table' } }], {
      prepared: new Map<number, unknown>([[0, converted]]),
    });

    expect(draft.get('n1')?.data.content).toEqual([[
      { blocks: ['n2'], placement: 'top-center' },
      { blocks: ['n3'], placement: 'top-right' },
    ]]);
    expect(draft.get('n1')?.data).toMatchObject({
      withHeadings: true, withHeadingColumn: false, label: 'p',
    });
    expect(draft.childrenOf('n1')).toEqual(['n2', 'n3']);
    expect(draft.parentOf('n2')).toBe('n1');
    expect(draft.parentOf('n3')).toBe('n1');
    expect(draft.cellOf('n2')).toEqual({ tableId: 'n1', row: 0, col: 0 });
    expect(draft.cellOf('n3')).toEqual({ tableId: 'n1', row: 0, col: 1 });
    expect(draft.get('n2')?.data.text).toEqual([{ text: 'Left', marks: { bold: true } }]);
    expect(draft.get('n3')?.data.text).toEqual([{ text: 'Right', marks: { italic: true } }]);
    expect(plan.results).toEqual([{ ids: ['n1'] }]);
    expect(plan.changed.created).toEqual(['n1', 'n2', 'n3']);
    expect(blockOf(draft.toOutput(), 'p')).toEqual(blockOf(DocSnapshot.fromOutput(sourceBefore).toOutput(), 'p'));
    expect(converted).toEqual(before);
    expect(source).toEqual(sourceBefore);
  });

  it('gives omitted and empty converter IDs fresh identities without losing an identified parent child', () => {
    const converted: PreparedMarkdown = {
      blocks: [
        { type: 'paragraph', data: { text: [{ text: 'Unnamed root' }] } },
        { id: 'md-parent', type: 'toggle', data: { text: [{ text: 'Parent' }] }, content: ['md-named'] },
        { type: 'paragraph', data: { text: [{ text: 'Unnamed child' }] }, parent: 'md-parent' },
        { id: 'md-named', type: 'paragraph', data: { text: [{ text: 'Named child' }] }, parent: 'md-parent' },
        { id: '', type: 'paragraph', data: { text: [{ text: 'Empty-ID root' }] } },
      ],
      warnings: [],
    };
    const before = structuredClone(converted);
    const { plan, draft } = planOn(doc, [{ name: 'markdown.insert', args: { markdown: 'prepared' } }], {
      prepared: new Map<number, unknown>([[0, converted]]),
    });

    expect(['n1', 'n2', 'n3', 'n4', 'n5'].map(id => draft.get(id)?.data.text)).toEqual([
      [{ text: 'Unnamed root' }], [{ text: 'Parent' }], [{ text: 'Named child' }],
      [{ text: 'Unnamed child' }], [{ text: 'Empty-ID root' }],
    ]);
    expect(plan.results).toEqual([{ ids: ['n1', 'n2', 'n5'] }]);
    expect(draft.childrenOf('n2')).toEqual(['n3', 'n4']);
    expect(draft.parentOf('n4')).toBe('n2');
    expect(draft.childrenOf(null)).toEqual(['p', 'container', 'outside', 'n1', 'n2', 'n5']);
    expect(plan.changed.created).toEqual(['n1', 'n2', 'n3', 'n4', 'n5']);
    expect(converted).toEqual(before);
  });

  it('promotes imported orphan and self-parent roots without losing descendants or adopting destination parents', () => {
    const converted: PreparedMarkdown = {
      blocks: [
        { id: 'md-orphan', type: 'toggle', parent: 'container',
          data: { text: [{ text: 'Orphan' }] }, content: ['md-orphan-child'] },
        { id: 'md-orphan-child', type: 'paragraph', parent: 'md-orphan',
          data: { text: [{ text: 'Orphan child' }] } },
        { id: 'md-self', type: 'toggle', parent: 'md-self',
          data: { text: [{ text: 'Self parent' }] }, content: ['md-self', 'md-self-child'] },
        { id: 'md-self-child', type: 'paragraph', parent: 'md-self',
          data: { text: [{ text: 'Self child' }] } },
      ],
      warnings: [],
    };
    const before = structuredClone(converted);
    const { plan, draft } = planOn(doc, [{ name: 'markdown.insert', args: { markdown: 'prepared' } }], {
      prepared: new Map<number, unknown>([[0, converted]]),
    });

    expect(draft.parentOf('n1')).toBeNull();
    expect(draft.parentOf('n3')).toBeNull();
    expect(draft.childrenOf('n1')).toEqual(['n2']);
    expect(draft.childrenOf('n3')).toEqual(['n4']);
    expect(draft.get('n2')?.data.text).toEqual([{ text: 'Orphan child' }]);
    expect(draft.get('n4')?.data.text).toEqual([{ text: 'Self child' }]);
    expect(draft.childrenOf('container')).toEqual(['first', 'nested']);
    expect(plan.results).toEqual([{ ids: ['n1', 'n3'] }]);
    expect(converted).toEqual(before);
  });

  it('ignores duplicate, stale and foreign content references and appends omitted children in flat order', () => {
    const converted: PreparedMarkdown = {
      blocks: [
        { id: 'md-left', type: 'toggle', data: { text: [{ text: 'Left' }] },
          content: ['md-second', 'md-second', 'gone', 'md-foreign'] },
        { id: 'md-first', type: 'paragraph', parent: 'md-left', data: { text: [{ text: 'First' }] } },
        { id: 'md-second', type: 'paragraph', parent: 'md-left', data: { text: [{ text: 'Second' }] } },
        { id: 'md-right', type: 'toggle', data: { text: [{ text: 'Right' }] } },
        { id: 'md-foreign', type: 'paragraph', parent: 'md-right', data: { text: [{ text: 'Foreign' }] } },
      ],
      warnings: [],
    };
    const before = structuredClone(converted);
    const { plan, draft } = planOn(doc, [{ name: 'markdown.insert', args: { markdown: 'prepared' } }], {
      prepared: new Map<number, unknown>([[0, converted]]),
    });

    expect(draft.childrenOf('n1').map(id => draft.get(id)?.data.text)).toEqual([
      [{ text: 'Second' }], [{ text: 'First' }],
    ]);
    expect(draft.childrenOf('n1')).toEqual(['n2', 'n3']);
    expect(draft.childrenOf('n4')).toEqual(['n5']);
    expect(draft.parentOf('n5')).toBe('n4');
    expect(plan.results).toEqual([{ ids: ['n1', 'n4'] }]);
    expect(converted).toEqual(before);
  });

  const invalidForests: Array<{ label: string; blocks: OutputBlockData[] }> = [
    { label: 'duplicate non-empty converter IDs', blocks: [
      { id: 'md-same', type: 'toggle', data: { text: [{ text: 'First' }] } },
      { id: 'md-same', type: 'paragraph', data: { text: [{ text: 'Second' }] } },
    ] },
    { label: 'a parent cycle beside a valid root', blocks: [
      { id: 'md-a', type: 'toggle', data: {}, parent: 'md-b', content: ['md-b'] },
      { id: 'md-b', type: 'toggle', data: {}, parent: 'md-a', content: ['md-a'] },
      { id: 'md-root', type: 'paragraph', data: { text: [{ text: 'Independent root' }] } },
    ] },
  ];

  it.each(invalidForests)('rejects $label as an attributed failure without mutating inputs', ({ blocks }) => {
    const converted: PreparedMarkdown = { blocks, warnings: [] };
    const convertedBefore = structuredClone(converted);
    const snapshot = DocSnapshot.fromOutput(doc);
    const snapshotBefore = snapshot.toOutput();
    const commands: AgentCommand[] = [
      { name: 'doc.setTitle', args: { title: 'Earlier' } },
      { name: 'markdown.insert', args: { markdown: 'prepared' } },
    ];
    const commandsBefore = structuredClone(commands);

    expect(failOf(() => planBatch({
      snapshot, batch: { commands },
      ctx: plannerContext({ prepared: new Map<number, unknown>([[1, converted]]) }),
      stamp: { actorId: 'agent', at: 1 }, warnings: [],
    }))).toMatchObject({ code: 'INVALID_ARGS', commandIndex: 1 });
    expect(snapshot.toOutput()).toEqual(snapshotBefore);
    expect(commands).toEqual(commandsBefore);
    expect(converted).toEqual(convertedBefore);
  });

  const placements: Array<{
    label: string; args: Record<string, unknown>; parentId: string | null; order: string[];
  }> = [
    { label: 'default root end', args: {}, parentId: null, order: ['p', 'container', 'outside', 'n1'] },
    { label: 'root start', args: { parentId: null, position: 'start' }, parentId: null,
      order: ['n1', 'p', 'container', 'outside'] },
    { label: 'before a root', args: { position: { before: 'outside' } }, parentId: null,
      order: ['p', 'container', 'n1', 'outside'] },
    { label: 'inferred child parent', args: { position: { after: 'first' } }, parentId: 'container',
      order: ['first', 'n1', 'nested'] },
    { label: 'child start', args: { parentId: 'container', position: 'start' }, parentId: 'container',
      order: ['n1', 'first', 'nested'] },
    { label: 'default child end', args: { parentId: 'container' }, parentId: 'container',
      order: ['first', 'nested', 'n1'] },
  ];

  it.each(placements)('places converted roots at $label', ({ args, parentId, order }) => {
    const { plan, draft } = planOn(doc, [{
      name: 'markdown.insert', args: { markdown: 'prepared', ...args },
    }], { prepared: new Map<number, unknown>([[0, structuredClone(single)]]) });

    expect(draft.childrenOf(parentId)).toEqual(order);
    expect(draft.parentOf('n1')).toBe(parentId);
    expect(plan.results).toEqual([{ ids: ['n1'] }]);
  });

  it('keeps an empty converted forest additive', () => {
    const { plan, draft } = planOn(doc, [{ name: 'markdown.insert', args: { markdown: '' } }], {
      prepared: new Map<number, unknown>([[0, { blocks: [], warnings: [] } satisfies PreparedMarkdown]]),
    });

    expect(draft.toOutput()).toEqual(DocSnapshot.fromOutput(doc).toOutput());
    expect(plan.results).toEqual([{ ids: [] }]);
    expect(plan.edits).toEqual([]);
    expect(plan.changed).toEqual({ created: [], updated: [], moved: [], removed: [] });
  });

  it('keeps degradation warnings once, replacing a stale command index without mutating preparation', () => {
    const converted: PreparedMarkdown = {
      blocks: structuredClone(single.blocks),
      warnings: [{ code: 'MARKDOWN_DEGRADED', message: 'HTML kept as literal text', commandIndex: 99, field: 'text' }],
    };
    const before = structuredClone(converted);
    const { warnings } = planOn(doc, [
      { name: 'doc.setTitle', args: { title: 'Earlier' } },
      { name: 'markdown.insert', args: { markdown: 'prepared' } },
    ], { prepared: new Map<number, unknown>([[1, converted]]) });

    expect(warnings).toEqual([
      { code: 'MARKDOWN_DEGRADED', message: 'HTML kept as literal text', commandIndex: 1, field: 'text' },
    ]);
    expect(converted).toEqual(before);
  });

  it('uses block-data preparation and preserves its attributed warnings', () => {
    const converted: PreparedMarkdown = {
      blocks: [{ id: 'md-toggle', type: 'toggle', data: { text: [{ text: 'Kept' }], label: 'dirty' },
        tunes: { color: 'gray' } }],
      warnings: [{ code: 'MARKDOWN_DEGRADED', message: 'A construct degraded' }],
    };
    const before = structuredClone(converted);
    const { draft, warnings } = planOn(doc, [
      { name: 'doc.setTitle', args: { title: 'Earlier' } },
      { name: 'markdown.insert', args: { markdown: 'prepared' } },
    ], {
      prepared: new Map<number, unknown>([[1, converted]]),
      ports: stubPorts({ sanitizeBlockData: (_type, data) => ({ ...data, label: 'clean' }) }),
    });

    expect(draft.get('n1')?.data).toEqual({ text: [{ text: 'Kept' }], label: 'clean' });
    expect(draft.get('n1')?.tunes).toEqual({ color: 'gray' });
    expect(warnings).toHaveLength(2);
    expect(warnings).toContainEqual({ code: 'MARKDOWN_DEGRADED', message: 'A construct degraded', commandIndex: 1 });
    expect(warnings).toContainEqual(expect.objectContaining({
      code: 'SANITIZED', commandIndex: 1, blockId: 'n1', field: 'label',
    }));
    expect(converted).toEqual(before);
  });

  const invalidPreparation: Array<{ label: string; value: unknown }> = [
    { label: 'null result', value: null },
    { label: 'missing blocks', value: { warnings: [] } },
    { label: 'non-array blocks', value: { blocks: 'wrong', warnings: [] } },
    { label: 'non-record block', value: { blocks: [null], warnings: [] } },
    { label: 'non-string type', value: { blocks: [{ id: 'md', type: 7, data: {} }], warnings: [] } },
    { label: 'non-string converter ID', value: { blocks: [{ id: 7, type: 'paragraph', data: {} }], warnings: [] } },
    { label: 'null data', value: { blocks: [{ id: 'md', type: 'paragraph', data: null }], warnings: [] } },
    { label: 'array data', value: { blocks: [{ id: 'md', type: 'paragraph', data: [] }], warnings: [] } },
    { label: 'non-record tunes', value: { blocks: [{ id: 'md', type: 'paragraph', data: {}, tunes: 7 }], warnings: [] } },
    { label: 'non-string parent', value: { blocks: [{ id: 'md', type: 'paragraph', data: {}, parent: 7 }], warnings: [] } },
    { label: 'non-string child ID', value: { blocks: [{ id: 'md', type: 'toggle', data: {}, content: [7] }], warnings: [] } },
    { label: 'non-array content', value: { blocks: [{ id: 'md', type: 'toggle', data: {}, content: {} }], warnings: [] } },
    { label: 'missing warnings', value: { blocks: [] } },
    { label: 'non-array warnings', value: { blocks: [], warnings: 7 } },
    { label: 'non-record warning', value: { blocks: [], warnings: [null] } },
    { label: 'non-string warning message', value: { blocks: [], warnings: [{ code: 'MARKDOWN_DEGRADED', message: 7 }] } },
    { label: 'non-string warning code', value: { blocks: [], warnings: [{ code: 7, message: 'loss' }] } },
    { label: 'unknown string warning code', value: { blocks: [], warnings: [{ code: 'NOT_A_WARNING', message: 'loss' }] } },
    { label: 'non-number warning command index', value: { blocks: [], warnings: [{ code: 'MARKDOWN_DEGRADED', message: 'loss', commandIndex: 'wrong' }] } },
    { label: 'non-string warning block ID', value: { blocks: [], warnings: [{ code: 'MARKDOWN_DEGRADED', message: 'loss', blockId: 7 }] } },
    { label: 'non-string warning field', value: { blocks: [], warnings: [{ code: 'MARKDOWN_DEGRADED', message: 'loss', field: 7 }] } },
  ];

  it.each(invalidPreparation)('rejects $label through the planner rather than throwing a host error', ({ value }) => {
    const snapshot = DocSnapshot.fromOutput(doc);
    const before = snapshot.toOutput();

    expect(failOf(() => planBatch({
      snapshot, batch: { commands: [
        { name: 'doc.setTitle', args: { title: 'Earlier' } },
        { name: 'markdown.insert', args: { markdown: 'prepared' } },
      ] },
      ctx: plannerContext({ prepared: new Map<number, unknown>([[1, value]]) }),
      stamp: { actorId: 'agent', at: 1 }, warnings: [],
    }))).toMatchObject({ code: 'INVALID_ARGS', commandIndex: 1 });
    expect(snapshot.toOutput()).toEqual(before);
  });
});

describe('pending Markdown preparation', () => {
  const preparationStates: Array<{ label: string; prepared: ReadonlyMap<number, unknown> }> = [
    { label: 'PREPARE_PENDING', prepared: new Map<number, unknown>([[0, PREPARE_PENDING]]) },
    { label: 'absent preparation', prepared: new Map<number, unknown>() },
    { label: 'explicit undefined', prepared: new Map<number, unknown>([[0, undefined]]) },
  ];

  it.each(preparationStates)('checks $label placement without converting, allocating or writing placeholder blocks', ({ prepared }) => {
    const markdownToBlocks = vi.fn<AgentPorts['markdownToBlocks']>(() => {
      throw new Error('Conversion belongs to async preparation');
    });
    const newId = vi.fn<AgentPorts['newId']>(() => {
      throw new Error('Pending Markdown must not allocate blocks');
    });
    const sanitizeBlockData = vi.fn<AgentPorts['sanitizeBlockData']>(() => {
      throw new Error('Pending Markdown has no converted data to sanitize');
    });
    const { plan, draft } = planOn(doc, [{
      name: 'markdown.insert', args: { markdown: 'not converted yet', parentId: 'container', position: { after: 'first' } },
    }], {
      prepared,
      ports: stubPorts({ markdownToBlocks, newId, sanitizeBlockData }),
    });

    expect(plan.edits).toEqual([]);
    expect(plan.results).toEqual([{ ids: [] }]);
    expect(plan.changed).toEqual({ created: [], updated: [], moved: [], removed: [] });
    expect([...plan.touched]).toEqual([]);
    expect(plan.warnings).toEqual([]);
    expect(draft.toOutput()).toEqual(DocSnapshot.fromOutput(doc).toOutput());
    expect(markdownToBlocks).not.toHaveBeenCalled();
    expect(newId).not.toHaveBeenCalled();
    expect(sanitizeBlockData).not.toHaveBeenCalled();
  });

  it.each(preparationStates)('rejects a missing parent with $label preparation', ({ prepared }) => {
    expect(failOf(() => planOn(doc, [{
      name: 'markdown.insert', args: { markdown: 'pending', parentId: 'gone' },
    }], { prepared }))).toMatchObject({
      code: 'BLOCK_NOT_FOUND', commandIndex: 0, path: '/commands/0/args/parentId',
    });
  });

  const refusedPlaces: Array<{
    label: string; args: Record<string, unknown>; code: 'BLOCK_NOT_FOUND' | 'PLACEMENT_REFUSED'; path: string;
  }> = [
    { label: 'missing parent', args: { parentId: 'gone' }, code: 'BLOCK_NOT_FOUND', path: '/parentId' },
    { label: 'unresolved parent ref', args: { parentId: '$gone' }, code: 'BLOCK_NOT_FOUND', path: '/parentId' },
    { label: 'missing before anchor', args: { position: { before: 'gone' } }, code: 'BLOCK_NOT_FOUND', path: '/position/before' },
    { label: 'missing after anchor', args: { position: { after: 'gone' } }, code: 'BLOCK_NOT_FOUND', path: '/position/after' },
    { label: 'unresolved anchor ref', args: { position: { after: '$gone' } }, code: 'BLOCK_NOT_FOUND', path: '/position/after' },
    { label: 'anchor outside explicit parent', args: { parentId: 'container', position: { after: 'p' } },
      code: 'PLACEMENT_REFUSED', path: '/position' },
  ];

  it.each(refusedPlaces)('refuses a $label before conversion', ({ args, code, path }) => {
    expect(failOf(() => planOn(doc, [
      { name: 'doc.setTitle', args: { title: 'Earlier' } },
      { name: 'markdown.insert', args: { markdown: 'pending', ...args } },
    ], { prepared: new Map<number, unknown>([[1, PREPARE_PENDING]]) }))).toMatchObject({
      code, commandIndex: 1, path: `/commands/1/args${path}`,
    });
  });

  it('resolves earlier creation refs for pending parent and sibling placement', () => {
    const { plan, draft } = planOn(doc, [
      { name: 'block.insert', args: { type: 'toggle', parentId: 'container' }, ref: 'made' },
      { name: 'block.insert', args: { type: 'paragraph', parentId: '$made' }, ref: 'child' },
      { name: 'markdown.insert', args: { markdown: 'pending', parentId: '$made', position: { before: '$child' } } },
      { name: 'markdown.insert', args: { markdown: 'pending', parentId: 'container', position: { after: '$made' } } },
    ], { prepared: new Map<number, unknown>([[2, PREPARE_PENDING], [3, PREPARE_PENDING]]) });

    expect(plan.results.slice(2)).toEqual([{ ids: [] }, { ids: [] }]);
    expect(plan.refs).toEqual({ made: 'n1', child: 'n2' });
    expect(draft.childrenOf('container')).toEqual(['first', 'nested', 'n1']);
    expect(draft.childrenOf('n1')).toEqual(['n2']);
    expect(plan.changed.created).toEqual(['n1', 'n2']);
    expect(plan.edits).toHaveLength(2);
  });

  it('rejects a forward ref even when a later insert reserves that ID', () => {
    expect(failOf(() => planOn(doc, [
      { name: 'markdown.insert', args: { markdown: 'pending', parentId: '$later' } },
      { name: 'block.insert', args: { type: 'toggle', id: 'later-id' }, ref: 'later' },
    ], { prepared: new Map<number, unknown>([[0, PREPARE_PENDING]]) }))).toMatchObject({
      code: 'BLOCK_NOT_FOUND', commandIndex: 0, path: '/commands/0/args/parentId', details: { ref: 'later' },
    });
  });

  it('does not expose a pending Markdown forest as a single creation ref', () => {
    expect(failOf(() => planOn(doc, [{
      name: 'markdown.insert', args: { markdown: 'pending' }, ref: 'made',
    }], { prepared: new Map<number, unknown>([[0, PREPARE_PENDING]]) }))).toMatchObject({
      code: 'INVALID_ARGS', commandIndex: 0, path: '/commands/0/ref',
    });
  });
});

describe('Markdown export planning', () => {
  it('exports the whole current draft with flat fields and stamps port warnings once', () => {
    const documents: OutputData[] = [];
    const portWarnings: AgentWarning[] = [
      { code: 'MARKDOWN_DEGRADED', message: 'A mark degraded', commandIndex: 99, blockId: 'p', field: 'text' },
    ];
    const beforeWarnings = structuredClone(portWarnings);
    const { plan, draft } = planOn(doc, [
      { name: 'doc.setTitle', args: { title: 'Current' } },
      { name: 'doc.setIcon', args: { icon: { type: 'image', url: 'https://example.test/current.png' } } },
      { name: 'markdown.export', args: {} },
    ], {
      ports: stubPorts({ blocksToMarkdown: output => {
        documents.push(output);

        return { markdown: 'Markdown from the port', warnings: portWarnings };
      } }),
    });
    const exported = capturedDocument(documents);

    expect(exported.blocks.map(block => block.id)).toEqual(['p', 'container', 'first', 'nested', 'leaf', 'outside']);
    expect(exported).toMatchObject({
      id: 'document', version: 'fixture', time: 8, title: 'Current',
      icon: { type: 'image', url: 'https://example.test/current.png' },
    });
    expect(exported).not.toHaveProperty('page');
    expect(documents).toHaveLength(1);
    expect(plan.results[2]).toEqual({ markdown: 'Markdown from the port' });
    expect(plan.warnings).toEqual([
      { code: 'MARKDOWN_DEGRADED', message: 'A mark degraded', commandIndex: 2, blockId: 'p', field: 'text' },
    ]);
    expect(portWarnings).toEqual(beforeWarnings);
    expect(plan.edits.map(edit => edit.op)).toEqual(['setPageField', 'setPageField']);
    expect(plan.changed).toEqual({ created: [], updated: [], moved: [], removed: [] });
    expect([...plan.touched]).toEqual([]);
    expect(draft.toOutput()).toEqual(exported);
    expect(doc.title).toBe('Old');
  });

  it('exports only the selected root and descendants, detaching only the exported root', () => {
    const documents: OutputData[] = [];
    const { plan, draft } = planOn(doc, [{ name: 'markdown.export', args: { rootId: 'container' } }], {
      ports: stubPorts({ blocksToMarkdown: output => {
        documents.push(output);

        return { markdown: 'Scoped Markdown', warnings: [] };
      } }),
    });
    const exported = capturedDocument(documents);

    expect(exported.blocks.map(block => block.id)).toEqual(['container', 'first', 'nested', 'leaf']);
    expect(blockOf(exported, 'container').parent).toBeUndefined();
    expect(blockOf(exported, 'container').content).toEqual(['first', 'nested']);
    expect(blockOf(exported, 'first').parent).toBe('container');
    expect(blockOf(exported, 'nested').content).toEqual(['leaf']);
    expect(blockOf(exported, 'leaf').parent).toBe('nested');
    expect(blockOf(exported, 'container').tunes).toEqual({ color: 'gray' });
    expect(plan.results).toEqual([{ markdown: 'Scoped Markdown' }]);
    expect(plan.edits).toEqual([]);
    expect(plan.changed).toEqual({ created: [], updated: [], moved: [], removed: [] });
    expect(draft.toOutput()).toEqual(DocSnapshot.fromOutput(doc).toOutput());
  });

  it('detaches a nested export root while preserving its descendant links in the draft', () => {
    const documents: OutputData[] = [];
    const { draft } = planOn(doc, [{ name: 'markdown.export', args: { rootId: 'nested' } }], {
      ports: stubPorts({ blocksToMarkdown: output => {
        documents.push(output);

        return { markdown: 'Nested Markdown', warnings: [] };
      } }),
    });
    const exported = capturedDocument(documents);

    expect(blockOf(exported, 'nested').parent).toBeUndefined();
    expect(exported.blocks.map(block => block.id)).toEqual(['nested', 'leaf']);
    expect(blockOf(exported, 'nested').content).toEqual(['leaf']);
    expect(blockOf(exported, 'leaf').parent).toBe('nested');
    expect(draft.parentOf('nested')).toBe('container');
    expect(draft.childrenOf('container')).toEqual(['first', 'nested']);
  });

  it('resolves a creation ref before detaching the export root without changing inputs or aliasing the draft', () => {
    const source = structuredClone(doc);
    const sourceBefore = structuredClone(source);
    const snapshot = DocSnapshot.fromOutput(source);
    const snapshotBefore = snapshot.toOutput();
    const commands: AgentCommand[] = [
      { name: 'block.insert', args: {
        type: 'toggle', parentId: 'container', data: { text: [{ text: 'Created' }], meta: { label: 'kept' } },
        tunes: { color: { background: 'gray' } },
        children: [{ type: 'toggle', data: { text: 'Child' }, children: [{ type: 'paragraph', data: { text: 'Leaf' } }] }],
      }, ref: 'made' },
      { name: 'markdown.export', args: { rootId: '$made' } },
    ];
    const commandsBefore = structuredClone(commands);
    const documents: OutputData[] = [];
    const { plan, draft } = planBatch({
      snapshot, batch: { commands },
      ctx: plannerContext({ ports: stubPorts({ blocksToMarkdown: output => {
        documents.push(output);

        return { markdown: 'Created subtree', warnings: [] };
      } }) }),
      stamp: { actorId: 'agent', at: 1 }, warnings: [],
    });
    const exported = capturedDocument(documents);
    const draftBefore = draft.toOutput();

    expect(blockOf(exported, 'n1').parent).toBeUndefined();
    expect(exported.blocks.map(block => block.id)).toEqual(['n1', 'n2', 'n3']);
    expect(blockOf(exported, 'n1').content).toEqual(['n2']);
    expect(blockOf(exported, 'n2').parent).toBe('n1');
    expect(blockOf(exported, 'n2').content).toEqual(['n3']);
    expect(blockOf(exported, 'n3').parent).toBe('n2');
    expect(blockOf(exported, 'n1').data).toEqual({ text: [{ text: 'Created' }], meta: { label: 'kept' } });
    expect(blockOf(exported, 'n1').tunes).toEqual({ color: { background: 'gray' } });
    expect(plan.refs).toEqual({ made: 'n1' });
    expect(plan.results[1]).toEqual({ markdown: 'Created subtree' });
    expect(draft.parentOf('n1')).toBe('container');
    expect(plan.edits).toHaveLength(1);
    expect(source).toEqual(sourceBefore);
    expect(snapshot.toOutput()).toEqual(snapshotBefore);
    expect(commands).toEqual(commandsBefore);

    const root = blockOf(exported, 'n1');
    const meta = root.data.meta;
    const color = root.tunes?.color;

    if (!isRecord(meta) || !isRecord(color)) {
      throw new Error('The exported fixture lost its nested data or tune');
    }
    meta.label = 'changed';
    color.background = 'changed';
    root.parent = 'changed';
    exported.title = 'changed';
    expect(draft.toOutput()).toEqual(draftBefore);
    expect(source).toEqual(sourceBefore);
    expect(snapshot.toOutput()).toEqual(snapshotBefore);
    expect(commands).toEqual(commandsBefore);
  });

  it.each([
    { rootId: 'gone', details: { id: 'gone' } },
    { rootId: '$gone', details: { ref: 'gone' } },
  ])('rejects an unresolved export root $rootId before calling the port', ({ rootId, details }) => {
    const blocksToMarkdown = vi.fn<AgentPorts['blocksToMarkdown']>(() => {
      throw new Error('Unresolved roots must not reach the exporter');
    });

    expect(failOf(() => planOn(doc, [
      { name: 'doc.setTitle', args: { title: 'Earlier' } },
      { name: 'markdown.export', args: { rootId } },
    ], { ports: stubPorts({ blocksToMarkdown }) }))).toMatchObject({
      code: 'BLOCK_NOT_FOUND', commandIndex: 1, path: '/commands/1/args/rootId', details,
    });
    expect(blocksToMarkdown).not.toHaveBeenCalled();
  });
});
