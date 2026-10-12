// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BUILT_IN_BLOCK_DESCRIPTIONS } from '../../../../src/shared/tool-descriptions';
import { LEDGER } from '../../architecture/agent-coverage.ledger';

const TOOLS = resolve(__dirname, '../../../../src/tools');

const sourceOf = (tool: string): string => {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap(entry => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));

  return walk(join(TOOLS, tool)).map(file => readFileSync(file, 'utf8')).join('\n');
};

const mirrorsOf = Object.entries(BUILT_IN_BLOCK_DESCRIPTIONS).flatMap(([tool, describeTool]) =>
  (describeTool({}).actions ?? []).flatMap(action => (action.mirrors ?? []).map(id => ({ id, command: `${tool}.${action.name}` }))));
const mirrored = mirrorsOf.map(({ id }) => id);
const menuIds = mirrored.filter(id => id.startsWith('menu:'));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mirrors', () => {
  it('actions mirror the menu items and row/column actions they perform', () => {
    expect(mirrored).toEqual(expect.arrayContaining([
      'menu:table/table-insert-row-above', 'menu:table/table-merge-cells', 'ui-file:src/tools/table/table-cell-placement-picker.ts',
      'action:table/move-row', 'menu:database/database-view-rename', 'menu:tabs/tabs-delete', 'menu:page/page-rename',
    ]));
  });

  it.each(menuIds)('%s names a menu item that exists in that tool', (id) => {
    const [, tool = '', name = ''] = /^menu:([^/]+)\/(.+)$/.exec(id) ?? [];
    const literal = name.endsWith('*') ? `name: \`${name.slice(0, -1)}` : `name: '${name}'`;

    expect(sourceOf(tool)).toContain(literal);
  });

  it.each(mirrorsOf.filter(({ id }) => Object.hasOwn(LEDGER, id)))('$id is routed to $command in the coverage ledger too', ({ id, command }) => {
    expect(JSON.stringify(LEDGER[id])).toContain(command);
  });

  it.each(mirrored.filter(id => id.startsWith('ui-file:')))('%s names a source file that exists', (id) => {
    expect(existsSync(resolve(__dirname, '../../../..', id.slice('ui-file:'.length)))).toBe(true);
  });

  it('every mirror is an id the coverage scan can produce: menu, action or ui-file', () => {
    expect(mirrored.filter(id => !/^(menu|action|ui-file):/.test(id))).toEqual([]);
  });

  it('every action id names a RowColAction member of its tool', () => {
    const actionIds = mirrored.filter(id => id.startsWith('action:'));

    expect(actionIds.length).toBeGreaterThan(0);
    for (const id of actionIds) {
      const [, tool = '', value = ''] = /^action:([^/]+)\/(.+)$/.exec(id) ?? [];

      expect(sourceOf(tool), id).toContain(`type: '${value}'`);
    }
  });
});
