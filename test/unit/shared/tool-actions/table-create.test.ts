import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../src/components/core';
import { runtimesFromTools, snapshotFromTools } from '../../../../src/components/tools/registry-snapshot';
import { destroy as destroyTooltip } from '../../../../src/components/utils/tooltip';
import { COMMANDS } from '../../../../src/shared/agent/commands';
import { checkEnvelope } from '../../../../src/shared/agent/envelope';
import { AgentFailure } from '../../../../src/shared/agent/errors';
import { buildBuiltInSnapshot } from '../../../../src/shared/built-in-snapshot';
import { validateAgainst } from '../../../../src/shared/schema/validate';
import { BUILT_IN_TOOL_RUNTIMES } from '../../../../src/shared/tool-actions';
import { TABLE_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/table';
import { describeTable, RANGE_ARGS, TABLE_ACTIONS, TABLE_DATA } from '../../../../src/shared/tool-descriptions/table';
import { buildAgentContract, buildToolManifest } from '../../../../src/shared/tool-manifest';
import { builtInEditorTools } from '../tool-descriptions/built-in-tools';
import { createFakeCtx, docOf } from './fake-ctx';

import type { ContractWhere } from '../../../../src/shared/tool-manifest';
import type { RichText } from '../../../../types/rich-text';
import type { AgentContract, CommandEntry } from '../../../../types/tool-manifest';
import type { ToolActionContext, ToolActionDeclaration, ToolActionImpl } from '../../../../types/tools/tool-description';

interface Cell {
  blocks: string[];
  id: string;
  rowId: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isArray = (value: unknown): value is unknown[] => Array.isArray(value);
const isStringArray = (value: unknown): value is string[] =>
  isArray(value) && value.every(item => typeof item === 'string');
const isCell = (value: unknown): value is Cell =>
  isRecord(value) && isStringArray(value.blocks) &&
  typeof value.id === 'string' && value.id.length > 0 &&
  typeof value.rowId === 'string' && value.rowId.length > 0;
const isRow = (value: unknown): value is Cell[] => isArray(value) && value.every(isCell);

const at = <T>(values: readonly T[], index: number): T => {
  const value = values[index];

  if (value === undefined) {
    throw new Error('Expected a value at this index.');
  }

  return value;
};

const created = (value: unknown): { id: string; childIds: string[] } => {
  if (!isRecord(value) || typeof value.id !== 'string' || !isStringArray(value.childIds)) {
    throw new Error('Expected a table id and its cell block ids.');
  }

  return { id: value.id, childIds: value.childIds };
};

const readOf = (ctx: ToolActionContext, id: string): NonNullable<ReturnType<ToolActionContext['read']>> => {
  const block = ctx.read(id);

  if (block === null) {
    throw new Error('Expected the block to exist.');
  }

  return block;
};

const dataOf = (ctx: ToolActionContext, id: string): Record<string, unknown> => {
  const data = readOf(ctx, id).data;

  if (!isRecord(data)) {
    throw new Error('Expected block data.');
  }

  return data;
};

const gridOf = (ctx: ToolActionContext, id: string): Cell[][] => {
  const content = dataOf(ctx, id).content;

  if (!isArray(content) || !content.every(isRow)) {
    throw new Error('Expected cells with row and column ids.');
  }

  return content;
};

const handlerOf = (name: string): ToolActionImpl => {
  const handler = TABLE_ACTION_HANDLERS[name];

  if (handler === undefined) {
    throw new Error(`Missing table handler "${name}".`);
  }

  return handler;
};

const actionOf = (name: string): ToolActionDeclaration => {
  const action = TABLE_ACTIONS.find(candidate => candidate.name === name);

  if (action === undefined) {
    throw new Error(`Missing table declaration "${name}".`);
  }

  return action;
};

const commandOf = (contract: AgentContract, name: string): CommandEntry => {
  const command = contract.commands.find(candidate => candidate.name === name);

  if (command === undefined) {
    throw new Error(`Missing command "${name}".`);
  }

  return command;
};

const runtimes: ContractWhere['runtime'][] = ['editor', 'node', 'jint'];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('table.create', () => {
  it('creates one paragraph per cell in row reading order and fills omitted text', () => {
    const ctx = createFakeCtx(docOf([]), undefined, 'table');
    const cells: RichText[][] = [
      [[{ text: 'A', marks: { bold: true } }], [{ text: 'B\nC' }]],
      [],
    ];
    const result = created(handlerOf('create').run(ctx, { rows: 2, cols: 3, cells }, undefined));
    const content = gridOf(ctx, result.id);

    expect(result.childIds.map(id => dataOf(ctx, id))).toEqual([
      { text: at(at(cells, 0), 0) }, { text: at(at(cells, 0), 1) },
      { text: [] }, { text: [] }, { text: [] }, { text: [] },
    ]);
    expect(content).toHaveLength(2);
    expect(content.map(row => row.length)).toEqual([3, 3]);
    expect(content.flat().map(cell => cell.blocks)).toEqual(result.childIds.map(id => [id]));
    expect(readOf(ctx, result.id).children).toEqual(result.childIds);
    expect(ctx.doc.size).toBe(7);
    expect(new Set(result.childIds).size).toBe(6);
    expect(dataOf(ctx, result.id)).toMatchObject({ withHeadings: false, withHeadingColumn: false });
    expect(dataOf(ctx, result.id)).not.toHaveProperty('colWidths');
    expect(validateAgainst(TABLE_DATA, dataOf(ctx, result.id))).toEqual([]);

    for (const id of result.childIds) {
      expect(readOf(ctx, id)).toMatchObject({ type: 'paragraph', parentId: result.id, children: [] });
    }
  });

  it.each([
    { withHeadings: true, withHeadingColumn: false },
    { withHeadings: false, withHeadingColumn: true },
  ])('sets heading flags independently %j', flags => {
    const ctx = createFakeCtx(docOf([]), undefined, 'table');
    const result = created(handlerOf('create').run(ctx, { rows: 1, cols: 1, ...flags }, undefined));

    expect(dataOf(ctx, result.id)).toMatchObject(flags);
  });

  it('gives each row and column its own identity shared across that axis', () => {
    const ctx = createFakeCtx(docOf([]), undefined, 'table');
    const result = created(handlerOf('create').run(ctx, { rows: 2, cols: 3 }, undefined));
    const content = gridOf(ctx, result.id);
    const first = at(content, 0);
    const second = at(content, 1);
    const columnIds = first.map(cell => cell.id);
    const rowIds = content.map(row => at(row, 0).rowId);

    expect(second.map(cell => cell.id)).toEqual(columnIds);
    expect(new Set(columnIds).size).toBe(3);
    expect(new Set(rowIds).size).toBe(2);
    for (const [index, row] of content.entries()) {
      expect(row.map(cell => cell.rowId)).toEqual(Array.from({ length: 3 }, () => at(rowIds, index)));
    }
    expect(new Set([result.id, ...result.childIds, ...columnIds, ...rowIds]).size).toBe(12);
  });

  it('uses the host registry key and preserves the requested parent and position', () => {
    const ctx = createFakeCtx(docOf([
      { id: 'parent', type: 'callout', data: {} },
      { id: 'sibling', type: 'paragraph', data: { text: [] }, parentId: 'parent' },
    ]), undefined, 'grid');
    const result = created(handlerOf('create').run(ctx, {
      rows: 1, cols: 1, withHeadings: true, withHeadingColumn: true,
      parentId: 'parent', position: { before: 'sibling' },
    }, undefined));

    expect(readOf(ctx, result.id).type).toBe('grid');
    expect(readOf(ctx, result.id).parentId).toBe('parent');
    expect(readOf(ctx, 'parent').children).toEqual([result.id, 'sibling']);
    expect(dataOf(ctx, result.id)).toMatchObject({ withHeadings: true, withHeadingColumn: true });
    expect(dataOf(ctx, at(result.childIds, 0))).toEqual({ text: [] });
  });
});

describe('table.create declaration and controls', () => {
  it('exposes create first through the real table description and shared runtime', () => {
    expect(TABLE_ACTIONS[0]?.name).toBe('create');
    expect(describeTable().actions).toBe(TABLE_ACTIONS);
    expect(actionOf('create').target).toBe('create');
    expect(BUILT_IN_TOOL_RUNTIMES.get('table')?.actions).toBe(TABLE_ACTION_HANDLERS);
    expect(Object.keys(TABLE_ACTION_HANDLERS)).toContain('create');
  });

  it.each([
    { rows: 1, cols: 1 },
    { rows: 2, cols: 3, withHeadings: true, withHeadingColumn: false, cells: [[[]]] },
    { rows: 1, cols: 1, cells: [[[{ text: 'Marked', marks: { bold: true } }]]] },
    { rows: 1, cols: 1, cells: [['<b>HTML input</b>']] },
  ])('accepts declared create arguments %j', args => {
    expect(validateAgainst(actionOf('create').args, args)).toEqual([]);
  });

  it.each([
    {}, { rows: 1 }, { cols: 1 }, { rows: 0, cols: 2 }, { rows: 2, cols: 0 },
    { rows: -1, cols: 1 }, { rows: 1, cols: -1 }, { rows: 1.5, cols: 1 },
    { rows: 1, cols: 1.5 }, { rows: '1', cols: 1 },
    { rows: 1, cols: 1, withHeadings: 'yes' },
    { rows: 1, cols: 1, withHeadingColumn: 1 },
    { rows: 1, cols: 1, cells: 'text' },
    { rows: 1, cols: 1, cells: [1] },
    { rows: 1, cols: 1, cells: [[1]] },
    { rows: 1, cols: 1, cells: [[[{ text: 1 }]]] },
    { rows: 1, cols: 1, cells: [[[{ text: 'A', marks: { bold: false } }]]] },
    { rows: 1, cols: 1, unknown: true },
  ])('rejects invalid declared create arguments %j', args => {
    expect(validateAgainst(actionOf('create').args, args).length).toBeGreaterThan(0);
  });

  it('declares a result requiring the table and paragraph ids', () => {
    const schema = actionOf('create').result;

    if (schema === undefined) {
      throw new Error('Expected the create result schema.');
    }

    expect(validateAgainst(schema, { id: 'table' }).length).toBeGreaterThan(0);
    expect(validateAgainst(schema, { childIds: ['cell'] }).length).toBeGreaterThan(0);
    expect(validateAgainst(schema, { id: 'table', childIds: ['cell'] })).toEqual([]);
    expect(validateAgainst(schema, { id: 'table', childIds: [1] }).length).toBeGreaterThan(0);
  });

  it('declares inclusive zero-based ranges without requiring increasing corners', () => {
    expect(validateAgainst(RANGE_ARGS, { fromRow: 2, fromCol: 3, toRow: 0, toCol: 0 })).toEqual([]);
    expect(validateAgainst(RANGE_ARGS, { fromRow: 0, fromCol: 0, toRow: 0, toCol: 0 })).toEqual([]);
    expect(validateAgainst(RANGE_ARGS, { fromRow: -1, fromCol: 0, toRow: 0, toCol: 0 }).length).toBeGreaterThan(0);
    expect(validateAgainst(RANGE_ARGS, { fromRow: 0, fromCol: 0.5, toRow: 0, toCol: 0 }).length).toBeGreaterThan(0);
    expect(validateAgainst(RANGE_ARGS, { fromRow: 0, fromCol: 0, toRow: 0 }).length).toBeGreaterThan(0);
    expect(validateAgainst(RANGE_ARGS, { fromRow: 0, fromCol: 0, toRow: 0, toCol: 0, extra: true }).length).toBeGreaterThan(0);
  });

  it.each(runtimes)('publishes create and core-added placement arguments for %s', runtime => {
    const snapshot = buildBuiltInSnapshot({ blokVersion: 'table-actions-test' });
    const contract = buildAgentContract(buildToolManifest(snapshot), COMMANDS, { runtime, services: [] });
    const command = commandOf(contract, 'table.create');
    const args = { rows: 1, cols: 1, parentId: 'parent', position: { before: 'sibling' } };

    expect(command).toMatchObject({
      available: true, runtime: 'any', readOnly: false, source: { tool: 'table', target: 'create' },
    });
    expect(snapshot.blocks.find(block => block.name === 'table')?.handlers).toContain('create');
    expect(validateAgainst(command.args, args)).toEqual([]);
    expect(checkEnvelope({ commands: [{ name: 'table.create', args }] },
      new Map(contract.commands.map(entry => [entry.name, entry])), validateAgainst).writes).toBe(true);
    expect(contract.manifest.blocks.find(block => block.name === 'table')?.guardedFields).toEqual({ content: 'table.*' });
  });

  it('removes create from the genuine contract when hiddenActions selects it', () => {
    const snapshot = buildBuiltInSnapshot({ blokVersion: 'table-actions-test' });
    const contract = buildAgentContract(buildToolManifest(snapshot, { table: { hiddenActions: ['create'] } }),
      COMMANDS, { runtime: 'editor', services: [] });

    expect(contract.commands.some(command => command.name === 'table.create')).toBe(false);
    expect(contract.manifest.blocks.find(block => block.name === 'table')?.actions.map(action => action.name))
      .not.toContain('create');
  });

  it('keeps declarations unavailable when snapshot registration has no create handler', () => {
    const actual = buildBuiltInSnapshot({ blokVersion: 'table-actions-test' });
    const snapshot = {
      ...actual,
      blocks: actual.blocks.map(block => block.name === 'table'
        ? { ...block, handlers: block.handlers.filter(name => name !== 'create') }
        : block),
    };
    const contract = buildAgentContract(buildToolManifest(snapshot), COMMANDS, { runtime: 'node', services: [] });
    const command = commandOf(contract, 'table.create');

    expect(command.available).toBe(false);
    expect(command.unavailableReason).toBe('runtime');
    expect(() => checkEnvelope({ commands: [{ name: 'table.create', args: { rows: 1, cols: 1 } }] },
      new Map(contract.commands.map(entry => [entry.name, entry])), validateAgainst)).toThrow(AgentFailure);
  });
});

const hasMarkDestroyed = (value: unknown): value is { markDestroyed(): void } =>
  isRecord(value) && typeof value.markDestroyed === 'function';
const hasDestroy = (value: unknown): value is { destroy(): void | Promise<void> } =>
  isRecord(value) && typeof value.destroy === 'function';
const hasListeners = (value: unknown): value is { listeners: { removeAll(): void } } =>
  isRecord(value) && isRecord(value.listeners) && typeof value.listeners.removeAll === 'function';

const destroyModules = async (modules: unknown[]): Promise<void> => {
  for (const module of modules) {
    if (hasDestroy(module)) {
      await module.destroy();
    }
    if (hasListeners(module)) {
      module.listeners.removeAll();
    }
  }
};

describe('table actions in the actual editor registry', () => {
  let core: Core | undefined;
  let holder: HTMLDivElement | undefined;

  afterEach(async () => {
    try {
      if (core !== undefined) {
        await core.isReady.catch(() => undefined);
        const modules: unknown[] = Object.values(core.moduleInstances);

        // Mark all modules before teardown can schedule more work.
        modules.filter(hasMarkDestroyed).forEach(module => module.markDestroyed());
        await destroyModules(modules);
        destroyTooltip();
      }
    } finally {
      core = undefined;
      holder?.remove();
      holder = undefined;
    }
  });

  it('registers the real table and aliased grid declarations and handlers', async () => {
    const registered = builtInEditorTools();
    const table = registered.table;

    if (table === undefined) {
      throw new Error('Expected the canonical table registration.');
    }
    const element = document.createElement('div');

    holder = element;
    document.body.appendChild(element);
    const instance = new Core({
      holder: element, tabSync: false, i18n: { locale: 'en' },
      tools: { ...registered, grid: table },
    });

    core = instance;
    await instance.isReady;
    const tools = instance.moduleInstances.Tools;
    const runtimesFromEditor = runtimesFromTools(tools);
    const snapshot = snapshotFromTools(tools, {
      blokVersion: 'table-actions-test', readOnly: false, defaultBlock: 'paragraph',
      services: [], i18n: instance.moduleInstances.I18n,
    });
    const contract = buildAgentContract(buildToolManifest(snapshot), COMMANDS, { runtime: 'editor', services: [] });

    expect(tools.blockTools.get('grid')?.toolClass.actionHandlers).toBe(TABLE_ACTION_HANDLERS);
    expect(tools.blockTools.get('table')?.toolClass.actionHandlers).toBe(TABLE_ACTION_HANDLERS);
    for (const name of ['table', 'grid']) {
      expect(runtimesFromEditor.get(name)?.actions).toBe(TABLE_ACTION_HANDLERS);
      expect(snapshot.blocks.find(block => block.name === name)?.description?.actions).toEqual(TABLE_ACTIONS);
      expect(snapshot.blocks.find(block => block.name === name)?.handlers.slice().sort())
        .toEqual(Object.keys(TABLE_ACTION_HANDLERS).sort());
      for (const action of ['create', 'insertRows', 'insertColumns']) {
        expect(commandOf(contract, `${name}.${action}`)).toMatchObject({
          available: true, source: { tool: name, target: action === 'create' ? 'create' : 'block' },
        });
      }
    }
  }, 60_000);
});
