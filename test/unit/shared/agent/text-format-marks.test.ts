// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { nodeContract, openJsonSession } from '../../agent/harness';

const seed = { blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'See the report.' }] } }] };

describe('text.format marks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses a link given as a bare string instead of dropping it silently', async () => {
    const session = openJsonSession(seed);

    try {
      const result = await session.execute({ commands: [
        { name: 'text.format', args: { id: 'p', range: { find: 'report' }, set: { link: 'https://example.com' } } },
      ] });

      expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_ARGS' } });
      expect(JSON.stringify(result.ok ? {} : result.error)).toContain('link');
    } finally {
      session.close();
    }
  });

  it('applies a link given as { href }, with the Link tool defaults', async () => {
    const session = openJsonSession(seed);

    try {
      const result = await session.execute({ commands: [
        { name: 'text.format', args: { id: 'p', range: { find: 'report' }, set: { link: { href: 'https://example.com' } } } },
      ] });

      expect(result.ok).toBe(true);
      expect(session.output().blocks[0]?.data.text).toContainEqual({ text: 'report', marks: { link: { href: 'https://example.com', target: '_blank', rel: 'nofollow' } } });
    } finally {
      session.close();
    }
  });

  it('shows the mark shapes in the command schema, so the model needs no describe call for a link', () => {
    const format = nodeContract().commands.find(entry => entry.name === 'text.format');

    expect(JSON.stringify(format?.args)).toContain('"href"');
  });
});
