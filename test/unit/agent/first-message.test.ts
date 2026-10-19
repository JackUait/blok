// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { composeFirstMessage, OUTLINE_READ } from '../../../src/agent/first-message';
import { openJsonSession } from './harness';
import type { DocumentView, ViewArgs } from '../../../types/agent';

const SEED = {
  blocks: [
    { id: 'h1', type: 'header', data: { text: 'Plan', level: 2 } },
    { id: 'p1', type: 'paragraph', data: { text: 'First line here' } },
  ],
};

describe('composeFirstMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('carries the document exactly as blok_read returns it, so the model can skip that read', async () => {
    const session = openJsonSession(SEED);

    try {
      const read = (args: ViewArgs): Promise<DocumentView> => session.read(args);
      const message = await composeFirstMessage('Add a summary', '', read);

      expect(message.startsWith('Add a summary\n\n')).toBe(true);
      expect(message).toContain(JSON.stringify(OUTLINE_READ));
      expect(message).toContain(JSON.stringify(await session.read(OUTLINE_READ)));
    } finally {
      await session.close();
    }
  });

  it('puts the editor context after the document, since it names block ids', async () => {
    const view: DocumentView = { revision: 'r1', rootId: null, blocks: [{ id: 'p1', type: 'paragraph', depth: 0, text: 'x' }] };
    const message = await composeFirstMessage('Fix it', '(Editor context: the user\'s caret is in block p1.)', async () => view);

    expect(message.indexOf(JSON.stringify(view))).toBeLessThan(message.indexOf('(Editor context'));
    expect(message.endsWith('(Editor context: the user\'s caret is in block p1.)')).toBe(true);
  });

  it('says how to read on when the document is longer than the outline', async () => {
    const view: DocumentView = { revision: 'r1', rootId: null, blocks: [], next: 'c:b51' };
    const message = await composeFirstMessage('Fix it', '', async () => view);

    expect(message).toContain('{"cursor":"c:b51"}');
  });

  it('falls back to the prompt and context when the read fails', async () => {
    const message = await composeFirstMessage('Fix it', '(ctx)', async () => {
      throw new Error('closed');
    });

    expect(message).toBe('Fix it\n\n(ctx)');
    expect(await composeFirstMessage('Fix it', '', async () => {
      throw new Error('closed');
    })).toBe('Fix it');
  });
});
