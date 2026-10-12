// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openJsonSession } from './harness';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('markdown.insert lists', () => {
  it('inserts root items without depth and keeps nested depth', async () => {
    const session = openJsonSession({ blocks: [] });
    const result = await session.execute({ commands: [{ name: 'markdown.insert', args: { markdown: '- one\n- two\n  - inner\n\n1. first' } }] });

    expect(result.ok ? null : result.error).toBeNull();
    const lists = session.output().blocks.filter((block) => block.type === 'list');

    expect(lists.map((block) => block.data.depth)).toEqual([undefined, undefined, 1, undefined]);
    expect(lists.every((block) => !('depth' in block.data) || block.data.depth !== 0)).toBe(true);
  });
});
