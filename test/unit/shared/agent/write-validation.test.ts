// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentFailure } from '../../../../src/shared/agent/errors';
import { planBatch } from '../../../../src/shared/agent/planner';
import { PREPARE_PENDING } from '../../../../src/shared/agent/plan-state';
import { DocSnapshot } from '../../../../src/shared/agent/snapshot';
import { plannerContext, planOn, stubPorts, TOOLS, tool } from './fixtures';

import type { JsonSchema } from '../../../../src/shared/agent/types';
import type { AgentCommand, OutputData } from '../../../../types';

const doc: OutputData = { blocks: [
  { id: 'h', type: 'header', data: { text: [], level: 2, legacy: { keep: true } } },
  { id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] } },
] };

const boundedRich: JsonSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: { text: { type: 'string', maxLength: 4 } },
    required: ['text'],
    additionalProperties: false,
  },
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

const rejects = (
  operation: () => unknown,
  commandIndex: number,
  blockId: string,
  problemPath: string
): void => {
  expect(failOf(operation)).toMatchObject({
    code: 'DATA_REJECTED',
    commandIndex,
    path: `/commands/${commandIndex}`,
    retryable: false,
    details: {
      blockId,
      problems: expect.arrayContaining([
        expect.objectContaining({ path: problemPath, message: expect.stringMatching(/\S/) }),
      ]),
    },
  });
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('written data validation', () => {
  it('attributes a bad ordinary write to its command, not the last command', () => {
    rejects(() => planOn(doc, [
      { name: 'block.update', args: { id: 'h', data: { level: 3 } } },
      { name: 'block.update', args: { id: 'h', data: { level: 9 } } },
      { name: 'block.update', args: { id: 'p', data: { text: 'OK' } } },
    ]), 1, 'h', '/level');
  });

  it('does not check untouched unknown keys or an untouched invalid declared field', () => {
    const source: OutputData = { blocks: [{
      id: 'h', type: 'header', data: { text: [], level: 9, legacy: { keep: true } },
    }] };
    const { draft, plan } = planOn(source, [{
      name: 'block.update', args: { id: 'h', data: { text: 'OK' } },
    }]);

    expect(draft.get('h')?.data).toEqual({
      text: [{ text: 'OK' }], level: 9, legacy: { keep: true },
    });
    expect(plan.edits).toEqual([{ op: 'setRichText', id: 'h', field: 'text', value: [{ text: 'OK' }] }]);
  });

  it('does not validate an untouched malformed rich field while updating an ordinary field', () => {
    const source: OutputData = { blocks: [{
      id: 'h', type: 'header', data: { text: { old: true }, level: 2, legacy: 'kept' },
    }] };
    const { draft } = planOn(source, [{
      name: 'block.update', args: { id: 'h', data: { level: 3 } },
    }]);

    expect(draft.get('h')?.data).toEqual({ text: { old: true }, level: 3, legacy: 'kept' });
  });

  it('checks an explicit equal write even when the invalid value was already stored', () => {
    const source: OutputData = { blocks: [{ id: 'h', type: 'header', data: { text: [], level: 9 } }] };

    rejects(() => planOn(source, [{
      name: 'block.update', args: { id: 'h', data: { level: 9 } },
    }]), 0, 'h', '/level');
  });

  const richWrites: AgentCommand[] = [
    { name: 'block.update', args: { id: 'n', data: { text: '12345' } } },
    { name: 'text.replace', args: { id: 'n', with: '12345' } },
  ];

  it.each(richWrites)('checks the full emitted rich value for $name with nested problem paths', command => {
    const tools = new Map(TOOLS);
    tools.set('note', tool('note', {
      richTextFields: ['text'],
      data: { type: 'object', properties: { text: boundedRich }, additionalProperties: false },
    }));
    const source: OutputData = { blocks: [
      { id: 'h', type: 'header', data: { text: [], level: 2 } },
      { id: 'n', type: 'note', data: { text: [], legacy: 'kept' } },
    ] };

    rejects(() => planOn(source, [
      { name: 'block.update', args: { id: 'h', data: { level: 3 } } },
      command,
    ], { tools }), 1, 'n', '/text/0/text');
  });

  it('checks the resulting rich field, not only the text inserted into it', () => {
    const tools = new Map(TOOLS);
    tools.set('note', tool('note', {
      richTextFields: ['text'],
      data: { type: 'object', properties: { text: boundedRich }, additionalProperties: false },
    }));
    const source: OutputData = { blocks: [{ id: 'n', type: 'note', data: { text: [{ text: '1234' }] } }] };

    rejects(() => planOn(source, [{
      name: 'text.insert', args: { id: 'n', at: 4, text: '5' },
    }], { tools }), 0, 'n', '/text/0/text');
  });

  it('escapes written field names and retains nested validator paths', () => {
    const tools = new Map(TOOLS);
    tools.set('record', tool('record', {
      data: {
        type: 'object',
        properties: {
          'a/b~c': { type: 'array', items: { type: 'object', properties: { score: { type: 'integer', minimum: 0 } } } },
        },
        additionalProperties: false,
      },
    }));
    const source: OutputData = { blocks: [{ id: 'r', type: 'record', data: { legacy: true } }] };

    rejects(() => planOn(source, [{
      name: 'block.update', args: { id: 'r', data: { 'a/b~c': [{ score: -1 }] } },
    }], { tools }), 0, 'r', '/a~1b~0c/0/score');
  });

  it.each([
    { key: 'colour', path: '/colour' },
    { key: 'toString', path: '/toString' },
  ])('rejects a written unknown own key $key in a closed schema', ({ key, path }) => {
    rejects(() => planOn(doc, [{
      name: 'block.update', args: { id: 'h', data: { [key]: 'red' } },
    }]), 0, 'h', path);
  });

  const openSchemas: Array<{ label: string; schema: JsonSchema }> = [
    { label: 'omitted additionalProperties', schema: { type: 'object' } },
    { label: 'explicitly open', schema: { type: 'object', additionalProperties: true } },
  ];

  it.each(openSchemas)('permits an unknown written key with $label', ({ schema }) => {
    const tools = new Map(TOOLS);
    tools.set('open', tool('open', { data: schema }));
    const source: OutputData = { blocks: [{ id: 'o', type: 'open', data: {} }] };
    const { draft } = planOn(source, [{
      name: 'block.update', args: { id: 'o', data: { extra: { count: 1 } } },
    }], { tools });

    expect(draft.get('o')?.data).toEqual({ extra: { count: 1 } });
  });

  it('uses a schema-valued additionalProperties for a written extra key', () => {
    const tools = new Map(TOOLS);
    tools.set('extras', tool('extras', {
      data: { type: 'object', additionalProperties: { type: 'integer', minimum: 0 } },
    }));
    const source: OutputData = { blocks: [{ id: 'e', type: 'extras', data: { untouched: 'legacy' } }] };

    rejects(() => planOn(source, [{
      name: 'block.update', args: { id: 'e', data: { extra: 'wrong' } },
    }], { tools }), 0, 'e', '/extra');
  });

  it('allows a valid schema-valued extra without checking an untouched invalid extra', () => {
    const tools = new Map(TOOLS);
    tools.set('extras', tool('extras', {
      data: { type: 'object', additionalProperties: { type: 'integer', minimum: 0 } },
    }));
    const source: OutputData = { blocks: [{ id: 'e', type: 'extras', data: { untouched: 'legacy' } }] };
    const { draft } = planOn(source, [{
      name: 'block.update', args: { id: 'e', data: { extra: 0 } },
    }], { tools });

    expect(draft.get('e')?.data).toEqual({ untouched: 'legacy', extra: 0 });
  });

  it('permits a matching pattern key despite additionalProperties false', () => {
    const tools = new Map(TOOLS);
    tools.set('patterned', tool('patterned', {
      data: { type: 'object', patternProperties: { '^count:': { type: 'integer' } }, additionalProperties: false },
    }));
    const source: OutputData = { blocks: [{ id: 'r', type: 'patterned', data: {} }] };
    const { draft } = planOn(source, [{
      name: 'block.update', args: { id: 'r', data: { 'count:one': 1 } },
    }], { tools });

    expect(draft.get('r')?.data).toEqual({ 'count:one': 1 });
  });

  it('checks matching pattern constraints even for a declared written property', () => {
    const tools = new Map(TOOLS);
    tools.set('patterned', tool('patterned', {
      data: {
        type: 'object', properties: { count: { type: 'integer' } },
        patternProperties: { '^count': { minimum: 1 } }, additionalProperties: false,
      },
    }));
    const source: OutputData = { blocks: [{ id: 'r', type: 'patterned', data: {} }] };

    rejects(() => planOn(source, [{
      name: 'block.update', args: { id: 'r', data: { count: 0 } },
    }], { tools }), 0, 'r', '/count');
  });

  it('validates normalizer-derived written keys without rechecking retained legacy data', () => {
    const tools = new Map(TOOLS);
    tools.set('header', tool('header', {
      richTextFields: ['text'],
      data: {
        type: 'object',
        properties: { text: { type: 'array' }, level: { type: 'integer', minimum: 1, maximum: 6 } },
        additionalProperties: false,
      },
    }, { normalize: data => ({ ...data, level: 9 }) }));

    rejects(() => planOn(doc, [{
      name: 'block.update', args: { id: 'h', data: { text: 'OK' } },
    }], { tools }), 0, 'h', '/level');
  });

  it('checks sanitized values rather than rejecting the raw value that was corrected', () => {
    const ports = stubPorts({
      sanitizeBlockData: (_type, data) => ({ ...data, ...(data.level === 9 ? { level: 3 } : {}) }),
    });
    const commands: AgentCommand[] = [{ name: 'block.update', args: { id: 'h', data: { level: 9 } } }];
    const before = structuredClone(commands);
    const { draft, plan } = planOn(doc, commands, { ports });

    expect(draft.get('h')?.data.level).toBe(3);
    expect(plan.edits).toEqual([{ op: 'setData', id: 'h', patch: { level: 3 } }]);
    expect(commands).toEqual(before);
  });

  it('checks a later ordinary edit in the same command as a valid rich edit', () => {
    rejects(() => planOn(doc, [
      { name: 'block.update', args: { id: 'p', data: { text: 'OK' } } },
      { name: 'block.update', args: { id: 'h', data: { text: 'OK', level: 9 } } },
    ]), 1, 'h', '/level');
  });
});

describe('whole written blocks', () => {
  it('rejects an inserted block missing a required field', () => {
    const tools = new Map(TOOLS);
    tools.set('required', tool('required', {
      data: { type: 'object', required: ['label'], properties: { label: { type: 'string' } }, additionalProperties: false },
    }));

    rejects(() => planOn(doc, [{
      name: 'block.insert', args: { type: 'required', id: 'new', data: {} },
    }], { tools }), 0, 'new', '');
  });

  it('rejects an extra key in a whole inserted block', () => {
    rejects(() => planOn(doc, [{
      name: 'block.insert', args: { type: 'paragraph', id: 'new', data: { text: 'OK', colour: 'red' } },
    }]), 0, 'new', '/colour');
  });

  it('reports a bad grandchild and attributes it to the inserting command', () => {
    rejects(() => planOn(doc, [
      { name: 'block.update', args: { id: 'h', data: { level: 3 } } },
      { name: 'block.insert', args: { type: 'toggle', id: 'outer', data: { text: 'OK' }, children: [
        { type: 'toggle', id: 'inner', data: { text: 'OK' }, children: [
          { type: 'header', id: 'bad-child', data: { text: 'OK', level: 9 } },
        ] },
      ] } },
    ]), 1, 'bad-child', '/level');
  });

  it('validates seeded default children as whole inserted blocks', () => {
    const tools = new Map(TOOLS);
    tools.set('seeded', tool('seeded', {}, {
      defaultChildren: [{ type: 'header', id: 'bad-seed', data: { text: 'OK', level: 9 } }],
    }));

    rejects(() => planOn(doc, [{
      name: 'block.insert', args: { type: 'seeded', id: 'outer' },
    }], { tools }), 0, 'bad-seed', '/level');
  });

  it('accepts a valid inserted tree after plain rich input becomes segments', () => {
    const { draft } = planOn(doc, [{
      name: 'block.insert', args: { type: 'toggle', id: 'outer', data: { text: 'OK' }, children: [
        { type: 'header', id: 'child', data: { text: 'Hi', level: 6 } },
      ] },
    }]);

    expect(draft.get('child')?.data).toEqual({ text: [{ text: 'Hi' }], level: 6 });
    expect(draft.childrenOf('outer')).toEqual(['child']);
  });

  it('checks normalized inserted data, not only the insert arguments', () => {
    const tools = new Map(TOOLS);
    const header = TOOLS.get('header');
    if (header === undefined) {
      throw new Error('Missing header fixture');
    }
    tools.set('header', tool('header', header.entry, { normalize: data => ({ ...data, level: 9 }) }));

    rejects(() => planOn(doc, [{
      name: 'block.insert', args: { type: 'header', id: 'new', data: { text: 'OK', level: 3 } },
    }], { tools }), 0, 'new', '/level');
  });

  it('checks the whole conversion result, including an invalid unoverridden default', () => {
    const tools = new Map(TOOLS);
    const header = TOOLS.get('header');
    if (header === undefined) {
      throw new Error('Missing header fixture');
    }
    tools.set('header', tool('header', { ...header.entry, defaultData: { level: 9 } }));

    rejects(() => planOn(doc, [
      { name: 'block.update', args: { id: 'p', data: { text: 'OK' } } },
      { name: 'block.convert', args: { id: 'p', type: 'header' } },
    ], { tools }), 1, 'p', '/level');
  });

  it('rejects a conversion missing a required target field', () => {
    const tools = new Map(TOOLS);
    tools.set('required', tool('required', {
      richTextFields: ['text'], conversion: { import: 'text', export: 'text' },
      data: {
        type: 'object', properties: { text: { type: 'array' }, label: { type: 'string' } },
        required: ['label'], additionalProperties: false,
      },
    }));

    rejects(() => planOn(doc, [{
      name: 'block.convert', args: { id: 'p', type: 'required' },
    }], { tools }), 0, 'p', '');
  });

  it('checks a schema-valued additional property in a whole conversion result', () => {
    const tools = new Map(TOOLS);
    tools.set('extras', tool('extras', {
      richTextFields: ['text'], conversion: { import: 'text', export: 'text' },
      defaultData: { extra: 'wrong' },
      data: { type: 'object', properties: { text: { type: 'array' } }, additionalProperties: { type: 'integer' } },
    }));

    rejects(() => planOn(doc, [{
      name: 'block.convert', args: { id: 'p', type: 'extras' },
    }], { tools }), 0, 'p', '/extra');
  });

  it('does not treat null inside inserted data as a removal edit', () => {
    rejects(() => planOn(doc, [{
      name: 'block.insert', args: { type: 'header', id: 'new', data: { text: 'OK', level: null } },
    }]), 0, 'new', '/level');
  });
});

describe('write chronology at each edit position', () => {
  it('accepts a valid heading update before conversion drops that heading-only key', () => {
    const { draft, plan } = planOn(doc, [
      { name: 'block.update', args: { id: 'h', data: { level: 3 } } },
      { name: 'block.convert', args: { id: 'h', type: 'paragraph' } },
    ]);

    expect(draft.get('h')?.data).toEqual({ text: [] });
    expect(plan.edits).toEqual([
      { op: 'setData', id: 'h', patch: { level: 3 } },
      { op: 'replaceType', id: 'h', type: 'paragraph', data: { text: [] } },
    ]);
  });

  it('does not check an earlier rich write against a later plain field schema', () => {
    const tools = new Map(TOOLS);
    tools.set('plain', tool('plain', {
      conversion: { import: 'text', export: 'text' },
      data: { type: 'object', properties: { text: { type: 'string' } }, additionalProperties: false },
    }));
    const { draft } = planOn(doc, [
      { name: 'block.update', args: { id: 'p', data: { text: 'OK' } } },
      { name: 'block.convert', args: { id: 'p', type: 'plain' } },
    ], { tools });

    expect(draft.get('p')?.data).toEqual({ text: 'OK' });
    expect(draft.get('p')?.type).toBe('plain');
  });

  it('accepts numeric-to-string update-convert-update without crossing write schemas', () => {
    const tools = new Map(TOOLS);
    tools.set('labelled', tool('labelled', {
      richTextFields: ['text'], conversion: { import: 'text', export: 'text' },
      defaultData: { level: 'draft' },
      data: {
        type: 'object', properties: { text: { type: 'array' }, level: { type: 'string' } }, additionalProperties: false,
      },
    }));
    const { draft } = planOn(doc, [
      { name: 'block.update', args: { id: 'h', data: { level: 3 } } },
      { name: 'block.convert', args: { id: 'h', type: 'labelled' } },
      { name: 'block.update', args: { id: 'h', data: { level: 'final' } } },
    ], { tools });

    expect(draft.get('h')?.data).toEqual({ text: [], level: 'final' });
  });

  it('accepts a valid write before its target is deleted', () => {
    const { draft, plan } = planOn(doc, [
      { name: 'block.update', args: { id: 'h', data: { level: 3 } } },
      { name: 'block.delete', args: { id: 'h' } },
    ]);

    expect(draft.has('h')).toBe(false);
    expect(plan.changed.removed).toEqual(['h']);
  });

  it('attributes a surviving invalid repeated write to the later writer', () => {
    rejects(() => planOn(doc, [
      { name: 'block.update', args: { id: 'h', data: { level: 3 } } },
      { name: 'block.update', args: { id: 'h', data: { level: 9 } } },
    ]), 1, 'h', '/level');
  });

  it('accepts repeated valid writes and keeps the last value', () => {
    const { draft } = planOn(doc, [
      { name: 'block.update', args: { id: 'h', data: { level: 3 } } },
      { name: 'block.update', args: { id: 'h', data: { level: 4 } } },
    ]);

    expect(draft.get('h')?.data.level).toBe(4);
    expect(draft.get('h')?.data.legacy).toEqual({ keep: true });
  });

  const intermediateWrites: Array<{ label: string; commands: AgentCommand[]; id: string; path: string }> = [
    { label: 'ordinary repair', id: 'h', path: '/level', commands: [
      { name: 'block.update', args: { id: 'h', data: { level: 9 } } },
      { name: 'block.update', args: { id: 'h', data: { level: 3 } } },
    ] },
    { label: 'rich repair', id: 'n', path: '/text/0/text', commands: [
      { name: 'text.replace', args: { id: 'n', with: '12345' } },
      { name: 'text.replace', args: { id: 'n', with: 'OK' } },
    ] },
    { label: 'insert repair', id: 'new', path: '/level', commands: [
      { name: 'block.insert', args: { type: 'header', id: 'new', data: { text: [], level: 9 } } },
      { name: 'block.update', args: { id: 'new', data: { level: 3 } } },
    ] },
    { label: 'replacement repair', id: 'p', path: '/level', commands: [
      { name: 'block.convert', args: { id: 'p', type: 'header', data: { level: 9 } } },
      { name: 'block.update', args: { id: 'p', data: { level: 3 } } },
    ] },
    { label: 'ordinary conversion', id: 'h', path: '/level', commands: [
      { name: 'block.update', args: { id: 'h', data: { level: 9 } } },
      { name: 'block.convert', args: { id: 'h', type: 'paragraph' } },
    ] },
    { label: 'rich conversion', id: 'n', path: '/text/0/text', commands: [
      { name: 'block.update', args: { id: 'n', data: { text: '12345' } } },
      { name: 'block.convert', args: { id: 'n', type: 'paragraph' } },
    ] },
    { label: 'update deletion', id: 'h', path: '/level', commands: [
      { name: 'block.update', args: { id: 'h', data: { level: 9 } } },
      { name: 'block.delete', args: { id: 'h' } },
    ] },
    { label: 'insert deletion', id: 'new', path: '/level', commands: [
      { name: 'block.insert', args: { type: 'header', id: 'new', data: { text: [], level: 9 } } },
      { name: 'block.delete', args: { id: 'new' } },
    ] },
  ];

  it.each(intermediateWrites)('rejects the earlier invalid write despite $label', ({ commands, id, path }) => {
    const tools = new Map(TOOLS);
    tools.set('note', tool('note', {
      richTextFields: ['text'], conversion: { import: 'text', export: 'text' },
      data: { type: 'object', properties: { text: boundedRich }, additionalProperties: false },
    }));
    const source: OutputData = { blocks: [...doc.blocks, { id: 'n', type: 'note', data: { text: [] } }] };

    rejects(() => planOn(source, commands, { tools }), 0, id, path);
  });
});

describe('removal and input isolation', () => {
  it('skips top-level null removals of optional ordinary, rich and unknown keys', () => {
    const { draft, plan } = planOn(doc, [{
      name: 'block.update', args: { id: 'h', data: { level: null, text: null, legacy: null, unknown: null } },
    }]);

    expect(draft.get('h')?.data).toEqual({});
    expect(plan.edits).toEqual([{
      op: 'setData', id: 'h', patch: { level: null, text: null, legacy: null, unknown: null },
    }]);
  });

  it('validates a nested null as data, not as a top-level removal sentinel', () => {
    const tools = new Map(TOOLS);
    tools.set('record', tool('record', {
      data: {
        type: 'object', properties: {
          options: { type: 'object', properties: { label: { type: 'string' } }, additionalProperties: false },
        },
        additionalProperties: false,
      },
    }));
    const source: OutputData = { blocks: [{ id: 'r', type: 'record', data: {} }] };

    rejects(() => planOn(source, [{
      name: 'block.update', args: { id: 'r', data: { options: { label: null } } },
    }], { tools }), 0, 'r', '/options/label');
  });

  it('does not revalidate block data when the batch writes only placement', () => {
    const source: OutputData = { blocks: [{
      id: 'h', type: 'header', data: { text: { old: true }, level: 9, legacy: true },
    }] };
    const { draft } = planOn(source, [{ name: 'block.move', args: { id: 'h', position: 'end' } }]);

    expect(draft.get('h')?.data).toEqual({ text: { old: true }, level: 9, legacy: true });
  });

  it.each([
    { label: 'accepted', level: 3 },
    { label: 'rejected', level: 9 },
  ])('leaves source snapshot, caller batch and schema unchanged when $label', ({ level }) => {
    const source = structuredClone(doc);
    const snapshot = DocSnapshot.fromOutput(source);
    const commands: AgentCommand[] = [{ name: 'block.update', args: { id: 'h', data: {
      text: [{ text: 'O', marks: { bold: true } }, { text: 'K', marks: { bold: true } }], level,
    } } }];
    const tools = new Map(TOOLS);
    const header = tools.get('header');
    if (header === undefined) {
      throw new Error('Missing header fixture');
    }
    const before = structuredClone({ source, snapshot: snapshot.toOutput(), commands, schema: header.entry.data });
    const input = {
      snapshot, batch: { commands }, ctx: plannerContext({ tools }),
      stamp: { actorId: 'agent', at: 1 }, warnings: [],
    };

    if (level === 9) {
      rejects(() => planBatch(input), 0, 'h', '/level');
    } else {
      expect(planBatch(input).draft.get('h')?.data.level).toBe(3);
    }
    expect({ source, snapshot: snapshot.toOutput(), commands, schema: header.entry.data }).toEqual(before);
  });

});

describe('scoped projection and pending preparation', () => {
  const rootSchema: JsonSchema = {
    type: 'object', required: ['mode'], additionalProperties: false,
    properties: {
      label: { type: 'string' }, mode: { type: 'string' }, level: { type: 'integer', minimum: 1, maximum: 6 },
      options: {
        type: 'object', required: ['score'], properties: { score: { type: 'integer' } },
        allOf: [{ properties: { score: { minimum: 0 } } }],
      },
    },
    allOf: [{ properties: { level: { maximum: 5 } } }],
    if: { properties: { mode: { const: 'strict' } }, required: ['mode'] },
    then: { properties: { level: { maximum: 2 } } },
  };
  const constrained = tool('constrained', {
    conversion: { import: 'label', export: 'label' }, data: rootSchema,
  });

  it('omits root cross-field checks on partial writes and skips required-key removal', () => {
    const tools = new Map(TOOLS);
    tools.set('constrained', constrained);
    const source: OutputData = { blocks: [{ id: 'r', type: 'constrained', data: { mode: 'strict', level: 1, legacy: true } }] };
    const { draft } = planOn(source, [
      { name: 'block.update', args: { id: 'r', data: { level: 6 } } },
      { name: 'block.update', args: { id: 'r', data: { mode: null } } },
    ], { tools });

    expect(draft.get('r')?.data).toEqual({ level: 6, legacy: true });
  });

  it('omits root then when the partial write itself satisfies root if', () => {
    const tools = new Map(TOOLS);
    tools.set('constrained', constrained);
    const source: OutputData = { blocks: [{ id: 'r', type: 'constrained', data: { mode: 'loose', level: 1, legacy: true } }] };
    const { draft } = planOn(source, [
      { name: 'block.update', args: { id: 'r', data: { mode: 'strict', level: 3 } } },
    ], { tools });

    expect(draft.get('r')?.data).toEqual({ mode: 'strict', level: 3, legacy: true });
  });

  it.each([
    { label: 'required', options: {}, path: '/options' },
    { label: 'allOf', options: { score: -1 }, path: '/options/score' },
  ])('keeps the selected property full schema, including $label', ({ options, path }) => {
    const tools = new Map(TOOLS);
    tools.set('constrained', constrained);
    const source: OutputData = { blocks: [{ id: 'r', type: 'constrained', data: { legacy: true } }] };

    rejects(() => planOn(source, [{ name: 'block.update', args: { id: 'r', data: { options } } }], { tools }), 0, 'r', path);
  });

  const wholeCommands: Array<{ label: string; command: AgentCommand }> = [
    { label: 'insert if/then', command: { name: 'block.insert', args: { type: 'constrained', id: 'new', data: { mode: 'strict', level: 3 } } } },
    { label: 'convert if/then', command: { name: 'block.convert', args: { id: 'p', type: 'constrained', data: { mode: 'strict', level: 3 } } } },
    { label: 'insert allOf', command: { name: 'block.insert', args: { type: 'constrained', id: 'new', data: { mode: 'loose', level: 6 } } } },
    { label: 'convert allOf', command: { name: 'block.convert', args: { id: 'p', type: 'constrained', data: { mode: 'loose', level: 6 } } } },
  ];
  it.each(wholeCommands)('retains full root constraints for $label', ({ command }) => {
    const tools = new Map(TOOLS);
    tools.set('constrained', constrained);

    rejects(() => planOn(doc, [command], { tools }), 0, command.name === 'block.insert' ? 'new' : 'p', '/level');
  });

  const preparedTool = tool('prepared', {
    insertRequires: ['pageBackend'],
    data: { type: 'object', required: ['pageId'], properties: { pageId: { type: 'string' } }, additionalProperties: false },
  });
  const copyCommands: AgentCommand[] = [
    { name: 'block.insert', args: { type: 'prepared', id: 'pending', data: {} }, ref: 'made' },
    { name: 'block.duplicate', args: { id: '$made' } },
  ];

  it('defers the whole pass for pending insert, its ref duplicate and an unrelated invalid write', () => {
    const tools = new Map(TOOLS);
    tools.set('prepared', preparedTool);
    const { draft, plan } = planOn(doc, [
      ...copyCommands, { name: 'block.update', args: { id: 'h', data: { level: 9 } } },
    ], { tools, prepared: new Map([[0, PREPARE_PENDING]]) });

    expect(draft.get('pending')?.data).toEqual({});
    expect(draft.get('n1')?.data).toEqual({});
    expect(draft.get('h')?.data.level).toBe(9);
    expect(plan.refs).toEqual({ made: 'pending' });
    expect(plan.changed.created).toEqual(['pending', 'n1']);
  });

  it('validates the insert and ref duplicate when preparation is concrete', () => {
    const tools = new Map(TOOLS);
    tools.set('prepared', preparedTool);
    const { draft } = planOn(doc, copyCommands, { tools, prepared: new Map([[0, { pageId: 'created' }]]) });

    expect(draft.get('pending')?.data).toEqual({ pageId: 'created' });
    expect(draft.get('n1')?.data).toEqual({ pageId: 'created' });
  });

  it('rejects invalid concrete prepared data instead of deferring it', () => {
    const tools = new Map(TOOLS);
    tools.set('prepared', preparedTool);

    rejects(() => planOn(doc, copyCommands, { tools, prepared: new Map([[0, { pageId: 7 }]]) }), 0, 'pending', '/pageId');
  });

  it('validates a batch with no pending preparation entries', () => {
    const tools = new Map(TOOLS);
    tools.set('prepared', preparedTool);

    rejects(() => planOn(doc, copyCommands, { tools, prepared: new Map() }), 0, 'pending', '');
  });

  const markdownWrites: Array<{ label: string; blocks: OutputData['blocks']; id: string }> = [
    { label: 'root', id: 'n1', blocks: [
      { id: 'imported', type: 'header', data: { text: [], level: 9 } },
    ] },
    { label: 'child', id: 'n2', blocks: [
      { id: 'imported', type: 'toggle', data: { text: [] }, content: ['imported-child'] },
      { id: 'imported-child', type: 'header', data: { text: [], level: 9 }, parent: 'imported' },
    ] },
  ];

  it.each(markdownWrites)('rejects an invalid prepared Markdown $label despite a later repair', ({ blocks, id }) => {
    rejects(() => planOn(doc, [
      { name: 'doc.setTitle', args: { title: 'Before import' } },
      { name: 'markdown.insert', args: { markdown: '# Imported' } },
      { name: 'block.update', args: { id, data: { level: 3 } } },
    ], { prepared: new Map<number, unknown>([[1, { blocks, warnings: [] }]]) }), 1, id, '/level');
  });

  const actionWrites: Array<{ operation: 'update' | 'setRichText' | 'insert'; id: string; path: string }> = [
    { operation: 'update', id: 'h', path: '/level' },
    { operation: 'setRichText', id: 'n', path: '/text/0/text' },
    { operation: 'insert', id: 'n1', path: '/level' },
  ];

  it.each(actionWrites)('rejects an action $operation write despite a repair in the same command', ({ operation, id, path }) => {
    const tools = new Map(TOOLS);
    const header = tools.get('header');
    if (header === undefined) {
      throw new Error('Missing header fixture');
    }
    tools.set('note', tool('note', {
      richTextFields: ['text'],
      data: { type: 'object', properties: { text: boundedRich }, additionalProperties: false },
    }));
    tools.set('header', tool('header', header.entry, { actions: { write: { run: ctx => {
      switch (operation) {
        case 'update':
          ctx.update('h', { level: 9 });
          ctx.update('h', { level: 3 });
          break;
        case 'setRichText':
          ctx.setRichText('n', 'text', [{ text: '12345' }]);
          ctx.setRichText('n', 'text', [{ text: 'OK' }]);
          break;
        case 'insert': {
          const created = ctx.insert({ type: 'header', data: { text: [], level: 9 } });

          ctx.update(created, { level: 3 });
          break;
        }
      }
    } } } }));
    const commands = new Map(plannerContext().commands);
    commands.set('header.write', {
      name: 'header.write', args: { type: 'object' }, readOnly: false, available: true,
      source: { tool: 'header', target: 'block' },
    });
    const source: OutputData = { blocks: [...doc.blocks, { id: 'n', type: 'note', data: { text: [] } }] };

    rejects(() => planOn(source, [
      { name: 'doc.setTitle', args: { title: 'Before action' } },
      { name: 'header.write', args: { id: 'h' } },
    ], { tools, commands }), 1, id, path);
  });

  it('applies partial-key policy to action updates without rescanning untouched legacy data', () => {
    const tools = new Map(TOOLS);
    tools.set('constrained', tool('constrained', constrained.entry, { actions: { change: { run: ctx => {
      ctx.update('r', { mode: 'strict', level: 3 });
      ctx.update('r', { mode: null });
    } } } }));
    const commands = new Map(plannerContext().commands);
    commands.set('constrained.change', {
      name: 'constrained.change', args: { type: 'object' }, readOnly: false, available: true,
      source: { tool: 'constrained', target: 'block' },
    });
    const source: OutputData = { blocks: [{ id: 'r', type: 'constrained', data: { mode: 'loose', level: 1, legacy: true } }] };
    const { draft, plan } = planOn(source, [{ name: 'constrained.change', args: { id: 'r' } }], { tools, commands });

    expect(draft.get('r')?.data).toEqual({ level: 3, legacy: true });
    expect(plan.edits).toEqual([
      { op: 'setData', id: 'r', patch: { mode: 'strict', level: 3 } },
      { op: 'setData', id: 'r', patch: { mode: null } },
    ]);
  });

  const actionPreparation: Array<{ label: string; value: unknown }> = [
    { label: 'pending', value: PREPARE_PENDING },
    { label: 'concrete', value: {} },
  ];

  it.each(actionPreparation)('defers unrelated data rejection only while an action is $label', ({ value }) => {
    const tools = new Map(TOOLS);
    const header = tools.get('header');
    if (header === undefined) {
      throw new Error('Missing header fixture');
    }
    tools.set('header', tool('header', header.entry, { actions: { repair: { run: ctx => {
      ctx.update('h', { level: 3 });
    } } } }));
    const commands = new Map(plannerContext().commands);
    commands.set('header.repair', {
      name: 'header.repair', args: { type: 'object' }, readOnly: false, available: true,
      source: { tool: 'header', target: 'block' },
    });
    const batch: AgentCommand[] = [
      { name: 'block.update', args: { id: 'h', data: { level: 9 } } },
      { name: 'header.repair', args: { id: 'h' } },
    ];
    const context = { tools, commands, prepared: new Map<number, unknown>([[1, value]]) };

    if (value === PREPARE_PENDING) {
      const { draft, plan } = planOn(doc, batch, context);

      expect(draft.get('h')?.data.level).toBe(9);
      expect(plan.edits).toEqual([{ op: 'setData', id: 'h', patch: { level: 9 } }]);
    } else {
      rejects(() => planOn(doc, batch, context), 0, 'h', '/level');
    }
  });
});
