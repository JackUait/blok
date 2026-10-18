// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openJsonSession } from '../../agent/harness';

describe('reading a code block', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows its code as text, so a model can see what landed without a full read', async () => {
    const session = openJsonSession({ blocks: [{ id: 'c', type: 'code', data: { code: 'npm run build', language: 'plain text' } }] });

    try {
      const view = await session.read({});

      expect(view.blocks).toEqual([{ id: 'c', type: 'code', depth: 0, text: 'npm run build', attrs: { language: 'plain text' } }]);
    } finally {
      session.close();
    }
  });

  it('truncates long code at textLimit like other text', async () => {
    const session = openJsonSession({ blocks: [{ id: 'c', type: 'code', data: { code: 'abcdefghij', language: 'plain text' } }] });

    try {
      const view = await session.read({ textLimit: 4 });

      expect(view.blocks[0]).toMatchObject({ text: 'abcd…', truncated: true });
    } finally {
      session.close();
    }
  });
});
