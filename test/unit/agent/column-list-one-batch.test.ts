// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OutputData } from '../../../types';
import { openJsonSession } from './harness';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const EMPTY: OutputData = { blocks: [] };

describe('filling new columns in one batch', () => {
  it('column_list.create guidance points to block.insert with column ids', () => {
    const session = openJsonSession(EMPTY);
    const described = session.describe({ command: 'column_list.create' });
    const guidance = 'command' in described ? described.command.guidance : undefined;

    expect(guidance).toContain('block.insert a column_list');
    expect(guidance).toContain('parentId');
  });

  it('places a header and a table in each column with one execute', async () => {
    const session = openJsonSession(EMPTY);
    const column = (id: string, text: string): Record<string, unknown> =>
      ({ id, type: 'column', children: [{ type: 'header', data: { text, level: 3 } }] });
    const table = (parentId: string): Record<string, unknown> =>
      ({ name: 'table.create', args: { parentId, position: 'end', rows: 3, cols: 2 } });

    const result = await session.execute({
      commands: [
        { name: 'block.insert', args: { type: 'column_list', position: 'end', children: [column('a', 'Plan A'), column('b', 'Plan B')] } },
        table('a'),
        table('b'),
      ],
    });

    expect(result.ok).toBe(true);
    const blocks = session.output().blocks;
    const typesIn = (parent: string): string[] => blocks.filter(block => block.parent === parent).map(block => block.type);

    expect(typesIn('a')).toEqual(['header', 'table']);
    expect(typesIn('b')).toEqual(['header', 'table']);
  });
});
