// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateAgainst } from '../../../src/shared/schema/validate';
import { BLOCK_POSITION_SCHEMA, buildAgentContract, buildToolManifest } from '../../../src/shared/tool-manifest';
import type { ContractWhere, CoreCommandTable } from '../../../src/shared/tool-manifest';

import type { AgentContract, BlockToolDescription, BlokSchema, CommandEntry, SnapshotBlock, ToolRegistrySnapshot } from '../../../types';

const insertCommand = {
  argsSchema: { type: 'object', properties: { type: { type: 'string' } } },
  readOnly: false,
  runtime: 'any',
  summary: 'Insert.',
} satisfies CoreCommandTable[string];

const core: CoreCommandTable = {
  'history.redo': { argsSchema: { type: 'object' }, readOnly: false, runtime: 'any', summary: 'Redo.' },
  'doc.read': {
    argsSchema: { type: 'object' }, resultSchema: { type: 'array', items: { type: 'string' } },
    readOnly: true, runtime: 'any', summary: 'Read.', guidance: 'Read before editing.',
  },
  'block.insert': insertCommand,
  'history.undo': { argsSchema: { type: 'object' }, readOnly: false, runtime: 'any', summary: 'Undo.' },
  'doc.find': { argsSchema: { type: 'object' }, readOnly: true, runtime: 'editor', summary: 'Find locally.' },
};

const description: BlockToolDescription = {
  summary: 'A grid.',
  guidance: 'Use actions.',
  data: { type: 'object' },
  actions: [
    {
      name: 'insertRows', summary: 'Rows.', target: 'block',
      args: { type: 'object', additionalProperties: false, required: ['at'], properties: { at: { type: 'integer', minimum: 0 } } },
      result: { type: 'array', items: { type: 'string' } },
      guidance: 'Keep the grid rectangular.', preconditions: ['Keeps one row.', 'Index must exist.'],
    },
    { name: 'create', summary: 'New.', target: 'create', args: { type: 'object', additionalProperties: false, properties: { rows: { type: 'integer' } } } },
    {
      name: 'card', summary: 'Card.', target: 'create', args: { type: 'object' },
      requires: ['linkMetadata', 'host'], uses: ['uploader'], effects: 'host',
    },
    { name: 'local', summary: 'Local.', target: 'block', args: { type: 'object' }, runtime: 'editor' },
    { name: 'unsupported', summary: 'No handler.', target: 'block', args: { type: 'object' } },
  ],
};

const block = (over: Partial<SnapshotBlock> = {}): SnapshotBlock => ({
  name: 'table', title: 'Table', description,
  statics: {
    toolbox: [], richTextFields: [], acceptsChildren: true, ownsChildren: false,
    isLayout: false, deletesChildren: false, selfPlacesChildren: true,
    restrictedInTableCell: true, conversion: {}, convertible: { import: false, export: false },
    hasPrepareInsert: false,
  },
  insertable: true, inlineTools: [], tunes: [], handlers: ['insertRows', 'create', 'card', 'local'],
  ...over,
});

const snapshot = (over: Partial<ToolRegistrySnapshot> = {}): ToolRegistrySnapshot => ({
  blokVersion: '1', readOnly: false, defaultBlock: 'paragraph', services: [],
  blocks: [block()], inlineTools: [], tunes: [],
  ...over,
});

const where: ContractWhere = { runtime: 'editor', services: ['linkMetadata', 'host'] };

const commandFor = (contract: AgentContract, name: string): CommandEntry => {
  const command = contract.commands.find(entry => entry.name === name);

  if (command === undefined) {
    throw new Error(`Missing command "${name}".`);
  }

  return command;
};

const actionFor = (contract: AgentContract, name: string): AgentContract['manifest']['blocks'][number]['actions'][number] => {
  const action = contract.manifest.blocks.find(entry => entry.name === 'table')?.actions.find(entry => entry.name === name);

  if (action === undefined) {
    throw new Error(`Missing action "${name}".`);
  }

  return action;
};

const customContract = (args: BlokSchema, target: 'block' | 'create'): AgentContract => buildAgentContract(
  buildToolManifest(snapshot({
    blocks: [block({
      description: { summary: 'Custom.', data: {}, actions: [{ name: 'custom', summary: 'Act.', args, target }] },
      handlers: ['custom'],
    })],
  })),
  {},
  where
);

const runtimeCases: Array<{ runtime: ContractWhere['runtime']; editorAvailable: boolean; historyAvailable: boolean }> = [
  { runtime: 'editor', editorAvailable: true, historyAvailable: true },
  { runtime: 'node', editorAvailable: false, historyAvailable: true },
  { runtime: 'jint', editorAvailable: false, historyAvailable: false },
  { runtime: 'node-live', editorAvailable: false, historyAvailable: false },
  { runtime: 'csharp-live', editorAvailable: false, historyAvailable: false },
];

const coreChanges: Array<{ label: string; change: Partial<CoreCommandTable[string]> }> = [
  { label: 'args schema', change: { argsSchema: { type: 'object', required: ['type'], properties: { type: { type: 'string' } } } } },
  { label: 'result schema', change: { resultSchema: { type: 'string' } } },
  { label: 'summary', change: { summary: 'Insert a block.' } },
  { label: 'guidance', change: { guidance: 'Choose the tool first.' } },
  { label: 'read-only metadata', change: { readOnly: true } },
  { label: 'runtime', change: { runtime: 'editor' } },
];

describe('buildAgentContract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports the contract builder and block position schema', () => {
    expect(typeof buildAgentContract).toBe('function');
    expect(BLOCK_POSITION_SCHEMA).toBeDefined();
  });

  it('rejects an undotted core command name without adding namespace policy', () => {
    const manifest = buildToolManifest(snapshot());

    expect(() => buildAgentContract(manifest, { undotted: insertCommand }, where))
      .toThrow('Core command names must contain a dot: undotted.');
  });

  it('merges all visible core and tool commands, sorted by name', () => {
    const contract = buildAgentContract(buildToolManifest(snapshot()), core, where);

    expect(contract.commands.map(command => command.name)).toEqual([
      'block.insert', 'doc.find', 'doc.read', 'history.redo', 'history.undo',
      'table.card', 'table.create', 'table.insertRows', 'table.local', 'table.unsupported',
    ]);
    expect(contract.formatVersion).toBe(1);
  });

  it('preserves core metadata and schemas', () => {
    const contract = buildAgentContract(buildToolManifest(snapshot()), core, where);

    expect(commandFor(contract, 'doc.read')).toEqual({
      name: 'doc.read', summary: 'Read.', guidance: 'Read before editing.',
      args: { type: 'object' }, result: { type: 'array', items: { type: 'string' } },
      readOnly: true, runtime: 'any', source: 'core', available: true,
    });
  });

  it('preserves tool metadata while supplying command source and defaults', () => {
    const contract = buildAgentContract(buildToolManifest(snapshot()), core, where);

    expect(commandFor(contract, 'table.insertRows')).toMatchObject({
      name: 'table.insertRows', summary: 'Rows.', guidance: 'Keep the grid rectangular.',
      result: { type: 'array', items: { type: 'string' } },
      readOnly: false, runtime: 'any', source: { tool: 'table', target: 'block' }, available: true,
    });
    expect(commandFor(contract, 'table.card')).toMatchObject({
      source: { tool: 'table', target: 'create' }, requires: ['linkMetadata', 'host'], effects: 'host',
    });
  });

  it('requires a string id on block actions and preserves their own schema constraints', () => {
    const args = commandFor(buildAgentContract(buildToolManifest(snapshot()), core, where), 'table.insertRows').args;

    expect(validateAgainst(args, { at: 0 }).length).toBeGreaterThan(0);
    expect(validateAgainst(args, { id: 7, at: 0 }).length).toBeGreaterThan(0);
    expect(validateAgainst(args, { id: 'b', at: 0 })).toEqual([]);
    expect(validateAgainst(args, { id: 'b', at: -1 }).length).toBeGreaterThan(0);
    expect(validateAgainst(args, { id: 'b', at: 0, extra: true }).length).toBeGreaterThan(0);
    expect(args.required).toEqual(['id', 'at']);
  });

  it('adds optional root-aware parent and sibling selectors to create actions', () => {
    const args = commandFor(buildAgentContract(buildToolManifest(snapshot()), core, where), 'table.create').args;

    expect(validateAgainst(args, { rows: 2 })).toEqual([]);
    expect(validateAgainst(args, { rows: 2, parentId: null, position: 'end' })).toEqual([]);
    expect(validateAgainst(args, { rows: 2, parentId: 'p', position: { before: 'b' } })).toEqual([]);
    expect(validateAgainst(args, { parentId: 3 }).length).toBeGreaterThan(0);
    expect(validateAgainst(args, { position: 'middle' }).length).toBeGreaterThan(0);
    expect(validateAgainst(args, { rows: 'two' }).length).toBeGreaterThan(0);
    expect(args).toMatchObject({ properties: { position: BLOCK_POSITION_SCHEMA } });
  });

  it('keeps the injected id string schema and deduplicates required id', () => {
    const args = commandFor(customContract({
      type: 'object', required: ['id', 'at'],
      properties: { id: { type: 'number' }, at: { type: 'integer' } },
    }, 'block'), 'table.custom').args;

    expect(validateAgainst(args, { id: 'b', at: 0 })).toEqual([]);
    expect(validateAgainst(args, { id: 1, at: 0 }).length).toBeGreaterThan(0);
    expect(args.required).toEqual(['id', 'at']);
  });

  it('keeps injected create selectors when custom properties reuse their keys', () => {
    const args = commandFor(customContract({
      type: 'object', properties: { parentId: { type: 'number' }, position: { type: 'integer' }, rows: { type: 'integer' } },
    }, 'create'), 'table.custom').args;

    expect(validateAgainst(args, { parentId: null, position: { after: 'b' }, rows: 2 })).toEqual([]);
    expect(validateAgainst(args, { parentId: 'p', position: 'start' })).toEqual([]);
    expect(validateAgainst(args, { parentId: 1 }).length).toBeGreaterThan(0);
    expect(validateAgainst(args, { position: 1 }).length).toBeGreaterThan(0);
    expect(args).toMatchObject({ properties: { position: BLOCK_POSITION_SCHEMA } });
  });

  it('validates the exact BlockChildPosition union', () => {
    for (const valid of ['start', 'end', { before: 'b' }, { after: 'b' }]) {
      expect(validateAgainst(BLOCK_POSITION_SCHEMA, valid)).toEqual([]);
    }

    for (const invalid of ['middle', {}, { before: 1 }, { after: 1 }, { before: 'a', after: 'b' }, { before: 'a', extra: true }]) {
      expect(validateAgainst(BLOCK_POSITION_SCHEMA, invalid).length).toBeGreaterThan(0);
    }
  });

  it.each(runtimeCases)('applies editor and history availability in $runtime', ({ runtime, editorAvailable, historyAvailable }) => {
    const contract = buildAgentContract(buildToolManifest(snapshot()), core, { ...where, runtime });

    for (const name of ['doc.find', 'table.local']) {
      expect(commandFor(contract, name).available).toBe(editorAvailable);
      expect(commandFor(contract, name).unavailableReason).toBe(editorAvailable ? undefined : 'runtime');
    }

    for (const name of ['history.undo', 'history.redo']) {
      expect(commandFor(contract, name).available).toBe(historyAvailable);
      expect(commandFor(contract, name).unavailableReason).toBe(historyAvailable ? undefined : 'runtime');
    }

    expect(commandFor(contract, 'table.insertRows').available).toBe(true);
    expect(commandFor(contract, 'doc.read').available).toBe(true);
  });

  it('uses runner services instead of the snapshot service list', () => {
    const withoutSnapshotServices = buildToolManifest(snapshot({ services: [] }));
    const withSnapshotServices = buildToolManifest(snapshot({ services: ['linkMetadata', 'host'] }));

    expect(commandFor(buildAgentContract(withoutSnapshotServices, core, where), 'table.card').available).toBe(true);
    expect(commandFor(buildAgentContract(withSnapshotServices, core, { runtime: 'editor', services: [] }), 'table.card'))
      .toMatchObject({ available: false, unavailableReason: 'service' });
    expect(commandFor(buildAgentContract(withSnapshotServices, core, { runtime: 'editor', services: ['linkMetadata'] }), 'table.card'))
      .toMatchObject({ available: false, unavailableReason: 'service' });
  });

  it('does not require optional uses services', () => {
    const contract = buildAgentContract(buildToolManifest(snapshot()), core, where);

    expect(commandFor(contract, 'table.card').available).toBe(true);
    expect(where.services).not.toContain('uploader');
  });

  it('marks actions with no handler runtime-unavailable', () => {
    const contract = buildAgentContract(buildToolManifest(snapshot()), core, where);

    expect(commandFor(contract, 'table.unsupported')).toMatchObject({ available: false, unavailableReason: 'runtime' });
    expect(actionFor(contract, 'unsupported').available).toBe(false);
  });

  it('blocks writing commands in read-only mode without inventing an unavailable reason', () => {
    const contract = buildAgentContract(buildToolManifest(snapshot({ readOnly: true })), core, { runtime: 'jint', services: [] });

    for (const command of contract.commands.filter(entry => !entry.readOnly)) {
      expect(command.available).toBe(false);
      expect(command.unavailableReason).toBeUndefined();
      expect(command.readOnly).toBe(false);
    }

    expect(contract.commands).toHaveLength(10);
    expect(commandFor(contract, 'doc.read').available).toBe(true);
    expect(commandFor(contract, 'doc.find')).toMatchObject({ readOnly: true, available: false, unavailableReason: 'runtime' });
    expect(contract.manifest.blocks.flatMap(entry => entry.actions).every(action => !action.available)).toBe(true);
  });

  it('copies effective action availability without changing the input or supplied schemas', () => {
    const manifest = buildToolManifest(snapshot());
    const input = JSON.stringify({ manifest, core, where, description });

    Object.freeze(manifest);
    for (const entry of manifest.blocks) {
      Object.freeze(entry);
      Object.freeze(entry.actions);
      for (const action of entry.actions) {
        Object.freeze(action);
        Object.freeze(action.args);
      }
    }

    Object.freeze(insertCommand.argsSchema);
    const contract = buildAgentContract(manifest, core, { runtime: 'jint', services: [] });

    expect(actionFor(contract, 'card').available).toBe(false);
    expect(actionFor(contract, 'local').available).toBe(false);
    expect(actionFor(contract, 'insertRows').available).toBe(true);
    expect(contract.manifest).not.toBe(manifest);

    for (const entry of contract.manifest.blocks) {
      const original = manifest.blocks.find(candidate => candidate.name === entry.name);

      if (original === undefined) {
        throw new Error('Missing input entry.');
      }

      expect(entry).not.toBe(original);
      expect(entry.actions).not.toBe(original.actions);
      for (const action of entry.actions) {
        expect(action.available).toBe(commandFor(contract, action.command).available);
        expect(action).not.toBe(original.actions.find(candidate => candidate.name === action.name));
      }
    }

    expect(JSON.stringify({ manifest, core, where, description })).toBe(input);
  });

  it('includes core guidance, tool overrides, action guidance and preconditions', () => {
    const manifest = buildToolManifest(snapshot(), { table: { guidance: 'Host rule.' } });
    const contract = buildAgentContract(manifest, core, where, 'Rich fields take segments, never Markdown.');

    expect(contract.guidance.commands['doc.read']).toBe('Read before editing.');
    expect(contract.guidance.commands['table.insertRows']).toBe('Keep the grid rectangular.\n- Keeps one row.\n- Index must exist.');
    expect(contract.guidance.tools.table).toBe('Use actions.\n\nHost rule.');
    expect(contract.guidance.general).toBe('Rich fields take segments, never Markdown.');
    expect(contract.guidance.commands['table.create']).toBeUndefined();
  });

  it('formats preconditions without empty guidance or extra blank lines', () => {
    const manifest = buildToolManifest(snapshot({
      blocks: [block({ description: { summary: 'Custom.', data: {}, actions: [{
        name: 'custom', summary: 'Act.', target: 'block', args: {},
        guidance: '', preconditions: ['Keep one.'],
      }] }, handlers: ['custom'] })],
    }));
    const contract = buildAgentContract(manifest, {}, where);

    expect(contract.guidance.commands['table.custom']).toBe('- Keep one.');
    expect(contract.guidance.general).toBe('');
  });

  it('does not restore hidden actions or actions withheld in reserved namespaces', () => {
    const manifest = buildToolManifest(snapshot({ blocks: [block(), block({ name: 'block' })] }), { table: { hiddenActions: ['create'] } });
    const contract = buildAgentContract(manifest, core, where);

    expect(contract.commands.some(command => command.name === 'table.create')).toBe(false);
    expect(contract.commands.filter(command => command.name === 'block.insert')).toHaveLength(1);
    expect(contract.commands.some(command => command.name === 'block.insertRows')).toBe(false);
  });

  it.each(coreChanges)('changes revision when a core $label changes without renaming it', ({ change }) => {
    const manifest = buildToolManifest(snapshot());
    const before = buildAgentContract(manifest, core, where);
    const after = buildAgentContract(manifest, { ...core, 'block.insert': { ...insertCommand, ...change } }, where);

    expect(after.revision).not.toBe(before.revision);
  });

  it('changes revision with general guidance', () => {
    const manifest = buildToolManifest(snapshot());

    expect(buildAgentContract(manifest, core, where, 'Use segments.').revision)
      .not.toBe(buildAgentContract(manifest, core, where).revision);
  });

  it('changes revision with runner runtime, services and manifest read-only state', () => {
    const manifest = buildToolManifest(snapshot());
    const revision = buildAgentContract(manifest, core, where).revision;

    expect(buildAgentContract(manifest, core, { ...where, runtime: 'jint' }).revision).not.toBe(revision);
    expect(buildAgentContract(manifest, core, { ...where, services: [] }).revision).not.toBe(revision);
    expect(buildAgentContract(buildToolManifest(snapshot({ readOnly: true })), core, where).revision).not.toBe(revision);
  });

  it('keeps revision stable across canonical object key order', () => {
    const manifest = buildToolManifest(snapshot());
    const reordered: CoreCommandTable = Object.fromEntries(Object.entries(core).reverse());
    const first = buildAgentContract(manifest, core, where, 'Use segments.');
    const second = buildAgentContract(manifest, {
      ...reordered,
      'block.insert': {
        summary: 'Insert.', runtime: 'any', readOnly: false,
        argsSchema: { properties: { type: { type: 'string' } }, type: 'object' },
      },
    }, { services: ['linkMetadata', 'host'], runtime: 'editor' }, 'Use segments.');

    expect(second.revision).toBe(first.revision);
  });
});
