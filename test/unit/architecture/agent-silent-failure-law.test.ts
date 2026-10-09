// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkChildType, checkMove, snapshotTree } from '../../../src/shared/agent/placement-rules';
import { DocSnapshot } from '../../../src/shared/agent/snapshot';

const root = resolve(__dirname, '../../../src');
const files = ['shared/agent', 'components/modules/agent']
  .filter(directory => existsSync(join(root, directory)))
  .flatMap(directory => readdirSync(join(root, directory), { recursive: true, encoding: 'utf8' })
    .filter(name => name.endsWith('.ts'))
    .sort()
    .map(name => ({ name: `${directory}/${name}`, text: readFileSync(join(root, directory, name), 'utf8') })));

// Equal counts can hide a changed return site; review those sites too.
const EXEMPT: Record<string, { count: number; reason: string }> = {
  'shared/agent/snapshot.ts': { count: 2, reason: 'cellPosition and cellOf: null means no matching table cell' },
  'shared/agent/placement-rules.ts': { count: 4, reason: 'checkChildType and checkMove: null means placement is allowed' },
  'shared/agent/names.ts': { count: 1, reason: 'splitCommandName: null means no usable namespace/action split; envelope reports UNKNOWN_COMMAND' },
  'shared/agent/plan-block.ts': { count: 1, reason: 'childRefusal: null means no child-placement refusal for a planned parent' },
  'shared/agent/plan-text.ts': { count: 1, reason: 'input: after envelope validation, sanitized-away input is empty rich text; prepareData records SANITIZED' },
  'shared/agent/executor.ts': { count: 1, reason: 'staleContext omits blocks not named by the batch; the caller reports STALE' },
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('agent silent-failure law', () => {
  it('includes the shared planner even before the editor agent directory exists', () => {
    expect(files.map(file => file.name)).toContain('shared/agent/planner.ts');
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  it.each(files)('$name does not log', ({ text }) => {
    expect(text).not.toMatch(/\bconsole\.(?:warn|error|log|info)\s*\(/);
  });

  it.each(files)('$name returns literal null or [] only for explained valid answers', ({ name, text }) => {
    const count = (text.match(/\breturn\s+(?:null|\[\s*\])\s*;/g) ?? []).length;
    const exemption = EXEMPT[name];

    expect(count).toBe(exemption?.count ?? 0);
    if (exemption !== undefined) {
      expect(exemption.reason.trim().length).toBeGreaterThan(0);
    }
  });

  it('uses null for no cell so a cell-restricted tool stays allowed outside tables', () => {
    const snapshot = DocSnapshot.fromOutput({ blocks: [
      { id: 'parent', type: 'toggle', data: {}, content: ['outside'] },
      { id: 'outside', type: 'paragraph', data: {}, parent: 'parent' },
      { id: 'table', type: 'table', data: { content: [[{ blocks: ['inside'] }]] }, content: ['inside'] },
      { id: 'inside', type: 'paragraph', data: {}, parent: 'table' },
    ] });
    const tree = snapshotTree(snapshot, type => ({
      accepts: true, ownedByTool: false, restrictedInTableCell: type === 'header',
    }));

    expect(checkChildType(tree, 'parent', 'header')).toBeNull();
    expect(checkMove(tree, 'outside', null, undefined)).toBeNull();
    expect(snapshot.cellOf('outside')).toBeNull();
    expect(snapshot.cellOf('missing')).toBeNull();
    expect(tree.cellOf('outside', false)).toBeNull();
    expect(tree.cellOf('outside', true)).toBeNull();
    expect(tree.cellOf('missing', false)).toBeNull();
    expect(checkChildType(tree, 'inside', 'header')?.reason).toBe('RESTRICTED_IN_CELL');
  });
});
