// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateAgainst } from '../../../src/shared/schema/validate';
import { buildToolManifest, canonicalHash, RESERVED_NAMESPACES, structuralDataSchema } from '../../../src/shared/tool-manifest';

import type { BlockToolDescription, BlockToolManifestEntry, ManifestOverrides, SnapshotBlock, ToolRegistrySnapshot } from '../../../types';

const statics = (over: Partial<SnapshotBlock['statics']> = {}): SnapshotBlock['statics'] => ({
  toolbox: [{ name: 'x', title: 'X' }],
  richTextFields: [],
  acceptsChildren: true,
  ownsChildren: false,
  isLayout: false,
  deletesChildren: false,
  selfPlacesChildren: false,
  restrictedInTableCell: false,
  conversion: {},
  convertible: { import: false, export: false },
  hasPrepareInsert: false,
  ...over,
});

const block = (name: string, over: Partial<SnapshotBlock> = {}): SnapshotBlock => ({
  name,
  title: name,
  description: null,
  statics: statics(),
  insertable: true,
  inlineTools: [],
  tunes: [],
  handlers: [],
  ...over,
});

const snapshot = (blocks: SnapshotBlock[], over: Partial<ToolRegistrySnapshot> = {}): ToolRegistrySnapshot => ({
  blokVersion: '1.17.0',
  readOnly: false,
  defaultBlock: 'paragraph',
  services: [],
  blocks,
  inlineTools: [],
  tunes: [],
  ...over,
});

const entryFor = (manifest: ReturnType<typeof buildToolManifest>, name: string): BlockToolManifestEntry => {
  const entry = manifest.blocks.find(candidate => candidate.name === name);

  if (entry === undefined) {
    throw new Error(`Missing manifest entry "${name}".`);
  }

  return entry;
};

const tableDescription: BlockToolDescription = {
  summary: 'A grid.',
  data: { type: 'object' },
  actions: [
    { name: 'insertRows', summary: 'Insert rows.', target: 'block', args: { type: 'object', properties: {} } },
    { name: 'linkCard', summary: 'Needs metadata.', target: 'create', args: { type: 'object' }, requires: ['linkMetadata'] },
    { name: 'local', summary: 'Editor only.', target: 'block', args: { type: 'object' }, runtime: 'editor' },
  ],
};

const cyclicData: Record<string, unknown> = { type: 'object' };

cyclicData.self = cyclicData;

class NonPlainDescription implements BlockToolDescription {
  summary = 'Not a plain description.';
  data = { type: 'object' };
}

const badDescriptions: Array<{ name: string; description: BlockToolDescription }> = [
  { name: 'non-plain root', description: new NonPlainDescription() },
  { name: 'array root', description: Object.assign([], { summary: 'Array.', data: { type: 'object' } }) },
  { name: 'cyclic schema', description: { summary: 'Cycle.', data: cyclicData } },
  { name: 'BigInt schema', description: { summary: 'BigInt.', data: { value: BigInt(1) } } },
  { name: 'function schema', description: { summary: 'Function.', data: { value: (): void => undefined } } },
  { name: 'undefined schema', description: { summary: 'Undefined.', data: { value: undefined } } },
  { name: 'non-finite schema', description: { summary: 'Infinity.', data: { value: Infinity } } },
  { name: 'symbol schema', description: { summary: 'Symbol.', data: { value: Symbol('x') } } },
  { name: 'Map schema', description: { summary: 'Map.', data: { value: new Map() } } },
  { name: 'Date schema', description: { summary: 'Date.', data: { value: new Date('2026-01-01') } } },
  { name: 'symbol-key schema', description: { summary: 'Key.', data: { [Symbol('x')]: 'lost' } } },
  { name: 'sparse schema array', description: { summary: 'Sparse.', data: { value: new Array<string>(1) } } },
  { name: 'malformed action name', description: { ...tableDescription, actions: [{ name: 'bad.action', summary: 'Bad.', target: 'block', args: {} }] } },
];

const nonEnumerableDescriptions: Array<{ name: string; registry: ToolRegistrySnapshot; toolName: string }> = [
  {
    name: 'block defaultData with BigInt',
    registry: snapshot([block('hiddenBlock', {
      description: Object.defineProperty(
        { summary: 'Hidden default data.', data: {}, defaultData: { value: BigInt(1) } },
        'defaultData',
        { enumerable: false }
      ),
    })]),
    toolName: 'hiddenBlock',
  },
  {
    name: 'block defaultData with JSON data',
    registry: snapshot([block('hiddenBlock', {
      description: Object.defineProperty(
        { summary: 'Hidden default data.', data: {}, defaultData: { value: 'omitted' } },
        'defaultData',
        { enumerable: false }
      ),
    })]),
    toolName: 'hiddenBlock',
  },
  {
    name: 'required block data',
    registry: snapshot([block('hiddenBlock', {
      description: Object.defineProperty({ summary: 'Hidden schema.', data: { type: 'object' } }, 'data', { enumerable: false }),
    })]),
    toolName: 'hiddenBlock',
  },
  {
    name: 'inline effect with BigInt',
    registry: snapshot([], {
      inlineTools: [{
        name: 'hiddenInline',
        title: 'Hidden',
        description: Object.defineProperty(
          { summary: 'Hidden effect.', effect: { mark: 'custom', value: { value: BigInt(1) } } },
          'effect',
          { enumerable: false }
        ),
        sanitizeTags: ['kbd'],
      }],
    }),
    toolName: 'hiddenInline',
  },
  {
    name: 'tune data with a cycle',
    registry: snapshot([], {
      tunes: [{
        name: 'hiddenTune',
        description: Object.defineProperty({ summary: 'Hidden tune data.', data: cyclicData }, 'data', { enumerable: false }),
      }],
    }),
    toolName: 'hiddenTune',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildToolManifest', () => {
  it('describes undeclared tools structurally with open, typed rich-text data', () => {
    const manifest = buildToolManifest(snapshot([block('quiz', { statics: statics({ richTextFields: ['question'] }) })]));
    const entry = entryFor(manifest, 'quiz');

    expect(entry.level).toBe('structural');
    expect(entry.summary).toBe('Custom block quiz');
    expect(entry.data).toMatchObject({ type: 'object', additionalProperties: true, properties: { question: { oneOf: [{ type: 'array' }, { type: 'string' }] } } });
    expect(validateAgainst(entry.data, { question: [{ text: 'Hello', marks: { bold: true } }], score: 3 })).toEqual([]);
    expect(validateAgainst(entry.data, { question: 123 }).length).toBeGreaterThan(0);
    expect(entry.actions).toEqual([]);
    expect(manifest).toMatchObject({ formatVersion: 1, blokVersion: '1.17.0', readOnly: false, defaultBlock: 'paragraph' });
  });

  it('uses description, then first preview caption, then custom summary', () => {
    const manifest = buildToolManifest(snapshot([
      block('described', { description: tableDescription, statics: statics({ toolbox: [{ name: 'x', title: 'X', previewCaption: 'Caption.' }] }) }),
      block('caption', { statics: statics({ toolbox: [{ name: 'x', title: 'X', previewCaption: 'First.' }, { name: 'y', title: 'Y', previewCaption: 'Second.' }] }) }),
      block('fallback', { statics: statics({ toolbox: [] }) }),
    ]));

    expect(manifest.blocks.map(entry => entry.summary)).toEqual(['A grid.', 'First.', 'Custom block fallback']);
  });

  it.each(badDescriptions)('degrades $name to structural and warns meaningfully', ({ description }) => {
    const onWarning = vi.fn<(message: string) => void>();
    const manifest = buildToolManifest(snapshot([block('broken', { description, handlers: ['insertRows'], statics: statics({ richTextFields: ['text'] }) })]), {}, { onWarning });
    const entry = entryFor(manifest, 'broken');

    expect(entry.level).toBe('structural');
    expect(entry.actions).toEqual([]);
    expect(entry.summary).toBe('Custom block broken');
    expect(entry.data).toMatchObject({ additionalProperties: true, properties: { text: { oneOf: [{ type: 'array' }, { type: 'string' }] } } });
    expect(onWarning).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/Tool "broken".*describe\(\).*JSON.*structural/));
  });

  it.each(badDescriptions)('warns independently for $name', ({ description }) => {
    const onWarning = vi.fn<(message: string) => void>();

    buildToolManifest(snapshot([block('broken', { description })]), {}, { onWarning });

    expect(onWarning).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/Tool "broken".*describe\(\).*JSON.*structural/));
  });

  it.each(nonEnumerableDescriptions)('degrades non-enumerable $name to structural without throwing', ({ registry, toolName }) => {
    expect(() => buildToolManifest(registry)).not.toThrow();

    const manifest = buildToolManifest(registry);
    const entries = [...manifest.blocks, ...manifest.inlineTools, ...manifest.tunes];

    expect(entries.map(entry => ({ name: entry.name, level: entry.level }))).toEqual([{ name: toolName, level: 'structural' }]);
    expect(manifest.blocks.every(entry => entry.defaultData === undefined)).toBe(true);
  });

  it.each(nonEnumerableDescriptions)('warns independently for non-enumerable $name', ({ registry, toolName }) => {
    const onWarning = vi.fn<(message: string) => void>();

    buildToolManifest(registry, {}, { onWarning });

    expect(onWarning).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(
      new RegExp(`Tool "${toolName}".*describe\\(\\).*JSON.*structural`)
    ));
  });

  it('keeps accepted descriptions stable after their source values change', () => {
    const blockData = { type: 'string' };
    const defaultData = { value: 'original' };
    const inlineValue = { const: true };
    const tuneData = { type: 'number' };
    const manifest = buildToolManifest(snapshot([block('stableBlock', {
      description: { summary: 'Stable block.', data: blockData, defaultData },
    })], {
      inlineTools: [{ name: 'stableInline', title: 'Stable', description: { summary: 'Stable inline.', effect: { mark: 'custom', value: inlineValue } }, sanitizeTags: [] }],
      tunes: [{ name: 'stableTune', description: { summary: 'Stable tune.', data: tuneData } }],
    }));

    blockData.type = 'number';
    defaultData.value = 'changed';
    inlineValue.const = false;
    tuneData.type = 'string';

    expect(entryFor(manifest, 'stableBlock').data).toEqual({ type: 'string' });
    expect(entryFor(manifest, 'stableBlock').defaultData).toEqual({ value: 'original' });
    expect(manifest.inlineTools.map(entry => entry.effect)).toEqual([{ mark: 'custom', value: { const: true } }]);
    expect(manifest.tunes.map(entry => entry.data)).toEqual([{ type: 'number' }]);
  });

  it('does not warn for an absent description or a valid description', () => {
    const onWarning = vi.fn<(message: string) => void>();

    buildToolManifest(snapshot([block('absent'), block('valid', { description: tableDescription })]), {}, { onWarning });

    expect(onWarning).not.toHaveBeenCalled();
  });

  it('prefixes actions with the registry key and preserves declarations', () => {
    const manifest = buildToolManifest(snapshot([block('grid', { description: tableDescription, handlers: ['insertRows', 'linkCard', 'local'] })]));
    const entry = entryFor(manifest, 'grid');

    expect(entry.actions.map(action => action.command)).toEqual(['grid.insertRows', 'grid.linkCard', 'grid.local']);
    expect(entry.actions.find(action => action.name === 'linkCard')).toMatchObject({ target: 'create', requires: ['linkMetadata'], available: true });
    expect(entry.selfPlacesChildren).toBe(false);
  });

  it('records handler support only, even without snapshot services or in read-only documents', () => {
    const base = block('t', { description: tableDescription, handlers: ['insertRows', 'linkCard', 'local'] });
    const noServices = buildToolManifest(snapshot([base]));
    const readOnly = buildToolManifest(snapshot([base], { readOnly: true }));

    expect(entryFor(noServices, 't').actions.map(action => action.available)).toEqual([true, true, true]);
    expect(entryFor(readOnly, 't').actions.map(action => action.available)).toEqual([true, true, true]);
    expect(readOnly.readOnly).toBe(true);
    expect(entryFor(buildToolManifest(snapshot([base], { services: ['linkMetadata'] })), 't').actions.map(action => action.available)).toEqual([true, true, true]);
    expect(entryFor(buildToolManifest(snapshot([{ ...base, handlers: ['linkCard'] }])), 't').actions.map(action => action.available)).toEqual([false, true, false]);
  });

  it.each(['doc', 'block', 'text', 'markdown', 'history'])('withholds actions under reserved namespace %s', name => {
    const entry = entryFor(buildToolManifest(snapshot([block(name, { description: tableDescription, handlers: ['insertRows'] })])), name);

    expect(entry.actions).toEqual([]);
    expect(entry.actionsWithheld).toBe('reserved-namespace');
    expect(entry.level).toBe('described');
  });

  it('applies hidden tools and actions, then appends override guidance', () => {
    const manifest = buildToolManifest(
      snapshot([block('t', { description: { ...tableDescription, guidance: 'Own.' }, handlers: ['insertRows'] }), block('h')], {
        inlineTools: [{ name: 'hiddenInline', title: 'Hidden', description: null, sanitizeTags: [] }],
        tunes: [{ name: 'hiddenTune', description: null }],
      }),
      { h: { hidden: true }, hiddenInline: { hidden: true }, hiddenTune: { hidden: true }, t: { hiddenActions: ['linkCard', 'local'], guidance: 'Host.' } }
    );

    expect(manifest.blocks.map(entry => entry.name)).toEqual(['t']);
    expect(entryFor(manifest, 't').actions.map(action => action.name)).toEqual(['insertRows']);
    expect(entryFor(manifest, 't').guidance).toBe('Own.\n\nHost.');
    expect(manifest.inlineTools).toEqual([]);
    expect(manifest.tunes).toEqual([]);
  });

  it('ignores inherited overrides and reads special registry keys by own entry', () => {
    const overrides: ManifestOverrides = {};

    Object.setPrototypeOf(overrides, { inherited: { hidden: true }, toString: { hidden: true } });
    Object.defineProperty(overrides, '__proto__', { value: { guidance: 'Own proto rule.' }, enumerable: true });

    const manifest = buildToolManifest(snapshot([block('inherited'), block('toString'), block('__proto__')]), overrides);

    expect(manifest.blocks.map(entry => entry.name)).toEqual(['inherited', 'toString', '__proto__']);
    expect(entryFor(manifest, '__proto__').guidance).toBe('Own proto rule.');
  });

  it('computes conversion destinations only from visible importing tools with variants', () => {
    const manifest = buildToolManifest(snapshot([
      block('p', { statics: statics({ conversion: { export: 'text', import: 'text' }, convertible: { import: true, export: true } }) }),
      block('h', { statics: statics({ convertible: { import: true, export: false } }) }),
      block('hidden', { statics: statics({ convertible: { import: true, export: true } }) }),
      block('noToolbox', { statics: statics({ toolbox: [], convertible: { import: true, export: true } }) }),
      block('noImport', { statics: statics({ convertible: { import: false, export: true } }) }),
    ]), { hidden: { hidden: true } });

    expect(entryFor(manifest, 'p').convertsTo).toEqual(['h']);
    expect(entryFor(manifest, 'h').convertsTo).toEqual([]);
    expect(entryFor(manifest, 'p').conversion).toEqual({ export: 'text', import: 'text' });
    expect(entryFor(manifest, 'h').conversion).toEqual({});
  });

  it('preserves schemas, examples, children and block metadata', () => {
    const description: BlockToolDescription = {
      ...tableDescription,
      defaultData: { text: '' },
      examples: [{ text: 'Example.' }],
      viewState: ['collapsed'],
      guardedFields: { rows: 'table.insertRows' },
      summaryFields: ['text'],
      inputFields: ['text'],
    };
    const entry = entryFor(buildToolManifest(snapshot([block('table', {
      description,
      inlineTools: ['bold'],
      tunes: ['alignment'],
      statics: statics({
        childTools: { allow: ['paragraph'], deny: ['table'] },
        acceptsChildren: false,
        ownsChildren: true,
        isLayout: true,
        deletesChildren: true,
        selfPlacesChildren: true,
        restrictedInTableCell: true,
        assetKind: 'image',
        richTextFields: ['text'],
      }),
    })])), 'table');

    expect(entry).toMatchObject({
      level: 'described', data: { type: 'object' }, defaultData: { text: '' }, examples: [{ text: 'Example.' }],
      viewState: ['collapsed'], guardedFields: { rows: 'table.insertRows' }, summaryFields: ['text'], inputFields: ['text'],
      children: { accepts: false, allow: ['paragraph'], deny: ['table'], ownedByTool: true, layout: true, deletedWithParent: true },
      selfPlacesChildren: true, restrictedInTableCell: true, assetKind: 'image', richTextFields: ['text'], inlineTools: ['bold'], tunes: ['alignment'],
    });
  });

  it('reads insertable, variants and prepareInsert requirements', () => {
    const manifest = buildToolManifest(snapshot([
      block('page', { insertable: false, description: { summary: 'Page.', data: {} }, statics: statics({ hasPrepareInsert: true, toolbox: [{ name: 'page', title: 'Page', data: { pageId: '' } }] }) }),
      block('custom', { statics: statics({ hasPrepareInsert: true }) }),
      block('plain'),
    ]));

    expect(entryFor(manifest, 'page').insertable).toBe(false);
    expect(entryFor(manifest, 'page').variants).toEqual([{ name: 'page', title: 'Page', data: { pageId: '' } }]);
    expect(entryFor(manifest, 'page').insertRequires).toEqual(['pageBackend']);
    expect(entryFor(manifest, 'custom').insertRequires).toEqual(['host']);
    expect(entryFor(manifest, 'custom').variants).toEqual([{ name: 'x', title: 'X', data: {} }]);
    expect(entryFor(manifest, 'plain').insertRequires).toBeUndefined();
    expect(entryFor(buildToolManifest(snapshot([block('page', { statics: statics({ hasPrepareInsert: true }) })])), 'page').insertRequires).toEqual(['host']);
  });

  it('changes revision with output, document state, services and overrides', () => {
    const one = buildToolManifest(snapshot([block('a')]));

    expect(buildToolManifest(snapshot([block('a')])).revision).toBe(one.revision);
    expect(buildToolManifest(snapshot([block('a', { insertable: false })])).revision).not.toBe(one.revision);
    expect(buildToolManifest(snapshot([block('a')], { readOnly: true })).revision).not.toBe(one.revision);
    expect(buildToolManifest(snapshot([block('a')], { services: ['uploader'] })).revision).not.toBe(one.revision);
    expect(buildToolManifest(snapshot([block('a')]), { a: { guidance: 'Host.' } }).revision).not.toBe(one.revision);
    expect(buildToolManifest(snapshot([block('a')]), { unused: { hidden: true } }).revision).not.toBe(one.revision);
  });

  it('degrades non-JSON inline and tune descriptions without losing their structural entries', () => {
    const onWarning = vi.fn<(message: string) => void>();
    const manifest = buildToolManifest(snapshot([], {
      inlineTools: [{ name: 'brokenInline', title: 'Broken', description: { summary: 'Bad.', effect: { mark: 'custom', value: { value: BigInt(1) } } }, sanitizeTags: ['kbd'] }],
      tunes: [{ name: 'brokenTune', description: { summary: 'Bad.', data: cyclicData } }],
    }), {}, { onWarning });

    expect(manifest.inlineTools).toEqual([{ name: 'brokenInline', title: 'Broken', summary: 'Custom inline tool brokenInline.', level: 'structural', effect: { mark: 'tag:kbd', value: { type: 'object', additionalProperties: { type: 'string' } } } }]);
    expect(manifest.tunes).toEqual([{ name: 'brokenTune', summary: 'Custom tune brokenTune', level: 'structural', data: { type: 'object', additionalProperties: true } }]);
    expect(onWarning).toHaveBeenCalledTimes(2);
    expect(onWarning).toHaveBeenCalledWith(expect.stringMatching(/Tool "brokenInline".*JSON.*structural/));
    expect(onWarning).toHaveBeenCalledWith(expect.stringMatching(/Tool "brokenTune".*JSON.*structural/));
  });

  it('describes inline tools and tunes or infers safe structural fallbacks', () => {
    const manifest = buildToolManifest(snapshot([], {
      inlineTools: [
        { name: 'kbd', title: 'Kbd', description: null, sanitizeTags: ['kbd'] },
        { name: 'multi', title: 'M', description: null, sanitizeTags: ['b', 'i'] },
        { name: 'zero', title: 'Z', description: null, sanitizeTags: [] },
        { name: 'bold', title: 'Bold', shortcut: 'CMD+B', description: { summary: 'Bold.', effect: { mark: 'bold', value: { const: true } } }, sanitizeTags: ['b'] },
      ],
      tunes: [{ name: 'indent', description: null }, { name: 'align', description: { summary: 'Align.', data: { enum: ['left', 'right'] } } }, { name: 'empty', description: { summary: 'No data.', data: null } }],
    }));

    expect(manifest.inlineTools).toEqual([
      { name: 'kbd', title: 'Kbd', summary: 'Custom inline tool kbd.', level: 'structural', effect: { mark: 'tag:kbd', value: { type: 'object', additionalProperties: { type: 'string' } } } },
      { name: 'multi', title: 'M', summary: 'Custom inline tool multi. Leave its marks as they are.', level: 'structural' },
      { name: 'zero', title: 'Z', summary: 'Custom inline tool zero. Leave its marks as they are.', level: 'structural' },
      { name: 'bold', title: 'Bold', shortcut: 'CMD+B', summary: 'Bold.', level: 'described', effect: { mark: 'bold', value: { const: true } } },
    ]);
    expect(manifest.tunes).toEqual([
      { name: 'indent', summary: 'Custom tune indent', level: 'structural', data: { type: 'object', additionalProperties: true } },
      { name: 'align', summary: 'Align.', level: 'described', data: { enum: ['left', 'right'] } },
      { name: 'empty', summary: 'No data.', level: 'described', data: null },
    ]);
  });
});

describe('structuralDataSchema', () => {
  it('accepts segments and inline HTML, rejects invalid rich fields, and leaves other data open', () => {
    const schema = structuralDataSchema(['text']);

    expect(validateAgainst(schema, { text: [{ text: 'A' }], arbitrary: { answer: 42 } })).toEqual([]);
    expect(validateAgainst(schema, { text: '<b>A</b>' })).toEqual([]);
    expect(validateAgainst(schema, { text: [{ markdown: '**A**' }] }).length).toBeGreaterThan(0);
    expect(validateAgainst(schema, { text: false }).length).toBeGreaterThan(0);
  });
});

describe('canonicalHash', () => {
  it('uses sorted-key JSON and FNV-1a 32-bit, pinned independently', () => {
    expect(canonicalHash({})).toBe('5465b825');
    expect(canonicalHash({ b: [2], a: 1 })).toBe('85e10599');
    expect(canonicalHash({ a: 1, b: [2] })).toBe('85e10599');
    expect(canonicalHash({ a: 1 })).toMatch(/^[0-9a-f]{8}$/);
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 2 }));
  });

  it('sorts nested object keys without changing array order', () => {
    expect(canonicalHash({ data: [{ z: 2, a: 1 }] })).toBe(canonicalHash({ data: [{ a: 1, z: 2 }] }));
    expect(canonicalHash([1, 2])).not.toBe(canonicalHash([2, 1]));
  });

  it('publishes the shared reserved namespace tuple', () => {
    expect(RESERVED_NAMESPACES).toEqual(['doc', 'block', 'text', 'markdown', 'history']);
  });
});
