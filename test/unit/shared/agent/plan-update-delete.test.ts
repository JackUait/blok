// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentFailure } from '../../../../src/shared/agent/errors';
import { planBatch } from '../../../../src/shared/agent/planner';
import { DocSnapshot } from '../../../../src/shared/agent/snapshot';
import { coreCommandMap, plannerContext, planOn, stubPorts, TOOLS, tool } from './fixtures';

import type { PlannerTool } from '../../../../src/shared/agent/types';
import type { AgentCommand, AgentWarning, OutputData } from '../../../../types';

const doc: OutputData = { title: 'Page', icon: { type: 'emoji', value: 'x' }, blocks: [
  { id: 'h', type: 'header', data: { text: [{ text: 'H' }], level: 2, old: 'x' }, lastEditedBy: 'human', lastEditedAt: 8 },
  { id: 'tg', type: 'toggle', data: { text: [{ text: 'T' }] }, content: ['k'], lastEditedBy: 'human', lastEditedAt: 8 },
  { id: 'k', type: 'paragraph', data: { text: [{ text: 'K' }] }, parent: 'tg', lastEditedBy: 'child', lastEditedAt: 7 },
  { id: 'cl', type: 'column_list', data: {}, content: ['c'] },
  { id: 'c', type: 'column', data: {}, parent: 'cl' },
  { id: 'img', type: 'image', data: { url: 'u', zoom: 1 } },
  { id: 'tbl', type: 'table', data: { content: [] } },
  { id: 'kb', type: 'kanban', data: {} },
] };

const failOf = (fn: () => unknown): AgentFailure['error'] => {
  try {
    fn();
  } catch (error) {
    if (error instanceof AgentFailure) {
      return error.error;
    }
    throw error;
  }
  throw new Error('Expected an AgentFailure');
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isArray = (value: unknown): value is unknown[] => Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';

const copyResult = (value: unknown): { id: string; childIds: string[] } => {
  if (!isRecord(value) || typeof value.id !== 'string' || !isArray(value.childIds)) {
    throw new Error('Expected a duplicate result');
  }
  const childIds = value.childIds;

  if (!childIds.every(isString)) {
    throw new Error('Expected child IDs');
  }

  return { id: value.id, childIds };
};

const registered = (name: string): PlannerTool => {
  const entry = TOOLS.get(name);

  if (entry === undefined) {
    throw new Error('Missing fixture tool');
  }

  return entry;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('block.update planning', () => {
  it('writes rich text separately, merges data, removes null keys and reports the existing ID', () => {
    const { plan, draft } = planOn(doc, [{
      name: 'block.update', args: { id: 'h', data: { text: 'New', level: 3, old: null } },
    }]);

    expect(draft.get('h')?.data).toEqual({ text: [{ text: 'New' }], level: 3 });
    expect(plan.edits).toEqual([
      { op: 'setRichText', id: 'h', field: 'text', value: [{ text: 'New' }] },
      { op: 'setData', id: 'h', patch: { old: null, level: 3 } },
    ]);
    expect(plan.results).toEqual([{ id: 'h' }]);
    expect(plan.changed).toEqual({ created: [], updated: ['h'], moved: [], removed: [] });
    expect([...plan.touched]).toEqual(['h']);
    expect(draft.get('h')?.rest).toEqual({ lastEditedBy: 'agent', lastEditedAt: 1 });
    expect(draft.get('tg')?.rest).toEqual({ lastEditedBy: 'human', lastEditedAt: 8 });
    expect(draft.title).toBe('Page');
    expect(draft.icon).toEqual({ type: 'emoji', value: 'x' });
  });

  it('uses a shallow merge while leaving untouched legacy data in place', () => {
    const input: OutputData = { blocks: [{
      id: 'img', type: 'image',
      data: { url: 'before', legacy: { keep: true }, options: { first: 1, second: 2 } },
    }] };
    const { plan, draft } = planOn(input, [{
      name: 'block.update', args: { id: 'img', data: { options: { second: 3 } } },
    }]);

    expect(draft.get('img')?.data).toEqual({
      url: 'before', legacy: { keep: true }, options: { second: 3 },
    });
    expect(plan.edits).toEqual([{ op: 'setData', id: 'img', patch: { options: { second: 3 } } }]);
  });

  it('removes a rich field through a null patch without converting null into segments', () => {
    const { plan, draft } = planOn(doc, [{
      name: 'block.update', args: { id: 'h', data: { text: null } },
    }]);

    expect(Object.hasOwn(draft.get('h')?.data ?? {}, 'text')).toBe(false);
    expect(plan.edits).toEqual([{ op: 'setData', id: 'h', patch: { text: null } }]);
    expect(draft.get('h')?.data).toEqual({ level: 2, old: 'x' });
  });

  it('stores an empty string as empty rich text rather than deleting the field', () => {
    const { plan, draft } = planOn(doc, [{
      name: 'block.update', args: { id: 'h', data: { text: '' } },
    }]);

    expect(draft.get('h')?.data.text).toEqual([]);
    expect(Object.hasOwn(draft.get('h')?.data ?? {}, 'text')).toBe(true);
    expect(plan.edits).toEqual([{ op: 'setRichText', id: 'h', field: 'text', value: [] }]);
  });

  it('stores HTML-looking strings literally without calling the HTML port', () => {
    const htmlToSegments = vi.fn(() => [{ text: 'parsed' }]);
    const { draft } = planOn(doc, [{
      name: 'block.update', args: { id: 'h', data: { text: '<b>literal</b>' } },
    }], { ports: stubPorts({ htmlToSegments }) });

    expect(draft.get('h')?.data.text).toEqual([{ text: '<b>literal</b>' }]);
    expect(htmlToSegments).not.toHaveBeenCalled();
  });

  it('normalizes the full merged data once, after rich preparation and sanitization', () => {
    const normalize = vi.fn((data: Record<string, unknown>) => ({ ...data, level: data.level ?? 2 }));
    const sanitizeBlockData = vi.fn((_type: string, data: Record<string, unknown>) => ({
      ...data, label: 'clean',
    }));
    const tools = new Map(TOOLS);

    const dataSchema = structuredClone(registered('header').entry.data);

    if (!isRecord(dataSchema.properties)) {
      throw new Error('Expected fixture schema properties');
    }
    dataSchema.properties.label = { type: 'string' };
    tools.set('header', tool('header', { ...registered('header').entry, data: dataSchema }, { normalize }));
    const { plan, draft } = planOn(doc, [{
      name: 'block.update', args: { id: 'h', data: { text: 'New', label: 'dirty', old: null } },
    }], { tools, ports: stubPorts({ sanitizeBlockData }) });

    expect(draft.get('h')?.data).toEqual({ text: [{ text: 'New' }], level: 2, label: 'clean' });
    expect(sanitizeBlockData).toHaveBeenCalledExactlyOnceWith('header', {
      text: [{ text: 'New' }], label: 'dirty',
    });
    expect(normalize).toHaveBeenCalledExactlyOnceWith({
      text: [{ text: 'New' }], level: 2, label: 'clean',
    });
    expect(plan.edits).toEqual([
      { op: 'setRichText', id: 'h', field: 'text', value: [{ text: 'New' }] },
      { op: 'setData', id: 'h', patch: { old: null, label: 'clean' } },
    ]);
    expect(plan.warnings).toEqual([expect.objectContaining({
      code: 'SANITIZED', commandIndex: 0, blockId: 'h', field: 'label',
    })]);
  });

  it('does not default an omitted heading level by normalizing only the patch', () => {
    const normalize = vi.fn((data: Record<string, unknown>) => ({ ...data, level: data.level ?? 2 }));
    const tools = new Map(TOOLS);

    tools.set('header', tool('header', registered('header').entry, { normalize }));
    const input: OutputData = { blocks: [{ id: 'h', type: 'header', data: { text: [], level: 5, old: 'x' } }] };
    const { plan, draft } = planOn(input, [{
      name: 'block.update', args: { id: 'h', data: { old: null } },
    }], { tools });

    expect(draft.get('h')?.data).toEqual({ text: [], level: 5 });
    expect(normalize).toHaveBeenCalledExactlyOnceWith({ text: [], level: 5 });
    expect(plan.edits).toEqual([{ op: 'setData', id: 'h', patch: { old: null } }]);
  });

  it('records non-rich fields filled or changed by the pure normalizer', () => {
    const normalize = vi.fn((data: Record<string, unknown>) => ({ ...data, level: 4, derived: { valid: true } }));
    const tools = new Map(TOOLS);

    const dataSchema = structuredClone(registered('header').entry.data);

    if (!isRecord(dataSchema.properties)) {
      throw new Error('Expected fixture schema properties');
    }
    dataSchema.properties.derived = {
      type: 'object', properties: { valid: { type: 'boolean' } }, additionalProperties: false,
    };
    tools.set('header', tool('header', { ...registered('header').entry, data: dataSchema }, { normalize }));
    const { plan, draft } = planOn(doc, [{
      name: 'block.update', args: { id: 'h', data: { old: null } },
    }], { tools });

    expect(draft.get('h')?.data).toEqual({ text: [{ text: 'H' }], level: 4, derived: { valid: true } });
    expect(plan.edits).toEqual([{
      op: 'setData', id: 'h', patch: { old: null, level: 4, derived: { valid: true } },
    }]);
  });

  it('writes all declared rich fields and emits data and tunes after them', () => {
    const tools = new Map(TOOLS);

    tools.set('two', tool('two', { richTextFields: ['title', 'body'] }));
    const input: OutputData = { blocks: [{
      id: 'two', type: 'two', data: { title: [], body: [], count: 1 },
      tunes: { kept: { on: true }, remove: { on: true } },
    }] };
    const { plan, draft } = planOn(input, [{
      name: 'block.update', args: {
        id: 'two', data: { body: 'Body', title: 'Title', count: 2 },
        tunes: { remove: null, added: { on: true } },
      },
    }], { tools });

    expect(draft.get('two')?.data).toEqual({
      title: [{ text: 'Title' }], body: [{ text: 'Body' }], count: 2,
    });
    expect(plan.edits).toEqual([
      { op: 'setRichText', id: 'two', field: 'title', value: [{ text: 'Title' }] },
      { op: 'setRichText', id: 'two', field: 'body', value: [{ text: 'Body' }] },
      { op: 'setData', id: 'two', patch: { count: 2 } },
      { op: 'setTunes', id: 'two', tunes: { remove: null, added: { on: true } } },
    ]);
    expect(draft.get('two')?.tunes).toEqual({ kept: { on: true }, added: { on: true } });
    expect(plan.changed.updated).toEqual(['two']);
    expect([...plan.touched]).toEqual(['two']);
  });

  it('merges tunes without emitting block-data writes', () => {
    const sanitizeBlockData = vi.fn((_type: string, data: Record<string, unknown>) => data);
    const input: OutputData = { blocks: [{
      id: 'h', type: 'header', data: { text: [], level: 2 },
      tunes: { keep: { nested: true }, remove: { value: 1 } },
    }] };
    const { plan, draft } = planOn(input, [{
      name: 'block.update', args: { id: 'h', tunes: { remove: null, add: { value: 2 } } },
    }], { ports: stubPorts({ sanitizeBlockData }) });

    expect(draft.get('h')?.tunes).toEqual({ keep: { nested: true }, add: { value: 2 } });
    expect(draft.get('h')?.data).toEqual({ text: [], level: 2 });
    expect(plan.edits).toEqual([{ op: 'setTunes', id: 'h', tunes: { remove: null, add: { value: 2 } } }]);
    expect(plan.results).toEqual([{ id: 'h' }]);
  });

  it('emits no edit for omitted data and tunes with no normalizer changes', () => {
    const { plan, draft } = planOn(doc, [{ name: 'block.update', args: { id: 'h' } }]);

    expect(plan.edits).toEqual([]);
    expect(plan.results).toEqual([{ id: 'h' }]);
    expect(plan.changed).toEqual({ created: [], updated: [], moved: [], removed: [] });
    expect([...plan.touched]).toEqual([]);
    expect(draft.get('h')?.rest).toEqual({ lastEditedBy: 'human', lastEditedAt: 8 });
  });

  it('stamps an explicitly emitted value-equal data update', () => {
    const { plan, draft } = planOn(doc, [{
      name: 'block.update', args: { id: 'h', data: { level: 2 } },
    }]);

    expect(draft.get('h')?.rest).toEqual({ lastEditedBy: 'agent', lastEditedAt: 1 });
    expect(plan.edits).toEqual([{ op: 'setData', id: 'h', patch: { level: 2 } }]);
    expect(plan.changed.updated).toEqual(['h']);
    expect([...plan.touched]).toEqual(['h']);
  });

  it.each([
    { id: 'img', field: 'zoom', value: 2, reason: 'view-state', use: undefined },
    { id: 'img', field: 'zoom', value: null, reason: 'view-state', use: undefined },
    { id: 'img', field: 'zoom', value: 1, reason: 'view-state', use: undefined },
    { id: 'tbl', field: 'content', value: [], reason: 'guarded', use: 'table.*' },
    { id: 'tbl', field: 'content', value: null, reason: 'guarded', use: 'table.*' },
  ])('refuses $reason writes to $field before preparing data', ({ id, field, value, reason, use }) => {
    const sanitizeBlockData = vi.fn((_type: string, data: Record<string, unknown>) => data);
    const error = failOf(() => planOn(doc, [{
      name: 'block.update', args: { id, data: { [field]: value } },
    }], { ports: stubPorts({ sanitizeBlockData }) }));

    expect(error).toMatchObject({
      code: 'FIELD_NOT_WRITABLE', commandIndex: 0, path: '/commands/0/args/data/' + field,
      details: { reason, field, ...(use === undefined ? {} : { use }) },
    });
    expect(sanitizeBlockData).not.toHaveBeenCalled();
  });

  it('returns the declared guarded-field action even when the field is rich text', () => {
    const tools = new Map(TOOLS);

    tools.set('caption', tool('caption', {
      richTextFields: ['text'], guardedFields: { text: 'caption.rename' },
    }));
    const error = failOf(() => planOn({ blocks: [{ id: 'caption', type: 'caption', data: { text: [] } }] }, [{
      name: 'block.update', args: { id: 'caption', data: { text: 'New' } },
    }], { tools }));

    expect(error).toMatchObject({
      code: 'FIELD_NOT_WRITABLE', path: '/commands/0/args/data/text',
      details: { reason: 'guarded', field: 'text', use: 'caption.rename' },
    });
  });

  it.each(['view-state', 'guarded'])('escapes special field names in %s diagnostic pointers', reason => {
    const field = 'label/with~tilde';
    const tools = new Map(TOOLS);

    tools.set('custom', tool('custom', {
      viewState: reason === 'view-state' ? [field] : [],
      guardedFields: reason === 'guarded' ? { [field]: 'custom.rename' } : {},
    }));
    const error = failOf(() => planOn({ blocks: [{ id: 'custom', type: 'custom', data: {} }] }, [{
      name: 'block.update', args: { id: 'custom', data: { [field]: 'value' } },
    }], { tools }));

    expect(error).toMatchObject({
      code: 'FIELD_NOT_WRITABLE', path: '/commands/0/args/data/label~1with~0tilde',
      details: { reason, field },
    });
  });

  it.each(['constructor', 'toString', '__proto__'])('updates and removes the ordinary own JSON key %s', field => {
    const value = { nested: { label: 'kept' } };
    const patch = Object.fromEntries([[field, value]]);
    const { plan, draft } = planOn(doc, [{
      name: 'block.update', args: { id: 'img', data: patch },
    }]);

    expect(Object.hasOwn(draft.get('img')?.data ?? {}, field)).toBe(true);
    expect(draft.get('img')?.data[field]).toEqual(value);
    expect(plan.edits).toEqual([{ op: 'setData', id: 'img', patch }]);
    const removed = planOn(draft.toOutput(), [{
      name: 'block.update', args: { id: 'img', data: Object.fromEntries([[field, null]]) },
    }]);

    expect(Object.hasOwn(removed.draft.get('img')?.data ?? {}, field)).toBe(false);
  });

  it.each(['constructor', 'toString', '__proto__'])('recognizes an own guarded-field rule for %s', field => {
    const tools = new Map(TOOLS);

    tools.set('custom', tool('custom', { guardedFields: Object.fromEntries([[field, 'custom.rename']]) }));
    const error = failOf(() => planOn({ blocks: [{ id: 'custom', type: 'custom', data: {} }] }, [{
      name: 'block.update', args: { id: 'custom', data: Object.fromEntries([[field, 'value']]) },
    }], { tools }));

    expect(error).toMatchObject({
      code: 'FIELD_NOT_WRITABLE',
      details: { reason: 'guarded', field, use: 'custom.rename' },
    });
  });

  it('preserves own nested JSON and tune keys without treating them as prototypes', () => {
    const nested = Object.fromEntries([['__proto__', { safe: true }], ['constructor', 'label']]);
    const tunes = Object.fromEntries([['__proto__', nested], ['toString', { enabled: true }]]);
    const { plan, draft } = planOn(doc, [{
      name: 'block.update', args: { id: 'img', data: { nested }, tunes },
    }]);
    const block = draft.get('img');

    if (block === undefined || !isRecord(block.data.nested) || block.tunes === undefined) {
      throw new Error('Expected updated own JSON');
    }

    expect(Object.hasOwn(block.data.nested, '__proto__')).toBe(true);
    expect(Reflect.has(block.data, 'safe')).toBe(false);
    expect(Reflect.has(block.data.nested, 'safe')).toBe(false);
    expect(Object.hasOwn(block.tunes, '__proto__')).toBe(true);
    expect(Reflect.has(block.tunes, 'safe')).toBe(false);
    expect(plan.edits).toEqual([
      { op: 'setData', id: 'img', patch: { nested } },
      { op: 'setTunes', id: 'img', tunes },
    ]);
  });

  it.each([
    { data: {} },
    { data: { arbitrary: 'value' } },
    { tunes: { align: { side: 'left' } } },
  ])('refuses an opaque block for data or tune updates', patch => {
    const error = failOf(() => planOn(doc, [{
      name: 'block.update', args: { id: 'kb', ...patch },
    }]));

    expect(error).toMatchObject({
      code: 'UNKNOWN_TOOL', commandIndex: 0, path: '/commands/0/args/id', details: { opaque: true },
    });
  });

  it.each([
    { value: 42, pointer: '/data/text' },
    { value: [null], pointer: '/data/text/0' },
    { value: [{ text: 'x', embed: { html: 'y' } }], pointer: '/data/text/0' },
    { value: [{ text: 'x', marks: [] }], pointer: '/data/text/0' },
    { value: [{ embed: { page: { id: 7 } } }], pointer: '/data/text/0' },
    { value: [{ embed: { equation: { expression: 'x', extra: true } } }], pointer: '/data/text/0' },
  ])('rejects malformed rich input at its nested pointer', ({ value, pointer }) => {
    const error = failOf(() => planOn(doc, [{
      name: 'block.update', args: { id: 'h', data: { text: value } },
    }]));
    const path = '/commands/0/args' + pointer;

    expect(error.code).toBe('INVALID_ARGS');
    expect(error.commandIndex).toBe(0);
    expect(error.path === path || error.path?.startsWith(path + '/')).toBe(true);
  });

  it('warns and drops unknown marks while keeping valid marks and embeds', () => {
    const { plan, draft } = planOn(doc, [{
      name: 'block.update', args: { id: 'h', data: { text: [
        { text: 'A', marks: { bold: true, mystery: 'drop' } },
        { embed: { page: { id: 'page-1' } }, marks: { italic: true } },
      ] } },
    }]);

    expect(draft.get('h')?.data.text).toEqual([
      { text: 'A', marks: { bold: true } },
      { embed: { page: { id: 'page-1' } }, marks: { italic: true } },
    ]);
    expect(plan.warnings).toEqual([expect.objectContaining({
      code: 'UNKNOWN_MARK_DROPPED', commandIndex: 0, blockId: 'h', field: 'text',
    })]);
  });

  it('preserves earlier edit payloads and caller data through later updates and draft mutation', () => {
    const header = registered('header');
    const dataSchema = structuredClone(header.entry.data);
    if (!isRecord(dataSchema.properties)) {
      throw new Error('Expected fixture schema properties');
    }
    dataSchema.properties.meta = {
      type: 'object', properties: { label: { type: 'string' } }, additionalProperties: false,
    };
    const tools = new Map(TOOLS);

    tools.set('header', tool('header', { ...header.entry, data: dataSchema }, header.runtime));
    const snapshot = DocSnapshot.fromOutput(doc);
    const before = snapshot.toOutput();
    const data = { text: [{ text: 'First', marks: { bold: true } }], meta: { label: 'First' } };
    const tunes = { align: { side: 'left' } };
    const commands: AgentCommand[] = [
      { name: 'block.update', args: { id: 'h', data, tunes } },
      { name: 'block.update', args: { id: 'h', data: { text: 'Second', meta: { label: 'Second' } } } },
    ];
    const commandsBefore = structuredClone(commands);
    const { plan, draft } = planBatch({
      snapshot, batch: { commands }, ctx: plannerContext({ tools }),
      stamp: { actorId: 'agent', at: 1 }, warnings: [],
    });
    const editsBefore = structuredClone(plan.edits);
    const updated = draft.get('h');

    if (updated === undefined || !isRecord(updated.data.meta) || updated.tunes === undefined ||
        !isRecord(updated.tunes.align)) {
      throw new Error('Expected mutable draft payloads');
    }
    updated.data.meta.label = 'draft-only';
    updated.tunes.align.side = 'right';

    expect(plan.edits).toEqual(editsBefore);
    expect(snapshot.toOutput()).toEqual(before);
    expect(commands).toEqual(commandsBefore);
    expect(plan.edits[0]).toEqual({ op: 'setRichText', id: 'h', field: 'text', value: data.text });
    expect(plan.changed.updated).toEqual(['h']);
    expect([...plan.touched]).toEqual(['h']);
  });

  it('keeps planned patches independent from caller-owned nested data and tunes', () => {
    const header = registered('header');
    const dataSchema = structuredClone(header.entry.data);
    if (!isRecord(dataSchema.properties)) {
      throw new Error('Expected fixture schema properties');
    }
    dataSchema.properties.meta = {
      type: 'object', properties: { label: { type: 'string' } }, additionalProperties: false,
    };
    const tools = new Map(TOOLS);

    tools.set('header', tool('header', { ...header.entry, data: dataSchema }, header.runtime));
    const data = { text: [{ text: 'original', marks: { bold: true } }], meta: { label: 'original' } };
    const tunes = { align: { side: 'left' } };
    const { plan, draft } = planOn(doc, [{
      name: 'block.update', args: { id: 'h', data, tunes },
    }], { tools });
    const editsBefore = structuredClone(plan.edits);

    data.meta.label = 'caller-only';
    data.text.push({ text: 'caller-only', marks: { bold: true } });
    tunes.align.side = 'caller-only';

    expect(plan.edits).toEqual(editsBefore);
    expect(draft.get('h')?.data.text).toEqual([{ text: 'original', marks: { bold: true } }]);
    expect(draft.get('h')?.data.meta).toEqual({ label: 'original' });
    expect(draft.get('h')?.tunes).toEqual({ align: { side: 'left' } });
  });

  it('normalizes recognized mark values without replacing the shared canonicalizer policy', () => {
    const { draft } = planOn(doc, [{
      name: 'block.update', args: { id: 'h', data: { text: [
        { text: 'A', marks: { bold: false, color: 7, italic: true } },
        { text: 'B', marks: { bold: null, background: null, italic: true } },
      ] } },
    }]);

    expect(draft.get('h')?.data.text).toEqual([{ text: 'AB', marks: { italic: true } }]);
  });

  it('retains warnings from a successful update when a later command fails', () => {
    const warnings: AgentWarning[] = [];
    const snapshot = DocSnapshot.fromOutput(doc);
    const before = snapshot.toOutput();
    const error = failOf(() => planBatch({
      snapshot, batch: { commands: [
        { name: 'block.update', args: { id: 'h', data: { text: '## literal' } } },
        { name: 'block.delete', args: { id: 'missing' } },
      ] }, ctx: plannerContext(), stamp: { actorId: 'agent', at: 1 }, warnings,
    }));

    expect(warnings).toEqual([expect.objectContaining({
      code: 'LOOKS_LIKE_MARKDOWN', commandIndex: 0, blockId: 'h', field: 'text',
    })]);
    expect(error).toMatchObject({ code: 'BLOCK_NOT_FOUND', commandIndex: 1, path: '/commands/1/args/id' });
    expect(snapshot.toOutput()).toEqual(before);
  });
});

describe('block.delete planning', () => {
  it('lifts direct children in declared order with explicit moves before removal', () => {
    const input: OutputData = { blocks: [
      { id: 'before', type: 'paragraph', data: { text: [] }, lastEditedBy: 'before', lastEditedAt: 7 },
      { id: 'tg', type: 'toggle', data: { text: [] }, content: ['b', 'a'] },
      { id: 'a', type: 'paragraph', data: { text: [] }, parent: 'tg', lastEditedBy: 'child', lastEditedAt: 7 },
      { id: 'g', type: 'paragraph', data: { text: [] }, parent: 'b', lastEditedBy: 'grandchild', lastEditedAt: 7 },
      { id: 'b', type: 'toggle', data: { text: [] }, parent: 'tg', content: ['g'], lastEditedBy: 'child', lastEditedAt: 7 },
      { id: 'after', type: 'paragraph', data: { text: [] }, lastEditedBy: 'after', lastEditedAt: 7 },
    ] };
    const snapshot = DocSnapshot.fromOutput(input);
    const before = snapshot.toOutput();
    const { plan, draft } = planBatch({
      snapshot, batch: { commands: [{ name: 'block.delete', args: { id: 'tg' } }] },
      ctx: plannerContext(), stamp: { actorId: 'agent', at: 1 }, warnings: [],
    });

    expect(plan.edits).toEqual([
      { op: 'move', id: 'b', parentId: null, afterId: 'tg' },
      { op: 'move', id: 'a', parentId: null, afterId: 'b' },
      { op: 'remove', id: 'tg', withChildren: false },
    ]);
    expect(plan.results).toEqual([{ removedIds: ['tg'], liftedIds: ['b', 'a'] }]);
    expect(draft.childrenOf(null)).toEqual(['before', 'b', 'a', 'after']);
    expect(draft.parentOf('b')).toBeNull();
    expect(draft.parentOf('a')).toBeNull();
    expect(draft.childrenOf('b')).toEqual(['g']);
    expect(draft.parentOf('g')).toBe('b');
    expect(plan.changed).toEqual({ created: [], updated: [], moved: ['b', 'a'], removed: ['tg'] });
    expect([...plan.touched]).toEqual(['b', 'a']);
    expect(draft.get('b')?.rest).toEqual({ lastEditedBy: 'agent', lastEditedAt: 1 });
    expect(draft.get('a')?.rest).toEqual({ lastEditedBy: 'agent', lastEditedAt: 1 });
    expect(draft.get('g')?.rest).toEqual({ lastEditedBy: 'grandchild', lastEditedAt: 7 });
    expect(draft.get('before')?.rest).toEqual({ lastEditedBy: 'before', lastEditedAt: 7 });
    expect(draft.get('after')?.rest).toEqual({ lastEditedBy: 'after', lastEditedAt: 7 });
    expect(snapshot.toOutput()).toEqual(before);
  });

  it('lifts into the deleted container parent rather than the document root', () => {
    const input: OutputData = { blocks: [
      { id: 'outer', type: 'toggle', data: { text: [] }, content: ['before', 'inner', 'after'], lastEditedBy: 'parent', lastEditedAt: 9 },
      { id: 'before', type: 'paragraph', data: { text: [] }, parent: 'outer' },
      { id: 'inner', type: 'toggle', data: { text: [] }, parent: 'outer', content: ['child'] },
      { id: 'child', type: 'paragraph', data: { text: [] }, parent: 'inner' },
      { id: 'after', type: 'paragraph', data: { text: [] }, parent: 'outer' },
    ] };
    const { plan, draft } = planOn(input, [{ name: 'block.delete', args: { id: 'inner' } }]);

    expect(draft.childrenOf('outer')).toEqual(['before', 'child', 'after']);
    expect(draft.childrenOf(null)).toEqual(['outer']);
    expect(draft.parentOf('child')).toBe('outer');
    expect(plan.edits).toEqual([
      { op: 'move', id: 'child', parentId: 'outer', afterId: 'inner' },
      { op: 'remove', id: 'inner', withChildren: false },
    ]);
    expect([...plan.touched]).toEqual(['child']);
    expect(draft.get('outer')?.rest).toEqual({ lastEditedBy: 'parent', lastEditedAt: 9 });
  });

  it('removes a childless block without inventing moved or touched IDs', () => {
    const { plan, draft } = planOn(doc, [{ name: 'block.delete', args: { id: 'h' } }]);

    expect(draft.has('h')).toBe(false);
    expect(plan.edits).toEqual([{ op: 'remove', id: 'h', withChildren: false }]);
    expect(plan.results).toEqual([{ removedIds: ['h'], liftedIds: [] }]);
    expect(plan.changed).toEqual({ created: [], updated: [], moved: [], removed: ['h'] });
    expect([...plan.touched]).toEqual([]);
  });

  it('removes the entire declared deleting subtree in reading order', () => {
    const input: OutputData = { blocks: [
      { id: 'cl', type: 'column_list', data: {}, content: ['c'] },
      { id: 'c', type: 'column', data: {}, parent: 'cl', content: ['p'] },
      { id: 'p', type: 'paragraph', data: { text: [] }, parent: 'c' },
      { id: 'after', type: 'paragraph', data: { text: [] }, lastEditedBy: 'human', lastEditedAt: 7 },
    ] };
    const { plan, draft } = planOn(input, [{ name: 'block.delete', args: { id: 'cl' } }]);

    expect(plan.results).toEqual([{ removedIds: ['cl', 'c', 'p'], liftedIds: [] }]);
    expect(plan.edits).toEqual([{ op: 'remove', id: 'cl', withChildren: true }]);
    expect(draft.ids()).toEqual(['after']);
    expect(plan.changed).toEqual({ created: [], updated: [], moved: [], removed: ['cl', 'c', 'p'] });
    expect([...plan.touched]).toEqual([]);
    expect(draft.get('after')?.rest).toEqual({ lastEditedBy: 'human', lastEditedAt: 7 });
  });

  it('lifts self-placed children when deletedWithParent is false', () => {
    const tools = new Map(TOOLS);

    tools.set('grid', tool('grid', { selfPlacesChildren: true }));
    const input: OutputData = { blocks: [
      { id: 'grid', type: 'grid', data: {}, content: ['p'] },
      { id: 'p', type: 'paragraph', data: { text: [] }, parent: 'grid' },
    ] };
    const { plan, draft } = planOn(input, [{ name: 'block.delete', args: { id: 'grid' } }], { tools });

    expect(draft.ids()).toEqual(['p']);
    expect(plan.edits).toEqual([
      { op: 'move', id: 'p', parentId: null, afterId: 'grid' },
      { op: 'remove', id: 'grid', withChildren: false },
    ]);
    expect(plan.results).toEqual([{ removedIds: ['grid'], liftedIds: ['p'] }]);
    expect([...plan.touched]).toEqual(['p']);
  });

  it('does not mistake layout or ownership alone for the deleting-children flag', () => {
    const tools = new Map(TOOLS);

    tools.set('frame', tool('frame', {
      children: { accepts: true, ownedByTool: true, layout: true, deletedWithParent: false },
    }));
    const input: OutputData = { blocks: [
      { id: 'frame', type: 'frame', data: {}, content: ['p'] },
      { id: 'p', type: 'paragraph', data: { text: [] }, parent: 'frame' },
    ] };
    const { plan, draft } = planOn(input, [{ name: 'block.delete', args: { id: 'frame' } }], { tools });

    expect(draft.childrenOf(null)).toEqual(['p']);
    expect(plan.results).toEqual([{ removedIds: ['frame'], liftedIds: ['p'] }]);
    expect([...plan.touched]).toEqual(['p']);
  });

  it('deletes opaque containers and preserves their carried descendant attribution', () => {
    const input: OutputData = { blocks: [
      { id: 'kb', type: 'kanban', data: {}, content: ['child'] },
      { id: 'child', type: 'paragraph', data: { text: [] }, parent: 'kb', content: ['deep'] },
      { id: 'deep', type: 'paragraph', data: { text: [] }, parent: 'child', lastEditedBy: 'deep-human', lastEditedAt: 7 },
    ] };
    const { plan, draft } = planOn(input, [{ name: 'block.delete', args: { id: 'kb' } }]);

    expect(draft.childrenOf(null)).toEqual(['child']);
    expect(plan.results).toEqual([{ removedIds: ['kb'], liftedIds: ['child'] }]);
    expect(plan.edits).toEqual([
      { op: 'move', id: 'child', parentId: null, afterId: 'kb' },
      { op: 'remove', id: 'kb', withChildren: false },
    ]);
    expect([...plan.touched]).toEqual(['child']);
    expect(draft.get('child')?.rest).toEqual({ lastEditedBy: 'agent', lastEditedAt: 1 });
    expect(draft.get('deep')?.rest).toEqual({ lastEditedBy: 'deep-human', lastEditedAt: 7 });
  });

  it('deletes the last block without seeding a browser fallback paragraph', () => {
    const { plan, draft } = planOn({ blocks: [{ id: 'p', type: 'paragraph', data: { text: [] } }] }, [{
      name: 'block.delete', args: { id: 'p' },
    }]);

    expect(draft.toOutput().blocks).toEqual([]);
    expect(plan.results).toEqual([{ removedIds: ['p'], liftedIds: [] }]);
    expect(plan.changed.created).toEqual([]);
  });

  it('allows a later update to address a lifted child in the same batch', () => {
    const { plan, draft } = planOn(doc, [
      { name: 'block.delete', args: { id: 'tg' } },
      { name: 'block.update', args: { id: 'k', data: { text: 'Lifted' } } },
    ]);

    expect(draft.get('k')?.data.text).toEqual([{ text: 'Lifted' }]);
    expect(draft.parentOf('k')).toBeNull();
    expect(plan.results).toEqual([{ removedIds: ['tg'], liftedIds: ['k'] }, { id: 'k' }]);
    expect(plan.changed).toEqual({ created: [], updated: ['k'], moved: ['k'], removed: ['tg'] });
    expect([...plan.touched]).toEqual(['k']);
  });

  it('preserves historical update payloads before a later subtree deletion', () => {
    const { plan, draft } = planOn(doc, [
      { name: 'block.update', args: { id: 'c', data: { label: { text: 'kept' } } } },
      { name: 'block.delete', args: { id: 'cl' } },
    ]);

    expect(plan.edits).toEqual([
      { op: 'setData', id: 'c', patch: { label: { text: 'kept' } } },
      { op: 'remove', id: 'cl', withChildren: true },
    ]);
    expect(draft.has('c')).toBe(false);
    expect(plan.changed).toEqual({ created: [], updated: [], moved: [], removed: ['cl', 'c'] });
  });

});

describe('block.duplicate planning', () => {
  it('deep-copies a subtree with fresh IDs immediately after its source', () => {
    const { plan, draft } = planOn(doc, [{ name: 'block.duplicate', args: { id: 'tg' } }]);

    expect(plan.results).toEqual([{ id: 'n1', childIds: ['n2'] }]);
    expect(draft.childrenOf(null).slice(0, 4)).toEqual(['h', 'tg', 'n1', 'cl']);
    expect(draft.childrenOf('n1')).toEqual(['n2']);
    expect(draft.parentOf('n2')).toBe('n1');
    expect(draft.get('n1')?.data).toEqual({ text: [{ text: 'T' }] });
    expect(draft.get('n2')?.data).toEqual({ text: [{ text: 'K' }] });
    expect(plan.changed).toEqual({ created: ['n1', 'n2'], updated: [], moved: [], removed: [] });
    expect([...plan.touched]).toEqual(['n1', 'n2']);
    expect(draft.get('n1')?.rest).toEqual({ lastEditedBy: 'agent', lastEditedAt: 1 });
    expect(draft.get('n2')?.rest).toEqual({ lastEditedBy: 'agent', lastEditedAt: 1 });
    expect(draft.get('tg')?.rest).toEqual({ lastEditedBy: 'human', lastEditedAt: 8 });
    expect(draft.get('k')?.rest).toEqual({ lastEditedBy: 'child', lastEditedAt: 7 });
  });

  it('preserves recursive child order and returns only direct child IDs', () => {
    const input: OutputData = { blocks: [
      { id: 'root', type: 'toggle', data: { text: [] }, content: ['b', 'a'] },
      { id: 'a', type: 'paragraph', data: { text: [{ text: 'A' }] }, parent: 'root' },
      { id: 'g', type: 'paragraph', data: { text: [{ text: 'G' }] }, parent: 'b' },
      { id: 'b', type: 'toggle', data: { text: [{ text: 'B' }] }, parent: 'root', content: ['g'] },
    ] };
    const { plan, draft } = planOn(input, [{ name: 'block.duplicate', args: { id: 'root' } }]);

    expect(plan.results).toEqual([{ id: 'n1', childIds: ['n2', 'n4'] }]);
    expect(draft.childrenOf('n1')).toEqual(['n2', 'n4']);
    expect(draft.childrenOf('n2')).toEqual(['n3']);
    expect(draft.get('n2')?.data.text).toEqual([{ text: 'B' }]);
    expect(draft.get('n3')?.data.text).toEqual([{ text: 'G' }]);
    expect(draft.get('n4')?.data.text).toEqual([{ text: 'A' }]);
    expect(plan.changed.created).toEqual(['n1', 'n2', 'n3', 'n4']);
  });

  it('keeps a default duplicate in the source parent', () => {
    const { plan, draft } = planOn(doc, [{ name: 'block.duplicate', args: { id: 'k' } }]);

    expect(draft.childrenOf('tg')).toEqual(['k', 'n1']);
    expect(draft.parentOf('n1')).toBe('tg');
    expect(draft.childrenOf(null)).not.toContain('n1');
    expect(plan.results).toEqual([{ id: 'n1', childIds: [] }]);
  });

  it.each([
    { position: 'start', order: ['n1', 'h', 'tg', 'cl', 'img', 'tbl', 'kb'] },
    { position: 'end', order: ['h', 'tg', 'cl', 'img', 'tbl', 'kb', 'n1'] },
    { position: { before: 'h' }, order: ['n1', 'h', 'tg', 'cl', 'img', 'tbl', 'kb'] },
    { position: { after: 'cl' }, order: ['h', 'tg', 'cl', 'n1', 'img', 'tbl', 'kb'] },
  ])('honors an explicit root placement', ({ position, order }) => {
    const header = registered('header');
    const dataSchema = structuredClone(header.entry.data);
    if (!isRecord(dataSchema.properties)) {
      throw new Error('Expected fixture schema properties');
    }
    dataSchema.properties.old = { type: 'string' };
    const tools = new Map(TOOLS);

    tools.set('header', tool('header', { ...header.entry, data: dataSchema }, header.runtime));
    const { draft } = planOn(doc, [{ name: 'block.duplicate', args: { id: 'h', position } }], { tools });

    expect(draft.childrenOf(null)).toEqual(order);
  });

  it('infers a destination parent from the position sibling', () => {
    const header = registered('header');
    const dataSchema = structuredClone(header.entry.data);
    if (!isRecord(dataSchema.properties)) {
      throw new Error('Expected fixture schema properties');
    }
    dataSchema.properties.old = { type: 'string' };
    const tools = new Map(TOOLS);

    tools.set('header', tool('header', { ...header.entry, data: dataSchema }, header.runtime));
    const { draft } = planOn(doc, [{
      name: 'block.duplicate', args: { id: 'h', position: { after: 'k' } },
    }], { tools });

    expect(draft.childrenOf('tg')).toEqual(['k', 'n1']);
    expect(draft.parentOf('n1')).toBe('tg');
    expect(draft.get('n1')?.type).toBe('header');
  });

  it('refuses a destination child restriction without silently demoting the copy', () => {
    const input: OutputData = { blocks: [
      { id: 'h', type: 'header', data: { text: [], level: 2 } },
      { id: 'cl', type: 'column_list', data: {}, content: ['c'] },
      { id: 'c', type: 'column', data: {}, parent: 'cl' },
    ] };
    const error = failOf(() => planOn(input, [{
      name: 'block.duplicate', args: { id: 'h', position: { before: 'c' } },
    }]));

    expect(error).toMatchObject({ code: 'PLACEMENT_REFUSED', details: { reason: 'CHILD_NOT_ALLOWED' } });
  });

  it('reports a missing position sibling with its command pointer', () => {
    const error = failOf(() => planOn(doc, [{
      name: 'block.duplicate', args: { id: 'h', position: { after: 'missing' } },
    }]));

    expect(error).toMatchObject({
      code: 'BLOCK_NOT_FOUND', commandIndex: 0, path: '/commands/0/args/position/after',
    });
  });

  it('refuses an opaque source with the public opaque diagnostic', () => {
    const error = failOf(() => planOn(doc, [{ name: 'block.duplicate', args: { id: 'kb' } }]));

    expect(error).toMatchObject({
      code: 'UNKNOWN_TOOL', commandIndex: 0, path: '/commands/0/args/id', details: { opaque: true },
    });
  });

  it('does not seed runtime default children when the saved source has none', () => {
    const tools = new Map(TOOLS);

    tools.set('seeded', tool('seeded', {}, { defaultChildren: [{ type: 'paragraph', data: { text: 'Default' } }] }));
    const { plan, draft } = planOn({ blocks: [{ id: 'source', type: 'seeded', data: {} }] }, [{
      name: 'block.duplicate', args: { id: 'source' },
    }], { tools });

    expect(draft.childrenOf('n1')).toEqual([]);
    expect(plan.results).toEqual([{ id: 'n1', childIds: [] }]);
    expect(plan.changed.created).toEqual(['n1']);
  });

  it('runs the reusable builder preparation without the block.insert create-action refusal', () => {
    const tools = new Map(TOOLS);
    const commands = coreCommandMap();
    const sanitizeBlockData = vi.fn((_type: string, data: Record<string, unknown>) => ({ ...data, label: 'clean' }));
    const normalize = vi.fn((data: Record<string, unknown>) => ({ ...data, ready: true }));

    const paragraph = registered('paragraph');
    const dataSchema = structuredClone(paragraph.entry.data);

    if (!isRecord(dataSchema.properties)) {
      throw new Error('Expected fixture schema properties');
    }
    dataSchema.properties.label = { type: 'string' };
    tools.set('paragraph', tool('paragraph', { ...paragraph.entry, data: dataSchema }, paragraph.runtime));
    tools.set('grid', tool('grid', {
      selfPlacesChildren: true,
      children: { accepts: true, ownedByTool: true, layout: false, deletedWithParent: true },
    }, { normalize }));
    commands.set('grid.create', {
      name: 'grid.create', args: { type: 'object' }, readOnly: false, available: true,
      source: { tool: 'grid', target: 'create' },
    });
    const { plan, draft } = planOn({ blocks: [
      { id: 'source', type: 'grid', data: { label: 'dirty' }, content: ['child'] },
      { id: 'child', type: 'paragraph', data: { text: [] }, parent: 'source' },
    ] }, [{ name: 'block.duplicate', args: { id: 'source' } }], {
      tools, commands, ports: stubPorts({ sanitizeBlockData }),
    });

    expect(draft.childrenOf('n1')).toEqual(['n2']);
    expect(draft.get('n1')?.data).toEqual({ label: 'clean', ready: true });
    expect(normalize).toHaveBeenCalledExactlyOnceWith({ label: 'clean' });
    expect(plan.results).toEqual([{ id: 'n1', childIds: ['n2'] }]);
  });

  it('remaps only table-cell block references and leaves equal-valued text, links and cell identities alone', () => {
    const input: OutputData = { blocks: [
      { id: 'tbl', type: 'table', data: {
        content: [[
          { blocks: ['a', 'b'], id: 'a', rowId: 'b', label: 'a' },
          { blocks: ['outside'], id: 'col-2', rowId: 'row-1' },
        ]],
        label: 'a', meta: { id: 'b', blocks: ['a'] },
      }, content: ['a', 'b'] },
      { id: 'a', type: 'paragraph', data: { text: [
        { text: 'a', marks: { link: { href: 'b' } } },
        { embed: { page: { id: 'b' } } },
      ] }, parent: 'tbl' },
      { id: 'b', type: 'paragraph', data: { text: [{ text: 'b' }] }, parent: 'tbl' },
      { id: 'outside', type: 'paragraph', data: { text: [] } },
    ] };
    const { plan, draft } = planOn(input, [{ name: 'block.duplicate', args: { id: 'tbl' } }]);

    expect(draft.get('n1')?.data).toEqual({
      content: [[
        { blocks: ['n2', 'n3'], id: 'a', rowId: 'b', label: 'a' },
        { blocks: ['outside'], id: 'col-2', rowId: 'row-1' },
      ]],
      label: 'a', meta: { id: 'b', blocks: ['a'] },
    });
    expect(draft.get('n2')?.data.text).toEqual([
      { text: 'a', marks: { link: { href: 'b' } } },
      { embed: { page: { id: 'b' } } },
    ]);
    expect(draft.get('n3')?.data.text).toEqual([{ text: 'b' }]);
    expect(draft.childrenOf('n1')).toEqual(['n2', 'n3']);
    expect(plan.results).toEqual([{ id: 'n1', childIds: ['n2', 'n3'] }]);
    expect(draft.get('tbl')?.data).toEqual(input.blocks[0]?.data);
  });

  it('does not treat arbitrary custom blocks, content or id fields as table references', () => {
    const tools = new Map(TOOLS);

    tools.set('custom', tool('custom'));
    const data = { id: 'child', blocks: ['child'], content: [[{ blocks: ['child'] }]], label: 'child' };
    const { draft } = planOn({ blocks: [
      { id: 'source', type: 'custom', data, content: ['child'] },
      { id: 'child', type: 'paragraph', data: { text: [{ text: 'source' }] }, parent: 'source' },
    ] }, [{ name: 'block.duplicate', args: { id: 'source' } }], { tools });

    expect(draft.get('n1')?.data).toEqual(data);
    expect(draft.get('n2')?.data.text).toEqual([{ text: 'source' }]);
    expect(draft.childrenOf('n1')).toEqual(['n2']);
  });

  it('preserves own JSON keys and independently copies nested data and tunes', () => {
    const nested = Object.fromEntries([['__proto__', { value: 'leaf' }], ['constructor', 'leaf']]);
    const input: OutputData = { blocks: [
      { id: 'source', type: 'toggle', data: { text: [], nested }, tunes: { align: { side: 'left' } }, content: ['leaf'] },
      { id: 'leaf', type: 'paragraph', data: { text: [{ text: 'leaf' }] }, parent: 'source', tunes: { meta: { label: 'leaf' } } },
    ] };
    const snapshot = DocSnapshot.fromOutput(input);
    const before = snapshot.toOutput();
    const { plan, draft } = planBatch({
      snapshot, batch: { commands: [{ name: 'block.duplicate', args: { id: 'source' } }] },
      ctx: plannerContext(), stamp: { actorId: 'agent', at: 1 }, warnings: [],
    });
    const editsBefore = structuredClone(plan.edits);
    const copied = draft.get('n1');
    const child = draft.get('n2');

    if (copied === undefined || !isRecord(copied.data.nested) ||
        !isRecord(copied.data.nested.__proto__) || copied.tunes === undefined ||
        !isRecord(copied.tunes.align) || child === undefined || child.tunes === undefined ||
        !isRecord(child.tunes.meta)) {
      throw new Error('Expected copied nested JSON and tunes');
    }

    expect(Object.hasOwn(copied.data.nested, '__proto__')).toBe(true);
    expect(Reflect.has(copied.data.nested, 'value')).toBe(false);
    expect(copied.data.nested.constructor).toBe('leaf');
    copied.data.nested.__proto__.value = 'copy-only';
    copied.tunes.align.side = 'right';
    child.tunes.meta.label = 'copy-only';

    expect(draft.get('source')?.data).toEqual(input.blocks[0]?.data);
    expect(draft.get('source')?.tunes).toEqual({ align: { side: 'left' } });
    expect(draft.get('leaf')?.tunes).toEqual({ meta: { label: 'leaf' } });
    expect(plan.edits).toEqual(editsBefore);
    expect(snapshot.toOutput()).toEqual(before);
    expect(input.blocks[0]?.data.nested).toEqual(nested);
  });

  it('keeps copied data, tunes and the insert edit independent from later source-draft mutations', () => {
    const { plan, draft } = planOn({ blocks: [{
      id: 'source', type: 'toggle', data: { text: [], meta: { label: 'original' } },
      tunes: { align: { side: 'left' } },
    }] }, [{ name: 'block.duplicate', args: { id: 'source' } }]);
    const before = structuredClone(plan.edits);
    const source = draft.get('source');

    if (source === undefined || !isRecord(source.data.meta) || source.tunes === undefined ||
        !isRecord(source.tunes.align)) {
      throw new Error('Expected source payloads');
    }
    source.data.meta.label = 'source-only';
    source.tunes.align.side = 'source-only';

    expect(plan.edits).toEqual(before);
    expect(draft.get('n1')?.data.meta).toEqual({ label: 'original' });
    expect(draft.get('n1')?.tunes).toEqual({ align: { side: 'left' } });
  });

  it('remaps table references inside a recursively copied container', () => {
    const tools = new Map(TOOLS);

    tools.set('outer', tool('outer'));
    const { plan, draft } = planOn({ blocks: [
      { id: 'outer', type: 'outer', data: {}, content: ['tbl'] },
      { id: 'tbl', type: 'table', data: { content: [[{ blocks: ['p'] }]] }, parent: 'outer', content: ['p'] },
      { id: 'p', type: 'paragraph', data: { text: [{ text: 'p' }] }, parent: 'tbl' },
    ] }, [{ name: 'block.duplicate', args: { id: 'outer' } }], { tools });

    expect(draft.get('n2')?.data.content).toEqual([[{ blocks: ['n3'] }]]);
    expect(draft.get('n3')?.data.text).toEqual([{ text: 'p' }]);
    expect(draft.childrenOf('n1')).toEqual(['n2']);
    expect(draft.childrenOf('n2')).toEqual(['n3']);
    expect(plan.results).toEqual([{ id: 'n1', childIds: ['n2'] }]);
  });

  it('copies deleting layout containers without re-seeding their default columns', () => {
    const { plan, draft } = planOn(doc, [{ name: 'block.duplicate', args: { id: 'cl' } }]);

    expect(draft.childrenOf('n1')).toEqual(['n2']);
    expect(draft.get('n1')?.type).toBe('column_list');
    expect(draft.get('n2')?.type).toBe('column');
    expect(draft.parentOf('n2')).toBe('n1');
    expect(plan.results).toEqual([{ id: 'n1', childIds: ['n2'] }]);
    expect(plan.changed.created).toEqual(['n1', 'n2']);
  });

  it('does not consume an explicit ID reserved for a later insert in the batch', () => {
    const { plan, draft } = planOn(doc, [
      { name: 'block.duplicate', args: { id: 'tg' } },
      { name: 'block.insert', args: { id: 'n1', type: 'paragraph', data: { text: 'Reserved' } } },
    ]);

    expect(plan.results).toEqual([{ id: 'n2', childIds: ['n3'] }, { id: 'n1', childIds: [] }]);
    expect(draft.get('n1')?.data.text).toEqual([{ text: 'Reserved' }]);
    expect(draft.childrenOf('n2')).toEqual(['n3']);
    expect(plan.changed.created).toEqual(['n2', 'n3', 'n1']);
  });

  it('allocates fresh IDs even when the ID port first returns existing IDs', () => {
    const candidates = ['tg', 'k', 'n1', 'n2'];
    let next = 0;
    const newId = (): string => candidates[next++] ?? 'fresh-' + next;
    const { plan, draft } = planOn(doc, [{ name: 'block.duplicate', args: { id: 'tg' } }], {
      ports: stubPorts({ newId }),
    });
    const copy = copyResult(plan.results[0]);

    expect([copy.id, ...copy.childIds].some(id => doc.blocks.some(block => block.id === id))).toBe(false);
    expect(new Set([copy.id, ...copy.childIds]).size).toBe(2);
    expect(draft.childrenOf(copy.id)).toEqual(copy.childIds);
    expect(draft.get('tg')?.data.text).toEqual([{ text: 'T' }]);
  });
});

describe('shared update/delete/duplicate ID and ref behavior', () => {
  it.each(['block.update', 'block.delete', 'block.duplicate'] satisfies AgentCommand['name'][])(
    '%s reports a missing literal block at the public ID pointer',
    name => {
      const error = failOf(() => planOn(doc, [{ name, args: { id: 'missing' } }]));

      expect(error).toMatchObject({
        code: 'BLOCK_NOT_FOUND', commandIndex: 0, path: '/commands/0/args/id', details: { id: 'missing' },
      });
    }
  );

  it.each(['constructor', 'toString', '__proto__'])('resolves a duplicate-created own ref %s for later updates and placement', ref => {
    const header = registered('header');
    const dataSchema = structuredClone(header.entry.data);
    if (!isRecord(dataSchema.properties)) {
      throw new Error('Expected fixture schema properties');
    }
    dataSchema.properties.old = { type: 'string' };
    const tools = new Map(TOOLS);

    tools.set('header', tool('header', { ...header.entry, data: dataSchema }, header.runtime));
    const { plan, draft } = planOn(doc, [
      { name: 'block.duplicate', ref, args: { id: 'h' } },
      { name: 'block.update', args: { id: '$' + ref, data: { text: 'Changed' } } },
      { name: 'block.duplicate', args: { id: 'h', position: { before: '$' + ref } } },
    ], { tools });

    expect(draft.get('n1')?.data.text).toEqual([{ text: 'Changed' }]);
    expect(Object.hasOwn(plan.refs, ref)).toBe(true);
    expect(plan.refs[ref]).toBe('n1');
    expect(JSON.stringify(plan.refs)).toBe(JSON.stringify(Object.fromEntries([[ref, 'n1']])));
    expect(draft.childrenOf(null).slice(0, 3)).toEqual(['h', 'n2', 'n1']);
    expect(plan.changed.created).toEqual(['n1', 'n2']);
    expect(plan.changed.updated).toEqual([]);
    expect([...plan.touched]).toEqual(['n1', 'n2']);
  });

  const unknownRefs = (['block.update', 'block.delete', 'block.duplicate'] satisfies AgentCommand['name'][])
    .flatMap(name => ['constructor', 'toString', '__proto__'].map(ref => ({ name, ref })));

  it.each(unknownRefs)('$name rejects an uncreated own-key-like ref $ref', ({ name, ref }) => {
    const error = failOf(() => planOn(doc, [{ name, args: { id: '$' + ref } }]));

    expect(error).toMatchObject({
      code: 'BLOCK_NOT_FOUND', commandIndex: 0, path: '/commands/0/args/id', details: { ref },
    });
  });

  it.each(['constructor', 'toString', '__proto__'])('rejects a deleted own ref %s instead of dereferencing an absent block', ref => {
    const error = failOf(() => planOn(doc, [
      { name: 'block.duplicate', ref, args: { id: 'h' } },
      { name: 'block.delete', args: { id: '$' + ref } },
      { name: 'block.update', args: { id: '$' + ref, data: { text: 'Too late' } } },
    ]));

    expect(error).toMatchObject({ code: 'BLOCK_NOT_FOUND', commandIndex: 2, path: '/commands/2/args/id' });
  });

  it.each(['block.update', 'block.delete'] satisfies AgentCommand['name'][])(
    '%s cannot attach a ref to a noncreating result',
    name => {
      const error = failOf(() => planOn(doc, [{ name, ref: 'not-created', args: { id: 'h' } }]));

      expect(error).toMatchObject({ code: 'INVALID_ARGS', commandIndex: 0, path: '/commands/0/ref' });
    }
  );

  it('resolves duplicate-created refs as a later duplicate source and deletion target', () => {
    const { plan, draft } = planOn(doc, [
      { name: 'block.duplicate', ref: 'first', args: { id: 'tg' } },
      { name: 'block.duplicate', ref: 'second', args: { id: '$first' } },
      { name: 'block.delete', args: { id: '$first' } },
    ]);

    expect(plan.results).toEqual([
      { id: 'n1', childIds: ['n2'] },
      { id: 'n3', childIds: ['n4'] },
      { removedIds: ['n1'], liftedIds: ['n2'] },
    ]);
    expect(draft.childrenOf('n3')).toEqual(['n4']);
    expect(draft.get('n4')?.data.text).toEqual([{ text: 'K' }]);
    expect(draft.parentOf('n2')).toBeNull();
    expect(draft.childrenOf(null).slice(0, 4)).toEqual(['h', 'tg', 'n2', 'n3']);
    expect(plan.changed).toEqual({ created: ['n2', 'n3', 'n4'], updated: [], moved: [], removed: ['n1'] });
  });
});

describe('Task9 controlling normalizer and placement boundaries', () => {
  it('uses normalized rich output, canonicalizes and sanitizes it, and leaves unchanged legacy fields alone', () => {
    const normalize = vi.fn((data: Record<string, unknown>) => ({
      ...data,
      title: [{ text: 'A', marks: { bold: true } }, { text: 'B', marks: { bold: true } }],
      body: [{ embed: { page: { id: 'page-1' } } }],
    }));
    const sanitizeBlockData = vi.fn((_type: string, data: Record<string, unknown>) => {
      const first = isArray(data.title) ? data.title[0] : undefined;

      return isRecord(first) && first.text === 'AB'
        ? { ...data, title: [{ text: 'Clean', marks: { bold: true } }] }
        : data;
    });
    const tools = new Map(TOOLS);

    tools.set('two', tool('two', { richTextFields: ['title', 'body', 'legacy'] }, { normalize }));
    const input: OutputData = { blocks: [{
      id: 'two', type: 'two', data: {
        title: [], body: [], legacy: { unchecked: true }, old: 'keep',
      },
    }] };
    const { plan, draft } = planOn(input, [{
      name: 'block.update', args: { id: 'two', data: { title: 'Caller' } },
    }], { tools, ports: stubPorts({ sanitizeBlockData }) });

    expect(draft.get('two')?.data).toEqual({
      title: [{ text: 'Clean', marks: { bold: true } }],
      body: [{ embed: { page: { id: 'page-1' } } }],
      legacy: { unchecked: true }, old: 'keep',
    });
    expect(plan.edits).toEqual([
      { op: 'setRichText', id: 'two', field: 'title', value: [{ text: 'Clean', marks: { bold: true } }] },
      { op: 'setRichText', id: 'two', field: 'body', value: [{ embed: { page: { id: 'page-1' } } }] },
    ]);
    expect(normalize).toHaveBeenCalledExactlyOnceWith({
      title: [{ text: 'Caller' }], body: [], legacy: { unchecked: true }, old: 'keep',
    });
    expect(sanitizeBlockData).toHaveBeenCalledWith('two', expect.objectContaining({
      title: [{ text: 'AB', marks: { bold: true } }],
    }));
  });

  it('removes omitted rich and ordinary keys from the normalizer whole-record result', () => {
    const normalize = vi.fn((data: Record<string, unknown>) => ({ level: data.level }));
    const tools = new Map(TOOLS);

    tools.set('header', tool('header', registered('header').entry, { normalize }));
    const { plan, draft } = planOn(doc, [{
      name: 'block.update', args: { id: 'h', data: { level: 3 } },
    }], { tools });

    expect(draft.get('h')?.data).toEqual({ level: 3 });
    expect(plan.edits).toEqual([{
      op: 'setData', id: 'h', patch: { level: 3, text: null, old: null },
    }]);
    expect(normalize).toHaveBeenCalledExactlyOnceWith({
      text: [{ text: 'H' }], level: 3, old: 'x',
    });
  });

  it('preserves equal caller writes after normalization without emitting untouched legacy keys', () => {
    const normalize = vi.fn((data: Record<string, unknown>) => ({ ...data }));
    const tools = new Map(TOOLS);

    tools.set('header', tool('header', registered('header').entry, { normalize }));
    const { plan } = planOn(doc, [{
      name: 'block.update', args: { id: 'h', data: { text: 'H', level: 2 } },
    }], { tools });

    expect(plan.edits).toEqual([
      { op: 'setRichText', id: 'h', field: 'text', value: [{ text: 'H' }] },
      { op: 'setData', id: 'h', patch: { level: 2 } },
    ]);
    expect(normalize).toHaveBeenCalledExactlyOnceWith({
      text: [{ text: 'H' }], level: 2, old: 'x',
    });
  });

  it('permits derived guarded-field repairs while carrying unchanged view state without writing it', () => {
    const repaired = [[{ blocks: [], id: 'column-fixed', rowId: 'row-fixed' }]];
    const normalize = vi.fn((data: Record<string, unknown>) => ({ ...data, content: repaired }));
    const tools = new Map(TOOLS);

    tools.set('table', tool('table', { ...registered('table').entry, viewState: ['zoom'] }, { normalize }));
    const input: OutputData = { blocks: [{
      id: 'tbl', type: 'table', data: { content: [[{ blocks: [] }]], zoom: 1 },
    }] };
    const { plan, draft } = planOn(input, [{
      name: 'block.update', args: { id: 'tbl', data: { label: 'changed' } },
    }], { tools });

    expect(draft.get('tbl')?.data).toEqual({ content: repaired, zoom: 1, label: 'changed' });
    expect(plan.edits).toEqual([{
      op: 'setData', id: 'tbl', patch: { label: 'changed', content: repaired },
    }]);
    expect(normalize).toHaveBeenCalledExactlyOnceWith({
      content: [[{ blocks: [] }]], zoom: 1, label: 'changed',
    });
  });

  it.each([
    { value: [{ text: 'ambiguous', embed: { html: 'also content' } }] },
    { value: [{ embed: { page: { id: 7 } } }] },
  ])('refuses malformed rich values produced by normalization', ({ value }) => {
    const normalize = vi.fn((data: Record<string, unknown>) => ({ ...data, text: value }));
    const tools = new Map(TOOLS);

    tools.set('header', tool('header', registered('header').entry, { normalize }));

    expect(() => planOn(doc, [{
      name: 'block.update', args: { id: 'h', data: { level: 3 } },
    }], { tools })).toThrow(AgentFailure);
    expect(normalize).toHaveBeenCalledTimes(1);
  });

  it.each([
    { mode: 'create', existing: { url: 'u' } },
    { mode: 'change', existing: { url: 'u', zoom: 1 } },
    { mode: 'remove', existing: { url: 'u', zoom: 1 } },
  ])('refuses a normalizer view-state $mode', ({ mode, existing }) => {
    const normalize = vi.fn((data: Record<string, unknown>) => mode === 'remove'
      ? Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'zoom'))
      : { ...data, zoom: 2 });
    const tools = new Map(TOOLS);

    tools.set('image', tool('image', registered('image').entry, { normalize }));
    const error = failOf(() => planOn({ blocks: [{ id: 'img', type: 'image', data: existing }] }, [{
      name: 'block.update', args: { id: 'img', data: { url: 'changed' } },
    }], { tools }));

    expect(error).toMatchObject({
      code: 'FIELD_NOT_WRITABLE', commandIndex: 0,
      details: { reason: 'view-state', field: 'zoom' },
    });
    expect(normalize).toHaveBeenCalledTimes(1);
  });

  it.each([
    { id: 'child', position: undefined },
    { id: 'h', position: { after: 'child' } },
  ])('refuses an unmapped duplicate destination under a self-placing parent', ({ id, position }) => {
    const tools = new Map(TOOLS);
    const commands = coreCommandMap();

    tools.set('grid', tool('grid', { selfPlacesChildren: true }));
    for (const name of ['grid.insertIntoCell', 'grid.addRow']) {
      commands.set(name, {
        name, args: { type: 'object' }, readOnly: false, available: true,
        source: { tool: 'grid', target: 'block' },
      });
    }
    const input: OutputData = { blocks: [
      { id: 'grid', type: 'grid', data: {}, content: ['child'] },
      { id: 'child', type: 'paragraph', data: { text: [] }, parent: 'grid' },
      { id: 'h', type: 'header', data: { text: [], level: 2 } },
    ] };
    const error = failOf(() => planOn(input, [{
      name: 'block.duplicate', args: { id, ...(position === undefined ? {} : { position }) },
    }], { tools, commands }));

    expect(error).toMatchObject({
      code: 'PLACEMENT_REFUSED', commandIndex: 0,
      details: { reason: 'SELF_PLACED_PARENT', use: ['grid.addRow', 'grid.insertIntoCell'] },
    });
  });

  it('does not attach an update ref to a block created by an earlier command', () => {
    const error = failOf(() => planOn(doc, [
      { name: 'block.duplicate', ref: 'created', args: { id: 'h' } },
      { name: 'block.update', ref: 'not-created-here', args: { id: '$created', data: { level: 3 } } },
    ]));

    expect(error).toMatchObject({
      code: 'INVALID_ARGS', commandIndex: 1, path: '/commands/1/ref',
    });
  });
});
