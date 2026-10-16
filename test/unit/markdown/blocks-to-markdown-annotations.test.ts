import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { blocksToMarkdown } from '../../../src/markdown/blocks-to-markdown';

describe('editor Markdown export skips comment threads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes the row body but not a thread or its replies', () => {
    const markdown = blocksToMarkdown([
      { id: 'r1', tool: 'database-row', data: { properties: {} }, parentId: null, contentIds: ['c1', 'k1'] },
      { id: 'c1', tool: 'paragraph', data: { text: 'Body text' }, parentId: 'r1' },
      { id: 'k1', tool: 'database-comment', data: { text: 'Thread secret' }, parentId: 'r1', contentIds: ['k2'] },
      { id: 'k2', tool: 'paragraph', data: { text: 'Reply secret' }, parentId: 'k1' },
    ]);

    expect(markdown).not.toContain('secret');
    expect(markdown).toContain('Body text');
  });
});
