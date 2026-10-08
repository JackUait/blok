// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildBuiltInSnapshot } from '../../../src/shared/built-in-snapshot';
import { readCustomToolsFile, runtimesWithCustomTools, snapshotWithCustomTools } from '../../../src/shared/custom-tools-file';
import { INLINE_TEXT_SANITIZE } from '../../../src/shared/inline-text-sanitize';
import { validateAgainst } from '../../../src/shared/schema/validate';
import { getEffectiveRuleForString } from '../../../src/shared/sanitize-walk';
import { BUILT_IN_TOOL_RUNTIMES } from '../../../src/shared/tool-actions';
import { composeToolSanitize } from '../../../src/shared/tool-actions/runtime';
import { BUILT_IN_INLINE_SANITIZE } from '../../../src/shared/tool-descriptions/sanitize/inline';
import { buildToolManifest } from '../../../src/shared/tool-manifest';
import { sanitizeHtmlFragment } from '../../../src/view/sanitize';

import type { BlokCustomToolsFile, SanitizerConfig, SnapshotBlockStatics } from '../../../types';
import type { ToolRuntime } from '../../../src/shared/tool-actions/runtime';

const statics: SnapshotBlockStatics = {
  toolbox: [],
  richTextFields: [],
  acceptsChildren: false,
  ownsChildren: false,
  isLayout: false,
  deletesChildren: false,
  selfPlacesChildren: false,
  restrictedInTableCell: false,
  conversion: {},
  convertible: { import: false, export: false },
  hasPrepareInsert: false,
};

const minimalBlock: BlokCustomToolsFile['blocks'][number] = {
  name: 'note',
  description: { summary: 'A note.', data: {} },
  statics,
};

const fullBlock: BlokCustomToolsFile['blocks'][number] = {
  name: 'quiz',
  description: {
    summary: 'A quiz.',
    guidance: 'Write the question before grading.',
    data: {
      type: 'object',
      required: ['question'],
      properties: {
        question: { type: 'array', items: { type: 'object' } },
        answer: { type: 'array', items: { type: 'object' } },
        score: { type: 'number', minimum: 0 },
      },
      additionalProperties: false,
    },
    defaultData: { question: [], score: 0 },
    examples: [{ question: [{ text: 'Question' }], score: 0 }],
    summaryFields: ['score'],
    inputFields: ['question', 'answer'],
    viewState: ['expanded'],
    guardedFields: { score: 'quiz.grade' },
    actions: [{
      name: 'grade',
      summary: 'Grade the answer.',
      guidance: 'Use a non-negative score.',
      args: { type: 'object', required: ['score'], properties: { score: { type: 'number', minimum: 0 } } },
      result: { type: 'object', properties: { graded: { type: 'boolean' } } },
      target: 'block',
      runtime: 'any',
      effects: 'host',
      preconditions: ['An answer exists.'],
      requires: ['pageBackend'],
      uses: ['host'],
      mirrors: ['quiz.grade'],
    }, {
      name: 'create',
      summary: 'Create a quiz.',
      target: 'create',
      args: { type: 'object' },
      runtime: 'editor',
    }],
  },
  statics: {
    toolbox: [
      { name: 'quiz', title: 'Question', data: { score: 0 }, previewCaption: 'Ask a question.' },
      { name: 'quizAlternate', title: 'Alternate question' },
    ],
    richTextFields: ['question', 'answer'],
    acceptsChildren: true,
    childTools: { allow: ['paragraph'], deny: ['table'] },
    ownsChildren: true,
    isLayout: true,
    deletesChildren: true,
    selfPlacesChildren: true,
    restrictedInTableCell: true,
    conversion: { import: 'question', export: 'question' },
    convertible: { import: true, export: true },
    assetKind: 'file',
    hasPrepareInsert: true,
  },
  sanitize: {
    question: { br: true, strong: true, a: { href: true, target: '_blank', rel: false } },
    answer: { em: true },
    enabled: true,
    caption: false,
  },
};

const fileOf = (...blocks: BlokCustomToolsFile['blocks']): BlokCustomToolsFile => ({
  formatVersion: 1,
  blocks,
});

const typeFailure = (value: unknown): TypeError => {
  try {
    readCustomToolsFile(value);
  } catch (error) {
    if (error instanceof TypeError) {
      return error;
    }
    throw error;
  }

  throw new Error('Expected a path-naming TypeError');
};

const runtimeOf = (runtimes: ReadonlyMap<string, ToolRuntime>, name: string): ToolRuntime => {
  const runtime = runtimes.get(name);

  if (runtime === undefined) {
    throw new Error(`Missing runtime "${name}"`);
  }

  return runtime;
};

const cleanField = (runtime: ToolRuntime, field: string, html: string): string => {
  const rule = runtime.sanitize[field];

  if (rule === undefined) {
    throw new Error(`Missing sanitizer field "${field}"`);
  }

  const effective = getEffectiveRuleForString(rule, {});

  return effective === null ? html : sanitizeHtmlFragment(html, effective);
};

const sanitizeState = (config: SanitizerConfig): string => JSON.stringify(
  config,
  (_key, value: unknown) => typeof value === 'function' ? `[function ${value.name}]` : value
);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readCustomToolsFile', () => {
  it('reads the smallest file and a block with only required fields', () => {
    const empty: unknown = { formatVersion: 1, blocks: [] };
    const input: unknown = fileOf(structuredClone(minimalBlock));

    expect(readCustomToolsFile(empty)).toEqual({ formatVersion: 1, blocks: [] });
    expect(readCustomToolsFile(input)).toEqual(fileOf(minimalBlock));
  });

  it('retains the full published description, statics and JSON sanitizer shape', () => {
    const input: unknown = fileOf(structuredClone(fullBlock));
    const before = structuredClone(input);
    const parsed = readCustomToolsFile(input);
    const block = parsed.blocks[0];

    expect(parsed).toEqual(fileOf(fullBlock));
    if (block === undefined) {
      throw new Error('The parsed file lost its custom block');
    }
    expect(validateAgainst(block.description.data, { question: [], score: 1 })).toEqual([]);
    expect(validateAgainst(block.description.data, { question: [], score: -1 }))
      .toContainEqual(expect.objectContaining({ path: '/score' }));
    expect(input).toEqual(before);
  });

  const invalidRoots: Array<{ label: string; value: unknown; path: string }> = [
    { label: 'undefined', value: undefined, path: '/' },
    { label: 'null', value: null, path: '/' },
    { label: 'number', value: 1, path: '/' },
    { label: 'string', value: 'file', path: '/' },
    { label: 'array', value: [], path: '/' },
    { label: 'missing version', value: { blocks: [] }, path: '/' },
    { label: 'wrong version', value: { formatVersion: 2, blocks: [] }, path: '/formatVersion' },
    { label: 'string version', value: { formatVersion: '1', blocks: [] }, path: '/formatVersion' },
    { label: 'missing blocks', value: { formatVersion: 1 }, path: '/' },
    { label: 'non-array blocks', value: { formatVersion: 1, blocks: {} }, path: '/blocks' },
    { label: 'null block', value: { formatVersion: 1, blocks: [null] }, path: '/blocks/0' },
    { label: 'missing block fields', value: { formatVersion: 1, blocks: [{ name: 'note' }] }, path: '/blocks/0' },
    { label: 'empty block name', value: fileOf({ ...minimalBlock, name: '' }), path: '/blocks/0/name' },
  ];

  it.each(invalidRoots)('rejects a $label with its input path', ({ value, path }) => {
    expect(typeFailure(value).message).toContain(path);
  });

  const invalidDescriptions: Array<{ label: string; patch: Record<string, unknown>; path: string }> = [
    { label: 'summary', patch: { summary: 7 }, path: '/summary' },
    { label: 'data schema', patch: { data: [] }, path: '/data' },
    { label: 'guidance', patch: { guidance: 7 }, path: '/guidance' },
    { label: 'default data', patch: { defaultData: [] }, path: '/defaultData' },
    { label: 'examples list', patch: { examples: {} }, path: '/examples' },
    { label: 'example entry', patch: { examples: [7] }, path: '/examples/0' },
    { label: 'summary field', patch: { summaryFields: [7] }, path: '/summaryFields/0' },
    { label: 'input field', patch: { inputFields: [7] }, path: '/inputFields/0' },
    { label: 'view state field', patch: { viewState: [7] }, path: '/viewState/0' },
    { label: 'guarded fields map', patch: { guardedFields: [] }, path: '/guardedFields' },
    { label: 'guarded command', patch: { guardedFields: { score: 7 } }, path: '/guardedFields/score' },
    { label: 'actions list', patch: { actions: {} }, path: '/actions' },
    { label: 'action entry', patch: { actions: [null] }, path: '/actions/0' },
  ];

  it.each(invalidDescriptions)('rejects a malformed description $label before consumers see it', ({ patch, path }) => {
    const value: unknown = {
      formatVersion: 1,
      blocks: [{ ...minimalBlock, description: { ...minimalBlock.description, ...patch } }],
    };
    const before = structuredClone(value);

    expect(typeFailure(value).message).toContain(`/blocks/0/description${path}`);
    expect(value).toEqual(before);
  });

  const action = {
    name: 'grade',
    summary: 'Grade.',
    target: 'block',
    args: { type: 'object' },
  };
  const invalidActions: Array<{ label: string; patch: Record<string, unknown>; path: string }> = [
    { label: 'name type', patch: { name: 7 }, path: '/name' },
    { label: 'non-camelCase name', patch: { name: 'grade-now' }, path: '/name' },
    { label: 'summary', patch: { summary: false }, path: '/summary' },
    { label: 'target', patch: { target: 'document' }, path: '/target' },
    { label: 'args schema', patch: { args: [] }, path: '/args' },
    { label: 'result schema', patch: { result: [] }, path: '/result' },
    { label: 'guidance', patch: { guidance: 7 }, path: '/guidance' },
    { label: 'runtime', patch: { runtime: 'node' }, path: '/runtime' },
    { label: 'effects', patch: { effects: 'document' }, path: '/effects' },
    { label: 'precondition', patch: { preconditions: [7] }, path: '/preconditions/0' },
    { label: 'capability id', patch: { mirrors: [7] }, path: '/mirrors/0' },
    { label: 'required services list', patch: { requires: {} }, path: '/requires' },
    { label: 'unknown required service', patch: { requires: ['database'] }, path: '/requires/0' },
    { label: 'unknown optional service', patch: { uses: ['database'] }, path: '/uses/0' },
  ];

  it.each(invalidActions)('rejects a malformed action $label with the declaration path', ({ patch, path }) => {
    const value: unknown = {
      formatVersion: 1,
      blocks: [{ ...minimalBlock, description: { ...minimalBlock.description, actions: [{ ...action, ...patch }] } }],
    };

    expect(typeFailure(value).message).toContain(`/blocks/0/description/actions/0${path}`);
  });

  const invalidStatics: Array<{ label: string; patch: Record<string, unknown>; path: string }> = [
    { label: 'toolbox list', patch: { toolbox: {} }, path: '/toolbox' },
    { label: 'toolbox entry', patch: { toolbox: [null] }, path: '/toolbox/0' },
    { label: 'variant name', patch: { toolbox: [{ name: 7, title: 'Note' }] }, path: '/toolbox/0/name' },
    { label: 'variant title', patch: { toolbox: [{ name: 'note', title: 7 }] }, path: '/toolbox/0/title' },
    { label: 'variant data', patch: { toolbox: [{ name: 'note', title: 'Note', data: [] }] }, path: '/toolbox/0/data' },
    { label: 'variant caption', patch: { toolbox: [{ name: 'note', title: 'Note', previewCaption: 7 }] }, path: '/toolbox/0/previewCaption' },
    { label: 'rich fields list', patch: { richTextFields: {} }, path: '/richTextFields' },
    { label: 'rich field', patch: { richTextFields: [7] }, path: '/richTextFields/0' },
    { label: 'accepts children', patch: { acceptsChildren: 'no' }, path: '/acceptsChildren' },
    { label: 'owns children', patch: { ownsChildren: 'no' }, path: '/ownsChildren' },
    { label: 'layout flag', patch: { isLayout: 'no' }, path: '/isLayout' },
    { label: 'deletion flag', patch: { deletesChildren: 'no' }, path: '/deletesChildren' },
    { label: 'self-placement flag', patch: { selfPlacesChildren: 'no' }, path: '/selfPlacesChildren' },
    { label: 'table-cell flag', patch: { restrictedInTableCell: 'no' }, path: '/restrictedInTableCell' },
    { label: 'prepare flag', patch: { hasPrepareInsert: 'no' }, path: '/hasPrepareInsert' },
    { label: 'child restrictions', patch: { childTools: [] }, path: '/childTools' },
    { label: 'allowed children', patch: { childTools: { allow: [7] } }, path: '/childTools/allow/0' },
    { label: 'denied children', patch: { childTools: { deny: [7] } }, path: '/childTools/deny/0' },
    { label: 'conversion map', patch: { conversion: null }, path: '/conversion' },
    { label: 'conversion import', patch: { conversion: { import: 7 } }, path: '/conversion/import' },
    { label: 'conversion export', patch: { conversion: { export: 7 } }, path: '/conversion/export' },
    { label: 'convertible map', patch: { convertible: [] }, path: '/convertible' },
    { label: 'convertible import', patch: { convertible: { import: 'yes', export: false } }, path: '/convertible/import' },
    { label: 'convertible export', patch: { convertible: { import: false, export: 'yes' } }, path: '/convertible/export' },
    { label: 'asset kind', patch: { assetKind: 7 }, path: '/assetKind' },
  ];

  it.each(invalidStatics)('rejects a malformed statics $label before manifest construction', ({ patch, path }) => {
    const value: unknown = {
      formatVersion: 1,
      blocks: [{ ...minimalBlock, statics: { ...statics, ...patch } }],
    };

    expect(typeFailure(value).message).toContain(`/blocks/0/statics${path}`);
  });

  const invalidSanitize: Array<{ label: string; sanitize: unknown; path: string }> = [
    { label: 'null config', sanitize: null, path: '' },
    { label: 'array config', sanitize: [], path: '' },
    { label: 'number field rule', sanitize: { question: 7 }, path: '/question' },
    { label: 'null field rule', sanitize: { question: null }, path: '/question' },
    { label: 'array field rule', sanitize: { question: [] }, path: '/question' },
    { label: 'unsupported string rule', sanitize: { question: 'allow' }, path: '/question' },
    { label: 'plaintext field rule', sanitize: { question: 'plaintext' }, path: '/question' },
    { label: 'function field rule', sanitize: { question: () => true }, path: '/question' },
    { label: 'number tag rule', sanitize: { question: { a: 7 } }, path: '/question/a' },
    { label: 'null tag rule', sanitize: { question: { a: null } }, path: '/question/a' },
    { label: 'array tag rule', sanitize: { question: { a: [] } }, path: '/question/a' },
    { label: 'function tag rule', sanitize: { question: { a: () => true } }, path: '/question/a' },
    { label: 'number attribute', sanitize: { question: { a: { href: 7 } } }, path: '/question/a/href' },
    { label: 'null attribute', sanitize: { question: { a: { href: null } } }, path: '/question/a/href' },
    { label: 'array attribute', sanitize: { question: { a: { href: [] } } }, path: '/question/a/href' },
    { label: 'object attribute', sanitize: { question: { a: { href: {} } } }, path: '/question/a/href' },
    { label: 'function attribute', sanitize: { question: { a: { href: () => true } } }, path: '/question/a/href' },
  ];

  it.each(invalidSanitize)('rejects a malformed JSON sanitizer $label at its path', ({ sanitize, path }) => {
    const value: unknown = { formatVersion: 1, blocks: [{ ...minimalBlock, sanitize }] };

    expect(typeFailure(value).message).toContain(`/blocks/0/sanitize${path}`);
  });
});

describe('snapshotWithCustomTools', () => {
  it('returns the original snapshot when no file is supplied', () => {
    const base = buildBuiltInSnapshot({ blokVersion: 'base' });

    expect(snapshotWithCustomTools(base)).toBe(base);
  });

  it('appends described blocks with all built-in inline tools and no headless actions or tunes', () => {
    const base = buildBuiltInSnapshot({ blokVersion: 'base', readOnly: true, services: ['host'] });
    const before = structuredClone(base);
    const file = readCustomToolsFile(fileOf(structuredClone(fullBlock), structuredClone(minimalBlock)));
    const fileBefore = structuredClone(file);
    const snapshot = snapshotWithCustomTools(base, file);
    const manifest = buildToolManifest(snapshot);
    const quiz = manifest.blocks.find(block => block.name === 'quiz');
    const note = manifest.blocks.find(block => block.name === 'note');

    expect(quiz?.actions).toEqual([
      expect.objectContaining({ command: 'quiz.grade', target: 'block', available: false }),
      expect.objectContaining({ command: 'quiz.create', target: 'create', available: false }),
    ]);
    if (quiz === undefined || note === undefined) {
      throw new Error('The custom blocks are missing from the manifest');
    }
    expect(quiz.level).toBe('described');
    expect(quiz.title).toBe('Question');
    expect(quiz.insertable).toBe(true);
    expect(quiz.inlineTools).toEqual(base.inlineTools.map(tool => tool.name));
    expect(quiz.tunes).toEqual([]);
    expect(quiz.variants).toEqual([
      { name: 'quiz', title: 'Question', data: { score: 0 } },
      { name: 'quizAlternate', title: 'Alternate question', data: {} },
    ]);
    expect(quiz.children).toEqual({
      accepts: true, allow: ['paragraph'], deny: ['table'], ownedByTool: true, layout: true, deletedWithParent: true,
    });
    expect(quiz).toMatchObject({
      data: fullBlock.description.data,
      summaryFields: ['score'],
      inputFields: ['question', 'answer'],
      viewState: ['expanded'],
      guardedFields: { score: 'quiz.grade' },
      selfPlacesChildren: true,
      restrictedInTableCell: true,
      conversion: { import: 'question', export: 'question' },
      assetKind: 'file',
    });
    expect(note.title).toBe('note');
    expect(note.insertable).toBe(true);
    expect(note.inlineTools).toEqual(base.inlineTools.map(tool => tool.name));
    expect(note.tunes).toEqual([]);
    expect(note.actions).toEqual([]);
    expect(snapshot.blocks.map(block => block.name)).toEqual([...base.blocks.map(block => block.name), 'quiz', 'note']);
    expect(snapshot.blocks.slice(0, base.blocks.length)).toEqual(before.blocks);
    expect(snapshot.inlineTools).toEqual(before.inlineTools);
    expect(snapshot.tunes).toEqual(before.tunes);
    expect(snapshot).toMatchObject({ blokVersion: 'base', readOnly: true, defaultBlock: base.defaultBlock, services: ['host'] });
    expect(base).toEqual(before);
    expect(file).toEqual(fileBefore);
    expect(typeof globalThis.document).toBe('undefined');
    expect(typeof globalThis.window).toBe('undefined');
  });

  it('replaces a matching built-in name rather than exposing two entries', () => {
    const base = buildBuiltInSnapshot({ blokVersion: 'base' });
    const before = structuredClone(base);
    const file = readCustomToolsFile(fileOf({
      ...structuredClone(minimalBlock),
      name: 'paragraph',
      description: { summary: 'Host paragraph.', data: { type: 'object' } },
      statics: { ...structuredClone(statics), toolbox: [{ name: 'paragraph', title: 'Host paragraph' }] },
    }));
    const fileBefore = structuredClone(file);
    const snapshot = snapshotWithCustomTools(base, file);
    const manifest = buildToolManifest(snapshot);
    const entries = manifest.blocks.filter(block => block.name === 'paragraph');

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ title: 'Host paragraph', summary: 'Host paragraph.', level: 'described', actions: [] });
    expect(snapshot.blocks.filter(block => block.name !== 'paragraph'))
      .toEqual(before.blocks.filter(block => block.name !== 'paragraph'));
    expect(base).toEqual(before);
    expect(file).toEqual(fileBefore);
  });
});

describe('runtimesWithCustomTools', () => {
  it('returns the original runtime registry when no file is supplied', () => {
    expect(runtimesWithCustomTools(BUILT_IN_TOOL_RUNTIMES)).toBe(BUILT_IN_TOOL_RUNTIMES);
  });

  it('preserves formatting in each declared rich field when sanitize is absent', () => {
    const block: BlokCustomToolsFile['blocks'][number] = {
      ...structuredClone(minimalBlock),
      name: 'quiz',
      statics: { ...structuredClone(statics), richTextFields: ['question', 'answer'] },
    };
    const file = readCustomToolsFile(fileOf(block));
    const fileBefore = structuredClone(file);
    const baseEntries = [...BUILT_IN_TOOL_RUNTIMES];
    const baseSanitize = baseEntries.map(([name, runtime]) => [name, sanitizeState(runtime.sanitize)]);
    const runtimes = runtimesWithCustomTools(BUILT_IN_TOOL_RUNTIMES, file);
    const runtime = runtimeOf(runtimes, 'quiz');
    const html = '<strong>kept</strong><br><img src="https://example.test/p.png">';

    expect(cleanField(runtime, 'question', html)).toBe('<strong>kept</strong><br>');
    expect(cleanField(runtime, 'answer', html)).toBe('<strong>kept</strong><br>');
    expect(Object.keys(runtime.sanitize)).toEqual(['question', 'answer']);
    const question = runtime.sanitize.question;
    if (typeof question !== 'object' || question === null) {
      throw new Error('The default rich-field config is missing');
    }
    expect(question).toMatchObject({ br: true, b: {}, em: {}, span: INLINE_TEXT_SANITIZE.span });
    expect(runtime.actions).toEqual({});
    for (const [name, original] of baseEntries) {
      expect(runtimes.get(name), name).toBe(original);
      expect(BUILT_IN_TOOL_RUNTIMES.get(name), name).toBe(original);
    }
    expect([...BUILT_IN_TOOL_RUNTIMES].map(([name, original]) => [name, sanitizeState(original.sanitize)]))
      .toEqual(baseSanitize);
    expect(file).toEqual(fileBefore);
  });

  it('combines own tag overrides with built-in inline formatting and keeps boolean fields', () => {
    const file = readCustomToolsFile(fileOf({
      ...structuredClone(minimalBlock),
      name: 'quiz',
      statics: { ...structuredClone(statics), richTextFields: ['question'] },
      sanitize: { question: { p: true, em: false }, enabled: true, caption: false },
    }));
    const fileBefore = structuredClone(file);
    const runtime = runtimeOf(runtimesWithCustomTools(BUILT_IN_TOOL_RUNTIMES, file), 'quiz');

    expect(cleanField(runtime, 'question', '<em>plain</em><strong>bold</strong><p>own</p>'))
      .toBe('plain<strong>bold</strong><p>own</p>');
    expect(cleanField(runtime, 'caption', '<strong>plain</strong>')).toBe('plain');
    expect(cleanField(runtime, 'enabled', '<strong>kept</strong>')).toBe('<strong>kept</strong>');
    expect(runtime.sanitize.enabled).toBe(true);
    expect(runtime.sanitize.caption).toBe(false);
    expect(runtime.actions).toEqual({});
    expect(file).toEqual(fileBefore);
  });

  it('uses the real inline composition for an explicitly empty sanitizer', () => {
    const file = readCustomToolsFile(fileOf({ ...structuredClone(minimalBlock), sanitize: {} }));
    const runtime = runtimeOf(runtimesWithCustomTools(BUILT_IN_TOOL_RUNTIMES, file), 'note');
    const inline = Object.values(BUILT_IN_INLINE_SANITIZE).map(factory => factory());
    const composed = composeToolSanitize({}, inline);
    const html = '<strong>kept</strong><img src="https://example.test/p.png">';

    expect(sanitizeHtmlFragment(html, runtime.sanitize)).toBe('<strong>kept</strong>');
    expect(sanitizeHtmlFragment(html, composed)).toBe('<strong>kept</strong>');
    expect(runtime.actions).toEqual({});
  });

  it('replaces a built-in runtime without retaining its old headless action handlers', () => {
    const original = runtimeOf(BUILT_IN_TOOL_RUNTIMES, 'paragraph');
    const base = new Map(BUILT_IN_TOOL_RUNTIMES);
    const existing: ToolRuntime = {
      ...original,
      actions: { oldAction: { run: () => 'unused' } },
    };
    base.set('paragraph', existing);
    const before = sanitizeState(existing.sanitize);
    const file = readCustomToolsFile(fileOf({
      ...structuredClone(minimalBlock),
      name: 'paragraph',
      statics: { ...structuredClone(statics), richTextFields: ['question'] },
    }));
    const fileBefore = structuredClone(file);
    const runtimes = runtimesWithCustomTools(base, file);
    const replaced = runtimeOf(runtimes, 'paragraph');

    expect(replaced.actions).toEqual({});
    expect(cleanField(replaced, 'question', '<strong>kept</strong>')).toBe('<strong>kept</strong>');
    expect(replaced.name).toBe('paragraph');
    expect(runtimes.size).toBe(base.size);
    expect(base.get('paragraph')).toBe(existing);
    expect(existing.actions.oldAction?.run).toBeDefined();
    expect(sanitizeState(existing.sanitize)).toBe(before);
    expect(file).toEqual(fileBefore);
  });
});
