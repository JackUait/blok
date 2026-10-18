// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openJsonSession } from '../../agent/harness';

describe('block.convert to an unknown type', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('names the registered types, like block.insert does, so the model can pick one without describe', async () => {
    const session = openJsonSession({ blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'TODO' }] } }] });

    try {
      const result = await session.execute({ commands: [{ name: 'block.convert', args: { id: 'p', type: 'checklist' } }] });

      expect(result).toMatchObject({ ok: false, error: { code: 'UNKNOWN_TOOL' } });
      expect(result.ok ? '' : result.error.message).toMatch(/Known: .*\blist\b/);
    } finally {
      session.close();
    }
  });
});
