// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkEnvelope } from '../../../../src/shared/agent/envelope';
import { AgentFailure } from '../../../../src/shared/agent/errors';
import { planBatch } from '../../../../src/shared/agent/planner';
import { richTextHelpers } from '../../../../src/shared/agent/rich-text-ops';
import { DocSnapshot } from '../../../../src/shared/agent/snapshot';
import { isRichText } from '../../../../src/shared/rich-text/guards';
import { plannerContext, planOn, stubPorts, TOOLS, tool } from './fixtures';

import type { PlannerContext } from '../../../../src/shared/agent/types';
import type { AgentCommand, AgentErrorCode, AgentWarning, OutputData, TextRangeRef } from '../../../../types';
import type { RichText } from '../../../../types/rich-text';

const doc: OutputData = { blocks: [
  { id: 'p', type: 'paragraph', data: { text: [{ text: 'Hello world' }] } },
  { id: 'dv', type: 'divider', data: {} },
  { id: 'opaque', type: 'unregistered', data: { text: [{ text: 'Unknown' }] } },
] };

const withText = (text: RichText): OutputData => ({
  blocks: [{ id: 'p', type: 'paragraph', data: { text } }],
});

const planTextOn = (
  input: OutputData,
  commands: AgentCommand[],
  over: Partial<PlannerContext> = {}
) => {
  const ctx = plannerContext(over);
  const { batch } = checkEnvelope({ commands }, ctx.commands, ctx.validate);

  return planOn(input, batch.commands, ctx);
};

const failOf = (operation: () => unknown): AgentFailure['error'] => {
  try {
    operation();
  } catch (error) {
    if (error instanceof AgentFailure) {
      return error.error;
    }

    throw error;
  }

  throw new Error('Expected an AgentFailure');
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('text command planning', () => {
  it('inserts canonical rich segments at a UTF-16 offset without flattening embeds or changing inputs', () => {
    const input: OutputData = { blocks: [
      {
        id: 'p', type: 'paragraph',
        data: { text: [
          { text: 'a😀', marks: { bold: true } },
          { embed: { page: { id: 'page-1' } }, marks: { link: { href: '/page', target: '_self', rel: 'author' } } },
          { text: '\nz' },
        ], legacy: { keep: true } },
        tunes: { align: { side: 'left' } }, content: ['child'],
      },
      { id: 'child', type: 'paragraph', data: { text: [{ text: 'Child' }] }, parent: 'p' },
    ] };
    const commands: AgentCommand[] = [{
      name: 'text.insert',
      args: { id: 'p', at: 3, text: [
        { text: '', marks: { italic: true } },
        { text: 'X', marks: { italic: true } },
        { text: '😀', marks: { italic: true } },
        { embed: { equation: { expression: 'x^2' } }, marks: { underline: true } },
        { embed: { html: '<img src="image.png">' }, marks: { link: { href: '/image' } } },
      ] },
    }];
    const before = structuredClone({ input, commands });
    const { draft, plan } = planTextOn(input, commands);

    const expected: RichText = [
      { text: 'a😀', marks: { bold: true } },
      { text: 'X😀', marks: { italic: true } },
      { embed: { equation: { expression: 'x^2' } }, marks: { underline: true } },
      { embed: { html: '<img src="image.png">' }, marks: { link: { href: '/image' } } },
      { embed: { page: { id: 'page-1' } }, marks: { link: { href: '/page', target: '_self', rel: 'author' } } },
      { text: '\nz' },
    ];

    expect(draft.get('p')?.data.text).toEqual(expected);
    expect(plan.results).toEqual([{ length: 5 }]);
    expect(plan.lastRange).toEqual({ blockId: 'p', field: 'text', start: 3, end: 8 });
    expect(plan.edits).toEqual([{ op: 'setRichText', id: 'p', field: 'text', value: expected }]);
    expect(draft.get('p')?.data.legacy).toEqual({ keep: true });
    expect(draft.get('p')?.tunes).toEqual({ align: { side: 'left' } });
    expect(draft.childrenOf('p')).toEqual(['child']);
    expect(draft.parentOf('child')).toBe('p');
    expect(plan.changed).toEqual({ created: [], updated: ['p'], moved: [], removed: [] });
    expect([...plan.touched]).toEqual(['p']);
    expect({ input, commands }).toEqual(before);
  });

  it('inserts marked plain text after the first matching text', () => {
    const { draft, plan } = planTextOn(withText([{ text: 'Hello world Hello' }]), [{
      name: 'text.insert', args: { id: 'p', at: { after: 'Hello' }, text: ',', marks: { italic: true } },
    }]);

    expect(draft.get('p')?.data.text).toEqual([
      { text: 'Hello' }, { text: ',', marks: { italic: true } }, { text: ' world Hello' },
    ]);
    expect(plan.results).toEqual([{ length: 1 }]);
    expect(plan.lastRange).toEqual({ blockId: 'p', field: 'text', start: 5, end: 6 });
  });

  it('initializes an absent rich field with literal HTML-looking text and caller marks', () => {
    const htmlToSegments = vi.fn((): RichText => [{ text: 'Parsed' }]);
    const input: OutputData = { blocks: [{ id: 'p', type: 'paragraph', data: { legacy: 'keep' } }] };
    const { draft, plan } = planTextOn(input, [{
      name: 'text.insert', args: { id: 'p', at: 0, text: '<b>x</b>', marks: { code: true } },
    }], { ports: stubPorts({ htmlToSegments }) });

    expect(draft.get('p')?.data).toEqual({ text: [{ text: '<b>x</b>', marks: { code: true } }], legacy: 'keep' });
    expect(plan.results).toEqual([{ length: 8 }]);
    expect(plan.lastRange).toEqual({ blockId: 'p', field: 'text', start: 0, end: 8 });
    expect(htmlToSegments).not.toHaveBeenCalled();
  });

  it('replaces the requested find occurrence using the field plain text across rich runs and an embed', () => {
    const { draft, plan } = planTextOn(withText([
      { text: 'a ' },
      { text: 'b a', marks: { bold: true } },
      { embed: { page: { id: 'page-1' } }, marks: { italic: true } },
      { text: ' b' },
    ]), [{
      name: 'text.replace', args: { id: 'p', range: { find: 'b', occurrence: 2 }, with: [{ text: 'B', marks: { code: true } }] },
    }]);

    expect(draft.get('p')?.data.text).toEqual([
      { text: 'a ' },
      { text: 'b a', marks: { bold: true } },
      { embed: { page: { id: 'page-1' } }, marks: { italic: true } },
      { text: ' ' }, { text: 'B', marks: { code: true } },
    ]);
    expect(plan.results).toEqual([{ length: 1 }]);
    expect(plan.lastRange).toEqual({ blockId: 'p', field: 'text', start: 7, end: 8 });
  });

  it('deletes a found range containing a surrogate pair and embed, returns its plain text, and merges survivors', () => {
    const { draft, plan } = planTextOn(withText([
      { text: 'a😀', marks: { bold: true } },
      { embed: { page: { id: 'page-1' } }, marks: { italic: true } },
      { text: 'cd', marks: { bold: true } },
    ]), [{ name: 'text.delete', args: { id: 'p', range: { find: '😀￼c' } } }]);

    expect(draft.get('p')?.data.text).toEqual([{ text: 'ad', marks: { bold: true } }]);
    expect(plan.results).toEqual([{ removed: '😀￼c' }]);
    expect(plan.lastRange).toEqual({ blockId: 'p', field: 'text', start: 1, end: 1 });
  });

  it('replaces the whole field when range is omitted and canonicalizes the replacement', () => {
    const { draft, plan } = planTextOn(doc, [{
      name: 'text.replace', args: { id: 'p', with: [
        { text: '', marks: { code: true } },
        { text: 'H', marks: { code: true } },
        { text: 'i', marks: { code: true } },
      ] },
    }]);

    expect(draft.get('p')?.data.text).toEqual([{ text: 'Hi', marks: { code: true } }]);
    expect(plan.results).toEqual([{ length: 2 }]);
    expect(plan.lastRange).toEqual({ blockId: 'p', field: 'text', start: 0, end: 2 });
  });

  it('clears an explicit all range with an empty string replacement', () => {
    const { draft, plan } = planTextOn(doc, [{
      name: 'text.replace', args: { id: 'p', range: 'all', with: '' },
    }]);

    expect(draft.get('p')?.data.text).toEqual([]);
    expect(plan.results).toEqual([{ length: 0 }]);
    expect(plan.lastRange).toEqual({ blockId: 'p', field: 'text', start: 0, end: 0 });
  });

  it('formats across segment edges and an embed while retaining unrelated marks and payloads', () => {
    const { draft, plan } = planTextOn(withText([
      { text: 'ab', marks: { bold: true, color: 'red', 'tag:abbr': { title: 'word' } } },
      { embed: { equation: { expression: 'x^2' } }, marks: { link: { href: '/equation', target: '_self', rel: 'author' } } },
      { text: 'cd', marks: { bold: true } },
    ]), [{
      name: 'text.format',
      args: { id: 'p', range: { start: 1, end: 4 }, set: { italic: true, background: 'yellow' }, unset: ['bold', 'tag:abbr'] },
    }]);

    expect(draft.get('p')?.data.text).toEqual([
      { text: 'a', marks: { bold: true, color: 'red', 'tag:abbr': { title: 'word' } } },
      { text: 'b', marks: { color: 'red', italic: true, background: 'yellow' } },
      { embed: { equation: { expression: 'x^2' } }, marks: { link: { href: '/equation', target: '_self', rel: 'author' }, italic: true, background: 'yellow' } },
      { text: 'c', marks: { italic: true, background: 'yellow' } },
      { text: 'd', marks: { bold: true } },
    ]);
    expect(plan.results).toEqual([{}]);
    expect(plan.lastRange).toEqual({ blockId: 'p', field: 'text', start: 1, end: 4 });
  });

  it('unsets a mark even when it is also set and merges newly equal runs', () => {
    const { draft, plan } = planTextOn(withText([
      { text: 'a', marks: { bold: true } },
      { text: 'b', marks: { italic: true } },
      { text: 'c', marks: { bold: true } },
    ]), [{
      name: 'text.format', args: { id: 'p', range: { start: 1, end: 2 }, set: { bold: true, italic: true }, unset: ['italic'] },
    }]);

    expect(draft.get('p')?.data.text).toEqual([{ text: 'abc', marks: { bold: true } }]);
    expect(plan.results).toEqual([{}]);
    expect(plan.lastRange).toEqual({ blockId: 'p', field: 'text', start: 1, end: 2 });
  });

  it('supports empty insert, delete and format ranges in an empty rich field', () => {
    const { draft, plan } = planTextOn(withText([]), [
      { name: 'text.insert', args: { id: 'p', at: 0, text: '' } },
      { name: 'text.delete', args: { id: 'p', range: { start: 0, end: 0, expectText: '' } } },
      { name: 'text.format', args: { id: 'p', range: 'all', set: { bold: true } } },
    ]);

    expect(draft.get('p')?.data.text).toEqual([]);
    expect(plan.results).toEqual([{ length: 0 }, { removed: '' }, {}]);
    expect(plan.lastRange).toEqual({ blockId: 'p', field: 'text', start: 0, end: 0 });
  });

  it('defaults to the first declared rich field and edits an explicit second field independently', () => {
    const tools = new Map(TOOLS);
    tools.set('caption', tool('caption', { richTextFields: ['title', 'body'] }));
    const input: OutputData = { blocks: [{
      id: 'caption', type: 'caption', data: { title: [{ text: 'Title' }], body: [{ text: 'Body' }], label: 'keep' },
    }] };
    const { draft, plan } = planTextOn(input, [
      { name: 'text.format', args: { id: 'caption', range: { find: 'itle' }, set: { bold: true } } },
      { name: 'text.insert', args: { id: 'caption', field: 'body', at: 4, text: '!' } },
    ], { tools });

    expect(draft.get('caption')?.data).toEqual({
      title: [{ text: 'T' }, { text: 'itle', marks: { bold: true } }],
      body: [{ text: 'Body!' }], label: 'keep',
    });
    expect(plan.results).toEqual([{}, { length: 1 }]);
    expect(plan.lastRange).toEqual({ blockId: 'caption', field: 'body', start: 4, end: 5 });
    expect(plan.changed.updated).toEqual(['caption']);
    expect([...plan.touched]).toEqual(['caption']);
  });

  it.each([
    { command: { name: 'text.insert', args: { id: 'dv', at: 0, text: 'x' } }, fields: [] },
    { command: { name: 'text.format', args: { id: 'p', field: 'level', range: 'all', set: { bold: true } } }, fields: ['text'] },
  ] satisfies { command: AgentCommand; fields: string[] }[])('refuses a target without the requested rich field: $command.name', ({ command, fields }) => {
    expect(failOf(() => planTextOn(doc, [command]))).toMatchObject({
      code: 'FIELD_NOT_RICH_TEXT', retryable: false, commandIndex: 0,
      path: '/commands/0/args/field', details: { fields },
    });
  });

  it.each([
    { command: { name: 'text.insert', args: { id: 'missing', at: 0, text: 'x' } }, code: 'BLOCK_NOT_FOUND', details: { id: 'missing' } },
    { command: { name: 'text.delete', args: { id: '$missing', range: 'all' } }, code: 'BLOCK_NOT_FOUND', details: { ref: 'missing' } },
    { command: { name: 'text.replace', args: { id: 'opaque', with: 'x' } }, code: 'UNKNOWN_TOOL', details: { opaque: true } },
  ] satisfies { command: AgentCommand; code: AgentErrorCode; details: Record<string, unknown> }[])('refuses an unresolved or opaque target: $command.name', ({ command, code, details }) => {
    expect(failOf(() => planTextOn(doc, [command]))).toMatchObject({
      code, retryable: false, commandIndex: 0, path: '/commands/0/args/id', details,
    });
  });

  it.each([
    { command: { name: 'text.insert', args: { id: 'p', at: 2, text: 'x' } }, code: 'RANGE_OUT_OF_BOUNDS', path: '/at', details: { length: 4, text: 'a😀b' } },
    { command: { name: 'text.delete', args: { id: 'p', range: { start: 3, end: 1 } } }, code: 'RANGE_OUT_OF_BOUNDS', path: '/range', details: { length: 4, text: 'a😀b' } },
    { command: { name: 'text.format', args: { id: 'p', range: { start: 0, end: 9 }, set: { bold: true } } }, code: 'RANGE_OUT_OF_BOUNDS', path: '/range', details: { length: 4, text: 'a😀b' } },
    { command: { name: 'text.replace', args: { id: 'p', range: { find: 'missing' }, with: 'x' } }, code: 'RANGE_NOT_FOUND', path: '/range', details: { text: 'a😀b' } },
    { command: { name: 'text.insert', args: { id: 'p', at: { after: 'missing' }, text: 'x' } }, code: 'RANGE_NOT_FOUND', path: '/at/after', details: { text: 'a😀b' } },
  ] satisfies { command: AgentCommand; code: AgentErrorCode; path: string; details: Record<string, unknown> }[])('reports range failures at the real argument pointer: $command.name $path', ({ command, code, path, details }) => {
    expect(failOf(() => planTextOn(withText([{ text: 'a😀b' }]), [command]))).toMatchObject({
      code, retryable: false, commandIndex: 0, path: '/commands/0/args' + path, details,
    });
  });

  it('reports selected-field fresh text from the overlay on STALE and leaves the source snapshot and batch unchanged', () => {
    const tools = new Map(TOOLS);
    tools.set('caption', tool('caption', { richTextFields: ['title', 'body'] }));
    const ctx = plannerContext({ tools });
    const snapshot = DocSnapshot.fromOutput({ blocks: [{
      id: 'caption', type: 'caption', data: { title: [{ text: 'Title' }], body: [{ text: 'Body' }] },
    }] });
    const commands: AgentCommand[] = [
      { name: 'text.format', args: { id: 'caption', range: 'all', set: { bold: true } } },
      { name: 'text.insert', args: { id: 'caption', field: 'body', at: 0, text: '**hi**' } },
      { name: 'text.replace', args: { id: 'caption', field: 'body', range: { start: 6, end: 10, expectText: 'Gone' }, with: 'New' } },
    ];
    const { batch } = checkEnvelope({ commands }, ctx.commands, ctx.validate);
    const before = JSON.stringify({ snapshot: snapshot.toOutput(), batch });
    const warnings: AgentWarning[] = [];
    const error = failOf(() => planBatch({
      snapshot, batch, ctx, stamp: { actorId: 'agent', at: 1 }, warnings,
    }));

    expect(error).toMatchObject({
      code: 'STALE', retryable: true, commandIndex: 2, path: '/commands/2/args/range',
      details: { text: '**hi**Body', current: [{ id: 'caption', type: 'caption', text: '**hi**Body' }] },
    });
    expect(JSON.stringify({ snapshot: snapshot.toOutput(), batch })).toBe(before);
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'LOOKS_LIKE_MARKDOWN', commandIndex: 1, blockId: 'caption', field: 'body' }),
    ]);
  });

  it('reads each earlier command through a created ref and reports the final written range', () => {
    const { draft, plan } = planTextOn({ blocks: [] }, [
      { name: 'block.insert', ref: 'made', args: { type: 'paragraph', data: { text: 'test' } } },
      { name: 'text.insert', args: { id: '$made', at: { after: 'test' }, text: ' test' } },
      { name: 'text.delete', args: { id: '$made', range: { find: 'test', occurrence: 2 } } },
      { name: 'text.replace', args: { id: '$made', range: { start: 0, end: 4, expectText: 'test' }, with: 'AB' } },
      { name: 'text.format', args: { id: '$made', range: 'all', set: { bold: true } } },
    ]);

    expect(draft.get('n1')?.data.text).toEqual([{ text: 'AB ', marks: { bold: true } }]);
    expect(plan.results).toEqual([{ id: 'n1', childIds: [] }, { length: 5 }, { removed: 'test' }, { length: 2 }, {}]);
    expect(plan.refs).toEqual({ made: 'n1' });
    expect(plan.lastRange).toEqual({ blockId: 'n1', field: 'text', start: 0, end: 3 });
    expect(plan.changed).toEqual({ created: ['n1'], updated: [], moved: [], removed: [] });
    expect([...plan.touched]).toEqual(['n1']);
  });

  it.each([
    { command: { name: 'text.insert', args: { id: 'p', at: 5, text: ',', marks: { bold: true, unknown: true } } }, value: [{ text: 'Hello, world' }], result: { length: 1 }, range: { blockId: 'p', field: 'text', start: 5, end: 6 } },
    { command: { name: 'text.replace', args: { id: 'p', with: [{ text: 'H', marks: { bold: true, unknown: true } }, { text: 'i', marks: { bold: true } }] } }, value: [{ text: 'Hi' }], result: { length: 2 }, range: { blockId: 'p', field: 'text', start: 0, end: 2 } },
    { command: { name: 'text.format', args: { id: 'p', range: 'all', set: { bold: true, unknown: true } } }, value: [{ text: 'Hello world' }], result: {}, range: { blockId: 'p', field: 'text', start: 0, end: 11 } },
  ] satisfies { command: AgentCommand; value: RichText; result: Record<string, unknown>; range: TextRangeRef }[])('drops unknown marks and warns when sanitization changes a $command.name write', ({ command, value, result, range }) => {
    const sanitizeBlockData = vi.fn((_type: string, data: Record<string, unknown>): Record<string, unknown> => {
      if (!isRichText(data.text)) {
        return data;
      }

      const clean = structuredClone(data.text);
      for (const segment of clean) {
        if (segment.marks === undefined) {
          continue;
        }
        Reflect.deleteProperty(segment.marks, 'bold');
        if (Object.keys(segment.marks).length === 0) {
          Reflect.deleteProperty(segment, 'marks');
        }
      }

      return { ...data, text: richTextHelpers.canonicalize(clean) };
    });
    const { draft, plan, warnings } = planTextOn(doc, [command], { ports: stubPorts({ sanitizeBlockData }) });

    expect(draft.get('p')?.data.text).toEqual(value);
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'UNKNOWN_MARK_DROPPED', commandIndex: 0, blockId: 'p', field: 'text' }),
      expect.objectContaining({ code: 'SANITIZED', commandIndex: 0, blockId: 'p', field: 'text' }),
    ]);
    expect(plan.results).toEqual([result]);
    expect(plan.lastRange).toEqual(range);
    expect(sanitizeBlockData).toHaveBeenCalled();
  });

  it.each([
    { name: 'text.insert', args: { id: 'p', at: 0, text: '**hi**' } },
    { name: 'text.replace', args: { id: 'p', with: [{ text: '# ' }, { text: 'Heading' }] } },
  ] satisfies AgentCommand[])('warns once that $name saves Markdown-looking input literally', command => {
    const htmlToSegments = vi.fn((): RichText => [{ text: 'Parsed' }]);
    const { draft, warnings } = planTextOn(withText([]), [command], { ports: stubPorts({ htmlToSegments }) });

    expect(draft.get('p')?.data.text).toEqual([{ text: command.name === 'text.insert' ? '**hi**' : '# Heading' }]);
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'LOOKS_LIKE_MARKDOWN', commandIndex: 0, blockId: 'p', field: 'text' }),
    ]);
    expect(htmlToSegments).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'text.insert', args: { id: 'p', at: 0, text: [{ text: 'Ambiguous', embed: { page: { id: 'page-1' } } }] } },
    { name: 'text.replace', args: { id: 'p', with: [{ embed: { page: { id: 7 } } }] } },
  ] satisfies AgentCommand[])('rejects malformed rich content accepted by the envelope rather than silently dropping it in $name', command => {
    expect(failOf(() => planTextOn(doc, [command]))).toMatchObject({
      code: 'INVALID_ARGS', retryable: false, commandIndex: 0,
    });
  });
});

describe('text writes follow whole-record preparation', () => {
  it('normalizes once with complete data, prepares derived rich output once, and emits removals without rewriting legacy fields', () => {
    const normalize = vi.fn((data: Record<string, unknown>): Record<string, unknown> => {
      const normalized = {
        ...data,
        title: [{ text: 'H', marks: { bold: true } }, { text: 'i', marks: { bold: true } }],
        body: [
          { text: 'A', marks: { bold: true, unknown: true } }, { text: 'B', marks: { bold: true } },
          { embed: { page: { id: 'page-1' } } },
        ],
        label: 'derived',
      };
      Reflect.deleteProperty(normalized, 'old');
      Reflect.deleteProperty(normalized, 'obsolete');

      return normalized;
    });
    const sanitizeBlockData = vi.fn((_type: string, data: Record<string, unknown>): Record<string, unknown> => {
      if (isRichText(data.body) && data.body.some(segment => 'text' in segment && segment.text === 'AB')) {
        return { ...data, body: [{ text: 'Clean' }, { embed: { page: { id: 'page-1' } } }] };
      }

      return data;
    });
    const tools = new Map(TOOLS);
    tools.set('caption', tool('caption', {
      richTextFields: ['title', 'body', 'obsolete', 'legacy'],
      guardedFields: { body: 'caption.setBody' }, viewState: ['zoom'],
    }, { normalize }));
    const input: OutputData = { blocks: [{
      id: 'caption', type: 'caption', data: {
        title: [{ text: 'Old' }], body: [{ text: 'Body' }], obsolete: [{ text: 'Remove' }],
        legacy: { unchecked: true }, level: 2, old: 'remove', zoom: 1,
      },
    }] };
    const { draft, plan, warnings } = planTextOn(input, [{
      name: 'text.replace', args: { id: 'caption', field: 'title', with: [{ text: 'Hi', marks: { bold: true } }] },
    }], { tools, ports: stubPorts({ sanitizeBlockData }) });

    expect(draft.get('caption')?.data).toEqual({
      title: [{ text: 'Hi', marks: { bold: true } }],
      body: [{ text: 'Clean' }, { embed: { page: { id: 'page-1' } } }],
      legacy: { unchecked: true }, level: 2, zoom: 1, label: 'derived',
    });
    expect(plan.edits).toEqual([
      { op: 'setRichText', id: 'caption', field: 'title', value: [{ text: 'Hi', marks: { bold: true } }] },
      { op: 'setRichText', id: 'caption', field: 'body', value: [{ text: 'Clean' }, { embed: { page: { id: 'page-1' } } }] },
      { op: 'setData', id: 'caption', patch: { obsolete: null, old: null, label: 'derived' } },
    ]);
    expect(normalize).toHaveBeenCalledExactlyOnceWith({
      title: [{ text: 'Hi', marks: { bold: true } }], body: [{ text: 'Body' }], obsolete: [{ text: 'Remove' }],
      legacy: { unchecked: true }, level: 2, old: 'remove', zoom: 1,
    });
    expect(sanitizeBlockData).toHaveBeenCalledWith('caption', expect.objectContaining({
      body: [{ text: 'AB', marks: { bold: true } }, { embed: { page: { id: 'page-1' } } }],
    }));
    expect(sanitizeBlockData.mock.calls.filter(([, data]) => Object.hasOwn(data, 'body'))).toHaveLength(1);
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'UNKNOWN_MARK_DROPPED', commandIndex: 0, blockId: 'caption', field: 'body' }),
      expect.objectContaining({ code: 'SANITIZED', commandIndex: 0, blockId: 'caption', field: 'body' }),
    ]);
    expect(plan.results).toEqual([{ length: 2 }]);
    expect(plan.lastRange).toEqual({ blockId: 'caption', field: 'title', start: 0, end: 2 });
  });

  it.each([
    { command: { name: 'text.format', args: { id: 'caption', field: 'title', range: 'all', unset: ['bold'] } }, details: { reason: 'view-state', field: 'title' } },
    { command: { name: 'text.replace', args: { id: 'caption', field: 'body', with: 'Body' } }, details: { reason: 'guarded', field: 'body', use: 'caption.setBody' } },
  ] satisfies { command: AgentCommand; details: Record<string, unknown> }[])('refuses even equal caller writes to a protected rich field in $command.name', ({ command, details }) => {
    const tools = new Map(TOOLS);
    tools.set('caption', tool('caption', {
      richTextFields: ['title', 'body'], viewState: ['title'], guardedFields: { body: 'caption.setBody' },
    }));
    const input: OutputData = { blocks: [{
      id: 'caption', type: 'caption', data: { title: [{ text: 'Title' }], body: [{ text: 'Body' }] },
    }] };

    expect(failOf(() => planTextOn(input, [command], { tools }))).toMatchObject({
      code: 'FIELD_NOT_WRITABLE', retryable: false, commandIndex: 0,
      path: '/commands/0/args/field', details,
    });
  });

  it('refuses a view-state change produced by normalization', () => {
    const normalize = vi.fn((data: Record<string, unknown>): Record<string, unknown> => ({ ...data, zoom: 2 }));
    const tools = new Map(TOOLS);
    tools.set('caption', tool('caption', { richTextFields: ['title'], viewState: ['zoom'] }, { normalize }));
    const input: OutputData = { blocks: [{
      id: 'caption', type: 'caption', data: { title: [{ text: 'Title' }], zoom: 1 },
    }] };

    expect(failOf(() => planTextOn(input, [{
      name: 'text.insert', args: { id: 'caption', at: 5, text: '!' },
    }], { tools }))).toMatchObject({
      code: 'FIELD_NOT_WRITABLE', retryable: false, commandIndex: 0,
      details: { reason: 'view-state', field: 'zoom' },
    });
    expect(normalize).toHaveBeenCalledExactlyOnceWith({ title: [{ text: 'Title!' }], zoom: 1 });
  });

  it('refuses malformed derived rich output without normalizing again', () => {
    const normalize = vi.fn((data: Record<string, unknown>): Record<string, unknown> => ({
      ...data, body: [{ text: 'Ambiguous', embed: { page: { id: 'page-1' } } }],
    }));
    const tools = new Map(TOOLS);
    tools.set('caption', tool('caption', { richTextFields: ['title', 'body'] }, { normalize }));
    const input: OutputData = { blocks: [{
      id: 'caption', type: 'caption', data: { title: [{ text: 'Title' }], body: [{ text: 'Body' }] },
    }] };

    expect(failOf(() => planTextOn(input, [{
      name: 'text.replace', args: { id: 'caption', with: 'New' },
    }], { tools }))).toMatchObject({ code: 'INVALID_ARGS', retryable: false, commandIndex: 0 });
    expect(normalize).toHaveBeenCalledExactlyOnceWith({ title: [{ text: 'New' }], body: [{ text: 'Body' }] });
  });
});

describe('text results and ranges after target preparation', () => {
  const payload: RichText = [
    { text: 'x', marks: { code: true } },
    { text: 'x', marks: { code: true } },
    { embed: { html: '<script>drop</script>' } },
    { text: '😀' },
    { embed: { page: { id: 'page-1' } } },
  ];
  const finalValue: RichText = [
    { text: 'Fixed😀', marks: { bold: true } },
    { embed: { page: { id: 'page-1' } } },
  ];

  it.each([
    {
      command: { name: 'text.insert', args: { id: 'p', at: 1, text: payload } },
      intended: [
        { text: 'A' }, { text: 'xx', marks: { code: true } }, { text: '😀' },
        { embed: { page: { id: 'page-1' } } }, { text: 'B' },
      ],
    },
    {
      command: { name: 'text.replace', args: { id: 'p', range: { start: 1, end: 2 }, with: payload } },
      intended: [
        { text: 'A' }, { text: 'xx', marks: { code: true } }, { text: '😀' },
        { embed: { page: { id: 'page-1' } } },
      ],
    },
  ] satisfies { command: AgentCommand; intended: RichText }[])('$command.name reports sanitized payload length, not normalized field length, and highlights the effective rewrite', ({ command, intended }) => {
    const sanitizeBlockData = vi.fn((_type: string, data: Record<string, unknown>): Record<string, unknown> => {
      if (!isRichText(data.text)) {
        return data;
      }

      return {
        ...data,
        text: richTextHelpers.canonicalize(data.text.filter(segment => !('embed' in segment && 'html' in segment.embed))),
      };
    });
    const normalize = vi.fn((data: Record<string, unknown>): Record<string, unknown> => ({
      ...data,
      text: [
        { text: 'F', marks: { bold: true } }, { text: 'ixed😀', marks: { bold: true } },
        { embed: { html: '<script>derived</script>' } },
        { embed: { page: { id: 'page-1' } } },
      ],
    }));
    const tools = new Map(TOOLS);
    tools.set('paragraph', tool('paragraph', { richTextFields: ['text'] }, { normalize }));
    const { draft, plan } = planTextOn(withText([{ text: 'AB' }]), [command], {
      tools, ports: stubPorts({ sanitizeBlockData }),
    });

    expect(plan.results).toEqual([{ length: 5 }]);
    expect(plan.lastRange).toEqual({ blockId: 'p', field: 'text', start: 0, end: 8 });
    expect(draft.get('p')?.data.text).toEqual(finalValue);
    expect(normalize).toHaveBeenCalledExactlyOnceWith({ text: intended });
  });

  it.each([
    {
      command: { name: 'text.delete', args: { id: 'p', range: { start: 1, end: 4, expectText: '😀￼' } } },
      intended: [{ text: 'a', marks: { bold: true } }, { text: 'b' }],
      result: { removed: '😀￼' },
    },
    {
      command: { name: 'text.format', args: { id: 'p', range: { start: 1, end: 3 }, set: { italic: true } } },
      intended: [
        { text: 'a', marks: { bold: true } }, { text: '😀', marks: { bold: true, italic: true } },
        { embed: { page: { id: 'page-1' } }, marks: { italic: true } }, { text: 'b' },
      ],
      result: {},
    },
  ] satisfies { command: AgentCommand; intended: RichText; result: Record<string, unknown> }[])('$command.name retains its operation result when normalization rewrites the target text', ({ command, intended, result }) => {
    const normalize = vi.fn((data: Record<string, unknown>): Record<string, unknown> => ({
      ...data,
      text: [{ text: 'F', marks: { bold: true } }, { text: 'ixed😀', marks: { bold: true } }, { embed: { page: { id: 'page-1' } } }],
    }));
    const tools = new Map(TOOLS);
    tools.set('paragraph', tool('paragraph', { richTextFields: ['text'] }, { normalize }));
    const { draft, plan } = planTextOn(withText([
      { text: 'a😀', marks: { bold: true } },
      { embed: { page: { id: 'page-1' } }, marks: { italic: true } },
      { text: 'b' },
    ]), [command], { tools });

    expect(plan.results).toEqual([result]);
    expect(plan.lastRange).toEqual({ blockId: 'p', field: 'text', start: 0, end: 8 });
    expect(draft.get('p')?.data.text).toEqual(finalValue);
    expect(normalize).toHaveBeenCalledExactlyOnceWith({ text: intended });
  });

  it('highlights a same-length normalized text rewrite as the whole field', () => {
    const normalize = vi.fn((data: Record<string, unknown>): Record<string, unknown> => ({
      ...data, text: [{ text: 'WXYZ' }],
    }));
    const tools = new Map(TOOLS);
    tools.set('paragraph', tool('paragraph', { richTextFields: ['text'] }, { normalize }));
    const { draft, plan } = planTextOn(withText([{ text: 'ABCD' }]), [{
      name: 'text.format', args: { id: 'p', range: { start: 1, end: 2 }, set: { bold: true } },
    }], { tools });

    expect(plan.lastRange).toEqual({ blockId: 'p', field: 'text', start: 0, end: 4 });
    expect(draft.get('p')?.data.text).toEqual([{ text: 'WXYZ' }]);
    expect(plan.results).toEqual([{}]);
    expect(normalize).toHaveBeenCalledExactlyOnceWith({
      text: [{ text: 'A' }, { text: 'B', marks: { bold: true } }, { text: 'CD' }],
    });
  });

  it('reports the inserted payload length but an empty effective range when normalization removes the target field', () => {
    const normalize = vi.fn((data: Record<string, unknown>): Record<string, unknown> => ({ label: data.label }));
    const tools = new Map(TOOLS);
    tools.set('paragraph', tool('paragraph', { richTextFields: ['text'] }, { normalize }));
    const input: OutputData = { blocks: [{
      id: 'p', type: 'paragraph', data: { text: [{ text: 'AB' }], label: 'keep' },
    }] };
    const { draft, plan } = planTextOn(input, [{
      name: 'text.insert', args: { id: 'p', at: 1, text: '!' },
    }], { tools });

    expect(plan.results).toEqual([{ length: 1 }]);
    expect(plan.lastRange).toEqual({ blockId: 'p', field: 'text', start: 0, end: 0 });
    expect(draft.get('p')?.data).toEqual({ label: 'keep' });
    expect(plan.edits).toEqual([{ op: 'setData', id: 'p', patch: { text: null } }]);
    expect(normalize).toHaveBeenCalledExactlyOnceWith({ text: [{ text: 'A!B' }], label: 'keep' });
  });
});
