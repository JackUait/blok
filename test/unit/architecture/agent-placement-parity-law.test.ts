// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import { API as APIModule } from '../../../src/components/modules/api';
import { assertCanMoveUnder, BlockPlacementError } from '../../../src/components/modules/api/block-placement';
import { BlockManager } from '../../../src/components/modules/blockManager';
import { isChildToolAllowed, satisfiesChildToolRestrictions } from '../../../src/components/utils/child-tools';
import { checkMove, satisfiesChildTools, snapshotTree } from '../../../src/shared/agent/placement-rules';
import { DocSnapshot } from '../../../src/shared/agent/snapshot';
import { Column } from '../../../src/tools/column';
import { ColumnList } from '../../../src/tools/column-list';
import { Header } from '../../../src/tools/header';
import { Paragraph } from '../../../src/tools/paragraph';
import { Table } from '../../../src/tools/table';
import { isInsideTableCell, isRestrictedInTableCell } from '../../../src/tools/table/table-restrictions';
import { ToggleItem } from '../../../src/tools/toggle';

import type { Block } from '../../../src/components/block';
import type { BlockTree } from '../../../src/components/modules/api/block-placement';
import type { Refusal } from '../../../src/shared/agent/placement-rules';
import type { API, BlockTool } from '../../../types';
import type { MoveToTarget } from '../../../types/api/blocks';
import type { OutputBlockData } from '../../../types/data-formats/output-data';
import type { ChildToolRestrictions } from '../../../types/tools';

const source = (path: string): string => readFileSync(resolve(__dirname, '../../../', path), 'utf8');

const exportedBody = (text: string, name: string): ts.Node => {
  const file = ts.createSourceFile('law.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const declarations = file.statements.flatMap(statement =>
    ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : []
  );

  for (const declaration of declarations) {
    if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) {
      continue;
    }
    const initializer = declaration.initializer;

    if (initializer !== undefined && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
      return initializer.body;
    }
  }

  throw new Error(`Expected exported function "${name}"`);
};

const calls = (body: ts.Node): string[] => {
  const names: string[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      names.push(node.expression.text);
    }
    ts.forEachChild(node, walk);
  };

  walk(body);

  return names;
};

class Container implements BlockTool {
  public render(): HTMLElement {
    return document.createElement('div');
  }

  public save(): Record<string, never> {
    return {};
  }
}

class Owner extends Container {
  public static get ownsChildren(): boolean {
    return true;
  }
}

class Leaf extends Container {
  public static get acceptsChildren(): boolean {
    return false;
  }
}

class ClosedOwner extends Owner {
  public static get acceptsChildren(): boolean {
    return false;
  }

  public static get childTools(): ChildToolRestrictions {
    return { deny: ['paragraph'] };
  }
}

class ParagraphsOnly extends Container {
  public static get childTools(): ChildToolRestrictions {
    return { allow: ['paragraph'] };
  }
}

class DenyWins extends Container {
  public static get childTools(): ChildToolRestrictions {
    return { allow: ['paragraph', 'header'], deny: ['header'] };
  }
}

class EmptyLists extends Container {
  public static get childTools(): ChildToolRestrictions {
    return { allow: [], deny: [] };
  }
}

const paragraph = (id: string, parent?: string): OutputBlockData => ({
  id, type: 'paragraph', data: { text: id }, ...(parent !== undefined && { parent }),
});

const toggle = (id: string, content: string[], parent?: string): OutputBlockData => ({
  id, type: 'toggle', data: { text: id, isOpen: true }, content, ...(parent !== undefined && { parent }),
});

const ordinaryBlocks = (): OutputBlockData[] => [
  paragraph('free'),
  { id: 'h', type: 'header', data: { text: 'Heading', level: 2 } },
  toggle('tg', ['in']),
  paragraph('in', 'tg'),
  { id: 'leaf', type: 'leaf', data: {} },
  { id: 'owner', type: 'owner', data: {}, content: ['owned', 'ownedOther'] },
  paragraph('owned', 'owner'),
  paragraph('ownedOther', 'owner'),
  { id: 'otherOwner', type: 'owner', data: {} },
  { id: 'closedOwner', type: 'closedOwner', data: {} },
  { id: 'only', type: 'only', data: {} },
  { id: 'both', type: 'both', data: {} },
  { id: 'empty', type: 'empty', data: {} },
  { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2'] },
  { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['x1', 'x2'] },
  paragraph('x1', 'c1'),
  paragraph('x2', 'c1'),
  { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['y1'] },
  paragraph('y1', 'c2'),
];

const cellBlocks = (tableType: string): OutputBlockData[] => [
  {
    id: 'tbl', type: tableType,
    data: { withHeadings: false, content: [[{ blocks: ['p1', 'p2', 'cellToggle'] }, { blocks: ['q1', 'q2'] }]] },
    content: ['p1', 'p2', 'cellToggle', 'q1', 'q2'],
  },
  paragraph('p1', 'tbl'),
  paragraph('p2', 'tbl'),
  toggle('cellToggle', ['deepToggle'], 'tbl'),
  toggle('deepToggle', ['deep1', 'deep2'], 'cellToggle'),
  paragraph('deep1', 'deepToggle'),
  paragraph('deep2', 'deepToggle'),
  paragraph('q1', 'tbl'),
  paragraph('q2', 'tbl'),
  paragraph('free'),
];

interface RuntimeFixture {
  api: API;
  tree: BlockTree;
}

let editor: Blok | undefined;
let holder: HTMLDivElement | undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const boot = async (blocks: OutputBlockData[]): Promise<RuntimeFixture> => {
  if (holder === undefined) {
    throw new Error('Expected editor holder');
  }

  const instance = new Blok({
    holder,
    tools: {
      paragraph: Paragraph, toggle: ToggleItem, header: Header, table: Table, grid_alias: Table,
      column: Column, column_list: ColumnList, owner: Owner, leaf: Leaf,
      closedOwner: ClosedOwner, only: ParagraphsOnly, both: DenyWins, empty: EmptyLists,
    },
    data: { blocks },
  });

  editor = instance;
  await instance.isReady;
  await new Promise<void>(done => {
    setTimeout(done, 0);
  });
  for (let frame = 0; frame < 2; frame++) {
    await new Promise<void>(done => {
      requestAnimationFrame(() => done());
    });
  }

  if (!('module' in instance) || !isRecord(instance.module)) {
    throw new Error('Expected editor module aliases');
  }
  const apiModule = instance.module.api;
  const manager = instance.module.blockManager;

  if (!(apiModule instanceof APIModule) || !(manager instanceof BlockManager)) {
    throw new Error('Expected real API and block manager modules');
  }

  return {
    api: apiModule.methods,
    tree: { blocks: manager.blocks, getBlockById: id => manager.getBlockById(id) },
  };
};

const requireBlock = (tree: BlockTree, id: string): Block => {
  const block = tree.getBlockById(id);

  if (block === undefined) {
    throw new Error(`Expected fixture block "${id}"`);
  }

  return block;
};

const snapshotOf = async ({ api, tree }: RuntimeFixture) => {
  const snapshot = DocSnapshot.fromOutput(await api.saver.save());
  const rules = snapshotTree(snapshot, type => {
    const adapter = tree.blocks.find(block => block.name === type)?.tool;

    return adapter === undefined ? undefined : {
      accepts: adapter.acceptsChildren,
      allow: adapter.childTools?.allow,
      deny: adapter.childTools?.deny,
      ownedByTool: adapter.ownsChildren,
      restrictedInTableCell: isRestrictedInTableCell(type),
    };
  });

  return { snapshot, rules };
};

const errorOf = (run: () => void): unknown => {
  try {
    run();
  } catch (error: unknown) {
    return error;
  }

  return null;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'test');
  holder = document.createElement('div');
  document.body.appendChild(holder);
});

afterEach(() => {
  editor?.destroy();
  holder?.remove();
  editor = undefined;
  holder = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('one shared placement implementation', () => {
  it('assertCanMoveUnder calls the imported shared move rule', () => {
    const placement = source('src/components/modules/api/block-placement.ts');

    expect(calls(exportedBody(placement, 'assertCanMoveUnder'))).toContain('checkMove');
    expect(placement).toMatch(/import[\s\S]*?\bcheckMove\b[\s\S]*?from ['"]\.\.\/\.\.\/\.\.\/shared\/agent\/placement-rules['"]/);
  });

  it('the editor no longer carries a second set of move-rule messages', () => {
    const placement = source('src/components/modules/api/block-placement.ts');

    for (const message of [
      'inside its own subtree', 'into, out of or between table cells', 'takes no children',
      'owns its children', 'into or out of a column', 'does not allow',
      'is not allowed inside a table cell',
    ]) {
      expect(placement).not.toContain(message);
    }
  });

  it('the editor allow/deny function delegates to the shared predicate', () => {
    const childTools = source('src/components/utils/child-tools.ts');
    const body = exportedBody(childTools, 'satisfiesChildToolRestrictions');

    expect(calls(body)).toContain('satisfiesChildTools');
    expect(calls(body)).not.toContain('includes');
    expect(body.getText()).not.toMatch(/\.includes\(/);
    expect(childTools).toMatch(/from ['"]\.\.\/\.\.\/shared\/agent\/placement-rules['"]/);
  });

  it('the shared rule module has no runtime DOM or editor dependencies', () => {
    const text = source('src/shared/agent/placement-rules.ts');
    const file = ts.createSourceFile('rules.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const runtimeImports = file.statements.filter(statement =>
      ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly !== true
    );

    expect(runtimeImports).toEqual([]);
    expect(text).not.toMatch(/\b(?:window|document|HTMLElement|Element)\b|\.holder\b|\.closest\(/);
  });
});

describe('shared moves match exact public editor refusals', () => {
  const cases: Array<{ name: string; id: string; parentId: string | null; expected: Refusal }> = [
    { name: 'own subtree', id: 'tg', parentId: 'in',
      expected: { reason: 'OWN_SUBTREE', message: 'cannot move "tg" inside its own subtree' } },
    { name: 'no children before new ownership and denial', id: 'free', parentId: 'closedOwner',
      expected: { reason: 'TAKES_NO_CHILDREN', message: '"closedOwner" takes no children' } },
    { name: 'no children before old ownership', id: 'owned', parentId: 'leaf',
      expected: { reason: 'TAKES_NO_CHILDREN', message: '"leaf" takes no children' } },
    { name: 'new ownership before old ownership', id: 'owned', parentId: 'otherOwner',
      expected: { reason: 'OWNS_CHILDREN', message: '"otherOwner" owns its children' } },
    { name: 'old ownership before columns', id: 'owned', parentId: 'c1',
      expected: { reason: 'OWNS_CHILDREN', message: '"owner" owns its children; "owned" cannot leave it' } },
    { name: 'column boundary', id: 'free', parentId: 'c1',
      expected: { reason: 'COLUMN_BOUNDARY', message: 'cannot move "free" into or out of a column' } },
    { name: 'column-list ownership before boundary', id: 'free', parentId: 'cl',
      expected: { reason: 'OWNS_CHILDREN', message: '"cl" owns its children' } },
    { name: 'allow list', id: 'h', parentId: 'only',
      expected: { reason: 'CHILD_NOT_ALLOWED', message: '"only" does not allow "header" children', allowed: ['paragraph'] } },
    { name: 'deny beats allow', id: 'h', parentId: 'both',
      expected: { reason: 'CHILD_NOT_ALLOWED', message: '"both" does not allow "header" children', allowed: ['paragraph', 'header'] } },
  ];

  it.each(cases)('$name', async ({ id, parentId, expected }) => {
    const live = await boot(ordinaryBlocks());
    const { snapshot, rules } = await snapshotOf(live);
    const before = snapshot.toOutput().blocks;
    const error = errorOf(() => live.api.blocks.moveTo(id, { parentId, position: 'end' }));

    expect(error instanceof Error ? error.message : error).toBe(expected.message);
    expect(error).toBeInstanceOf(BlockPlacementError);
    expect(checkMove(rules, id, parentId, undefined)).toEqual(expected);
    expect((await live.api.saver.save()).blocks).toEqual(before);
  }, 30_000);

  it('empty lists allow an actual editor move', async () => {
    const live = await boot(ordinaryBlocks());
    const { rules } = await snapshotOf(live);

    expect(errorOf(() => live.api.blocks.moveTo('h', { parentId: 'empty', position: 'end' }))).toBeNull();
    expect(checkMove(rules, 'h', 'empty', undefined)).toBeNull();
    expect(DocSnapshot.fromOutput(await live.api.saver.save()).parentOf('h')).toBe('empty');
  }, 30_000);

  it.each([
    { parentId: 'owner', id: 'ownedOther', refId: 'owned' },
    { parentId: 'c1', id: 'x2', refId: 'x1' },
  ])('same-parent reorder remains legal under $parentId', async ({ parentId, id, refId }) => {
    const live = await boot(ordinaryBlocks());
    const { rules } = await snapshotOf(live);

    expect(errorOf(() => live.api.blocks.moveTo(id, { position: { before: refId } }))).toBeNull();
    expect(checkMove(rules, id, parentId, refId)).toBeNull();
    expect(DocSnapshot.fromOutput(await live.api.saver.save()).childrenOf(parentId)).toEqual([id, refId]);
  }, 30_000);

  it('the real container predicate and shared allow/deny results agree', async () => {
    const live = await boot(ordinaryBlocks());

    for (const parentId of ['only', 'both', 'empty', 'leaf']) {
      const parent = requireBlock(live.tree, parentId);
      const restrictions = parent.tool.childTools;

      for (const type of ['paragraph', 'header', 'table']) {
        expect(isChildToolAllowed(parent, type)).toBe(
          parent.tool.acceptsChildren && satisfiesChildTools(restrictions?.allow, restrictions?.deny, type)
        );
        expect(satisfiesChildToolRestrictions(restrictions, type)).toBe(
          satisfiesChildTools(restrictions?.allow, restrictions?.deny, type)
        );
      }
    }
  }, 30_000);
});

describe.each(['table'])('real %s cell placement matches snapshot rules', tableType => {
  it('checks different cells before returning for the same table parent', async () => {
    const live = await boot(cellBlocks(tableType));
    const { snapshot, rules } = await snapshotOf(live);
    const before = snapshot.toOutput().blocks;
    const error = errorOf(() => live.api.blocks.moveTo('p1', { position: { after: 'q1' } }));

    expect(error instanceof Error ? error.message : error).toBe('cannot move "p1" into, out of or between table cells');
    expect(error).toBeInstanceOf(BlockPlacementError);
    expect(checkMove(rules, 'p1', 'tbl', 'q1')).toEqual({
      reason: 'TABLE_CELL_BOUNDARY', message: 'cannot move "p1" into, out of or between table cells',
    });
    expect((await live.api.saver.save()).blocks).toEqual(before);
  }, 30_000);

  it.each([
    { id: 'p2', refId: 'p1', expected: ['p2', 'p1', 'cellToggle'] },
    { id: 'q2', refId: 'q1', expected: ['q2', 'q1'] },
  ])('reorders $id in its own cell without triggering table ownership', async ({ id, refId, expected }) => {
    const live = await boot(cellBlocks(tableType));
    const { rules } = await snapshotOf(live);

    expect(errorOf(() => live.api.blocks.moveTo(id, { position: { before: refId } }))).toBeNull();
    expect(checkMove(rules, id, 'tbl', refId)).toBeNull();

    const after = DocSnapshot.fromOutput(await live.api.saver.save());
    const targetCell = after.cellOf(id);
    const directCellChildren = after.childrenOf('tbl').filter(childId => {
      const cell = after.cellOf(childId);

      return targetCell !== null && cell !== null
        && cell.tableId === targetCell.tableId && cell.row === targetCell.row && cell.col === targetCell.col;
    });

    expect(directCellChildren).toEqual(expected);

    const movingCell = requireBlock(live.tree, id).holder.parentElement?.closest('[data-blok-table-cell-blocks]') ?? null;
    const referenceCell = requireBlock(live.tree, refId).holder.parentElement?.closest('[data-blok-table-cell-blocks]') ?? null;

    expect(movingCell).not.toBeNull();
    expect(movingCell).toBe(referenceCell);
  }, 30_000);

  const noCellTargets: Array<{ name: string; target: MoveToTarget }> = [
    { name: 'table start', target: { parentId: 'tbl', position: 'start' } },
    { name: 'table end', target: { parentId: 'tbl', position: 'end' } },
    { name: 'root sibling', target: { position: { before: 'free' } } },
  ];

  it.each(noCellTargets)('$name does not name a target cell', async ({ target }) => {
    const live = await boot(cellBlocks(tableType));
    const before = (await live.api.saver.save()).blocks;
    const error = errorOf(() => live.api.blocks.moveTo('p1', target));

    expect(error instanceof Error ? error.message : error).toBe('cannot move "p1" into, out of or between table cells');
    expect(error).toBeInstanceOf(BlockPlacementError);
    expect((await live.api.saver.save()).blocks).toEqual(before);
  }, 30_000);

  it('finds a deep descendant cell when changing its parent within that cell', async () => {
    const live = await boot(cellBlocks(tableType));
    const { rules } = await snapshotOf(live);

    expect(errorOf(() => live.api.blocks.moveTo('deep1', { parentId: 'cellToggle', position: 'end' }))).toBeNull();
    expect(checkMove(rules, 'deep1', 'cellToggle', undefined)).toBeNull();

    const after = DocSnapshot.fromOutput(await live.api.saver.save());

    expect(after.parentOf('deep1')).toBe('cellToggle');
    expect(after.cellOf('deep1')).toEqual({ tableId: 'tbl', row: 0, col: 0 });

    const deepCell = requireBlock(live.tree, 'deep1').holder.parentElement?.closest('[data-blok-table-cell-blocks]') ?? null;
    const directCell = requireBlock(live.tree, 'p1').holder.parentElement?.closest('[data-blok-table-cell-blocks]') ?? null;

    expect(deepCell).not.toBeNull();
    expect(deepCell).toBe(directCell);
  }, 30_000);

  it('uses a deep reference to detect a different cell', async () => {
    const live = await boot(cellBlocks(tableType));
    const { rules } = await snapshotOf(live);
    const before = (await live.api.saver.save()).blocks;
    const error = errorOf(() => live.api.blocks.moveTo('q1', { position: { after: 'deep2' } }));

    expect(error instanceof Error ? error.message : error).toBe('cannot move "q1" into, out of or between table cells');
    expect(error).toBeInstanceOf(BlockPlacementError);
    expect(checkMove(rules, 'q1', 'deepToggle', 'deep2')).toEqual({
      reason: 'TABLE_CELL_BOUNDARY', message: 'cannot move "q1" into, out of or between table cells',
    });
    expect((await live.api.saver.save()).blocks).toEqual(before);
  }, 30_000);

  it('preserves the exported adapter fallback for an unknown sibling ID', async () => {
    const live = await boot(cellBlocks(tableType));
    const moving = requireBlock(live.tree, 'deep1');

    expect(errorOf(() => assertCanMoveUnder(live.tree, moving, 'deepToggle', 'missing'))).toBeNull();
    expect(errorOf(() => assertCanMoveUnder(live.tree, moving, 'cellToggle', 'missing'))).toBeNull();

    const noCellError = errorOf(() => assertCanMoveUnder(live.tree, moving, 'tbl', 'missing'));

    expect(noCellError instanceof Error ? noCellError.message : noCellError)
      .toBe('cannot move "deep1" into, out of or between table cells');
    expect(noCellError).toBeInstanceOf(BlockPlacementError);
  }, 30_000);

  it('public moveTo rejects a missing sibling before placement rules', async () => {
    const live = await boot(cellBlocks(tableType));
    const before = (await live.api.saver.save()).blocks;
    const error = errorOf(() => live.api.blocks.moveTo('deep1', {
      parentId: 'deepToggle', position: { after: 'missing' },
    }));

    expect(error instanceof Error ? error.message : error).toBe('block "missing" not found');
    expect(error).toBeInstanceOf(BlockPlacementError);
    expect((await live.api.saver.save()).blocks).toEqual(before);
  }, 30_000);
});

describe('real aliased table DOM matches authored snapshot placement', () => {
  const aliasFixture = async () => {
    const blocks = cellBlocks('grid_alias');
    const live = await boot(blocks);
    const snapshot = DocSnapshot.fromOutput({ blocks });
    const rules = snapshotTree(snapshot, type => {
      const adapter = live.tree.blocks.find(block => block.name === type)?.tool;

      return adapter === undefined ? undefined : {
        accepts: adapter.acceptsChildren,
        allow: adapter.childTools?.allow,
        deny: adapter.childTools?.deny,
        ownedByTool: adapter.ownsChildren,
        restrictedInTableCell: isRestrictedInTableCell(type),
      };
    });
    const firstCell = requireBlock(live.tree, 'p1').holder.parentElement?.closest('[data-blok-table-cell-blocks]') ?? null;
    const secondCell = requireBlock(live.tree, 'q1').holder.parentElement?.closest('[data-blok-table-cell-blocks]') ?? null;
    const deepCell = requireBlock(live.tree, 'deep1').holder.parentElement?.closest('[data-blok-table-cell-blocks]') ?? null;

    expect(requireBlock(live.tree, 'tbl').name).toBe('grid_alias');
    expect(firstCell).not.toBeNull();
    expect(secondCell).not.toBeNull();
    expect(firstCell).not.toBe(secondCell);
    expect(deepCell).toBe(firstCell);
    expect(snapshot.cellOf('deep1')).toEqual({ tableId: 'tbl', row: 0, col: 0 });
    expect(snapshot.cellOf('q1')).toEqual({ tableId: 'tbl', row: 0, col: 1 });

    return { live, rules };
  };

  it('checks different cells before returning for the same table parent', async () => {
    const { live, rules } = await aliasFixture();
    const error = errorOf(() => assertCanMoveUnder(live.tree, requireBlock(live.tree, 'p1'), 'tbl', 'q1'));

    expect(error instanceof Error ? error.message : error).toBe('cannot move "p1" into, out of or between table cells');
    expect(error).toBeInstanceOf(BlockPlacementError);
    expect(checkMove(rules, 'p1', 'tbl', 'q1')).toEqual({
      reason: 'TABLE_CELL_BOUNDARY', message: 'cannot move "p1" into, out of or between table cells',
    });
  }, 30_000);

  it.each([
    { id: 'p2', refId: 'p1' },
    { id: 'q2', refId: 'q1' },
  ])('admits $id beside its own cell sibling despite table ownership', async ({ id, refId }) => {
    const { live, rules } = await aliasFixture();

    expect(errorOf(() => assertCanMoveUnder(live.tree, requireBlock(live.tree, id), 'tbl', refId))).toBeNull();
    expect(checkMove(rules, id, 'tbl', refId)).toBeNull();

    const movingCell = requireBlock(live.tree, id).holder.parentElement?.closest('[data-blok-table-cell-blocks]') ?? null;
    const referenceCell = requireBlock(live.tree, refId).holder.parentElement?.closest('[data-blok-table-cell-blocks]') ?? null;

    expect(movingCell).not.toBeNull();
    expect(movingCell).toBe(referenceCell);
  }, 30_000);

  const noCellTargets: Array<{ name: string; parentId: string | null; refId: string | undefined }> = [
    { name: 'table parent without a sibling', parentId: 'tbl', refId: undefined },
    { name: 'root sibling', parentId: null, refId: 'free' },
  ];

  it.each(noCellTargets)('$name does not name a target cell', async ({ parentId, refId }) => {
    const { live, rules } = await aliasFixture();
    const error = errorOf(() => assertCanMoveUnder(live.tree, requireBlock(live.tree, 'p1'), parentId, refId));

    expect(error instanceof Error ? error.message : error).toBe('cannot move "p1" into, out of or between table cells');
    expect(error).toBeInstanceOf(BlockPlacementError);
    expect(checkMove(rules, 'p1', parentId, refId)).toEqual({
      reason: 'TABLE_CELL_BOUNDARY', message: 'cannot move "p1" into, out of or between table cells',
    });
  }, 30_000);

  it('admits a deep descendant under another parent in its nearest cell', async () => {
    const { live, rules } = await aliasFixture();
    const error = errorOf(() => assertCanMoveUnder(live.tree, requireBlock(live.tree, 'deep1'), 'cellToggle'));

    expect(error).toBeNull();
    expect(checkMove(rules, 'deep1', 'cellToggle', undefined)).toBeNull();

    const parentCell = requireBlock(live.tree, 'cellToggle').holder.closest('[data-blok-table-cell-blocks]');
    const movingCell = requireBlock(live.tree, 'deep1').holder.parentElement?.closest('[data-blok-table-cell-blocks]') ?? null;

    expect(parentCell).not.toBeNull();
    expect(movingCell).toBe(parentCell);
  }, 30_000);

  it('uses a deep reference to detect a different cell', async () => {
    const { live, rules } = await aliasFixture();
    const error = errorOf(() => assertCanMoveUnder(live.tree, requireBlock(live.tree, 'q1'), 'deepToggle', 'deep2'));

    expect(error instanceof Error ? error.message : error).toBe('cannot move "q1" into, out of or between table cells');
    expect(error).toBeInstanceOf(BlockPlacementError);
    expect(checkMove(rules, 'q1', 'deepToggle', 'deep2')).toEqual({
      reason: 'TABLE_CELL_BOUNDARY', message: 'cannot move "q1" into, out of or between table cells',
    });

    const referenceCell = requireBlock(live.tree, 'deep2').holder.parentElement?.closest('[data-blok-table-cell-blocks]') ?? null;
    const movingCell = requireBlock(live.tree, 'q1').holder.parentElement?.closest('[data-blok-table-cell-blocks]') ?? null;

    expect(referenceCell).not.toBeNull();
    expect(movingCell).not.toBeNull();
    expect(movingCell).not.toBe(referenceCell);
  }, 30_000);

  it('preserves the exported adapter fallback for an unknown sibling ID', async () => {
    const { live } = await aliasFixture();
    const moving = requireBlock(live.tree, 'deep1');

    expect(errorOf(() => assertCanMoveUnder(live.tree, moving, 'deepToggle', 'missing'))).toBeNull();
    expect(errorOf(() => assertCanMoveUnder(live.tree, moving, 'cellToggle', 'missing'))).toBeNull();

    const noCellError = errorOf(() => assertCanMoveUnder(live.tree, moving, 'tbl', 'missing'));

    expect(noCellError instanceof Error ? noCellError.message : noCellError)
      .toBe('cannot move "deep1" into, out of or between table cells');
    expect(noCellError).toBeInstanceOf(BlockPlacementError);
  }, 30_000);

  it('public moveTo rejects a missing sibling before changing live placement', async () => {
    const { live } = await aliasFixture();
    const moving = requireBlock(live.tree, 'deep1');
    const parentId = moving.parentId;
    const parentElement = moving.holder.parentElement;
    const error = errorOf(() => live.api.blocks.moveTo('deep1', {
      parentId: 'deepToggle', position: { after: 'missing' },
    }));

    expect(error instanceof Error ? error.message : error).toBe('block "missing" not found');
    expect(error).toBeInstanceOf(BlockPlacementError);
    expect(moving.parentId).toBe(parentId);
    expect(moving.holder.parentElement).toBe(parentElement);
  }, 30_000);
});

describe('internal column opt-in leaves public placement behavior unchanged', () => {
  it('bypasses the column rule only in the exported internal adapter', async () => {
    const live = await boot(ordinaryBlocks());
    const moving = requireBlock(live.tree, 'free');
    const before = (await live.api.saver.save()).blocks;
    const defaultError = errorOf(() => assertCanMoveUnder(live.tree, moving, 'c1'));

    expect(defaultError instanceof Error ? defaultError.message : defaultError)
      .toBe('cannot move "free" into or out of a column');
    expect(errorOf(() => assertCanMoveUnder(live.tree, moving, 'c1', undefined, { allowColumnMoves: true }))).toBeNull();

    const publicError = errorOf(() => live.api.blocks.moveTo('free', { parentId: 'c1', position: 'end' }));

    expect(publicError instanceof Error ? publicError.message : publicError)
      .toBe('cannot move "free" into or out of a column');
    expect((await live.api.saver.save()).blocks).toEqual(before);
  }, 30_000);

  const cases: Array<{ name: string; id: string; parentId: string | null; message: string }> = [
    { name: 'no children', id: 'x1', parentId: 'leaf', message: '"leaf" takes no children' },
    { name: 'new-parent ownership', id: 'free', parentId: 'cl', message: '"cl" owns its children' },
    { name: 'old-parent ownership', id: 'c1', parentId: null, message: '"cl" owns its children; "c1" cannot leave it' },
    { name: 'child restriction', id: 'h', parentId: 'only', message: '"only" does not allow "header" children' },
    { name: 'own subtree', id: 'c1', parentId: 'x1', message: 'cannot move "c1" inside its own subtree' },
  ];

  it.each(cases)('still refuses $name', async ({ id, parentId, message }) => {
    const live = await boot(ordinaryBlocks());
    const error = errorOf(() => assertCanMoveUnder(
      live.tree, requireBlock(live.tree, id), parentId, undefined, { allowColumnMoves: true }
    ));

    expect(error instanceof Error ? error.message : error).toBe(message);
    expect(error).toBeInstanceOf(BlockPlacementError);
  }, 30_000);

  it('still refuses a real table-cell boundary', async () => {
    const live = await boot(cellBlocks('grid_alias'));
    const error = errorOf(() => assertCanMoveUnder(
      live.tree, requireBlock(live.tree, 'deep1'), null, undefined, { allowColumnMoves: true }
    ));

    expect(error instanceof Error ? error.message : error)
      .toBe('cannot move "deep1" into, out of or between table cells');
    expect(error).toBeInstanceOf(BlockPlacementError);
  }, 30_000);
});

describe('DOM cell lookup keeps its two entry points', () => {
  it('prospective-parent lookup starts at the holder itself', async () => {
    const live = await boot(ordinaryBlocks());
    const parent = requireBlock(live.tree, 'tg');

    parent.holder.setAttribute('data-blok-table-cell-blocks', '');

    const error = errorOf(() => live.api.blocks.moveTo('free', { parentId: 'tg', position: 'end' }));

    expect(error instanceof Error ? error.message : error).toBe('cannot move "free" into, out of or between table cells');
    expect(isInsideTableCell(parent)).toBe(true);
    expect(error).toBeInstanceOf(BlockPlacementError);
  }, 30_000);

  it('moving and reference lookup start above their holders', async () => {
    const live = await boot(ordinaryBlocks());
    const moving = requireBlock(live.tree, 'free');
    const reference = requireBlock(live.tree, 'h');

    moving.holder.setAttribute('data-blok-table-cell-blocks', '');
    reference.holder.setAttribute('data-blok-table-cell-blocks', '');

    expect(errorOf(() => live.api.blocks.moveTo('free', { position: { after: 'h' } }))).toBeNull();
    expect(moving.holder.parentElement?.closest('[data-blok-table-cell-blocks]')).toBeNull();
    expect(reference.holder.parentElement?.closest('[data-blok-table-cell-blocks]')).toBeNull();
    expect(isInsideTableCell(moving)).toBe(true);
    expect(isInsideTableCell(reference)).toBe(true);
  }, 30_000);
});

describe('public resolver validation remains separate', () => {
  const cases: Array<{ name: string; id: string; target: MoveToTarget; message: string }> = [
    { name: 'missing block comes first', id: 'missing', target: { parentId: 'missingParent', position: 'end' }, message: 'block "missing" not found' },
    { name: 'self reference comes before missing parent', id: 'free', target: { parentId: 'missingParent', position: { after: 'free' } }, message: 'cannot place "free" relative to itself' },
    { name: 'missing parent comes before missing sibling', id: 'free', target: { parentId: 'missingParent', position: { after: 'missing' } }, message: 'parent block "missingParent" not found' },
    { name: 'sibling must belong to explicit parent', id: 'free', target: { parentId: 'tg', position: { after: 'h' } }, message: 'block "h" is not a child of "tg"' },
  ];

  it.each(cases)('$name', async ({ id, target, message }) => {
    const live = await boot(ordinaryBlocks());
    const before = (await live.api.saver.save()).blocks;
    const error = errorOf(() => live.api.blocks.moveTo(id, target));

    expect(error instanceof Error ? error.message : error).toBe(message);
    expect(error).toBeInstanceOf(BlockPlacementError);
    expect((await live.api.saver.save()).blocks).toEqual(before);
  }, 30_000);
});
