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

  it('reads the caret block by id when it is past the outline, so the model sees more than its id', async () => {
    const blocks = Array.from({ length: 207 }, (_, i) => ({ id: `b${i}`, type: 'paragraph', data: { text: `Line number ${i}` } }));
    const session = openJsonSession({ blocks });

    try {
      const message = await composeFirstMessage('Fix it', '(Editor context: the user\'s caret is in block b120.)', (args) => session.read(args), ['b120']);

      expect(message).toContain('{"ids":["b120"]}');
      expect(message).toContain('"id":"b120"');
      expect(message).toContain('Line number 120');
      expect(message.indexOf('{"ids":["b120"]}')).toBeLessThan(message.indexOf('(Editor context'));
    } finally {
      await session.close();
    }
  });

  it('reads the caret block when a big table fills the outline before it', async () => {
    const ids = Array.from({ length: 10 }, (_, r) => Array.from({ length: 5 }, (_, c) => `r${r}c${c}`));
    const session = openJsonSession({
      blocks: [
        { id: 't', type: 'table', data: { withHeadings: false, content: ids.map((row) => row.map((id) => ({ blocks: [id] }))) }, content: ids.flat() },
        ...ids.flat().map((id) => ({ id, type: 'paragraph', parent: 't', data: { text: id } })),
        { id: 'after', type: 'paragraph', data: { text: 'After the table' } },
      ],
    });

    try {
      const outline = await session.read(OUTLINE_READ);

      expect(outline.blocks.some((block) => block.id === 'after')).toBe(false);

      const message = await composeFirstMessage('Fix it', '', (args) => session.read(args), ['after']);

      expect(message).toContain('{"ids":["after"]}');
      expect(message).toContain('After the table');
    } finally {
      await session.close();
    }
  });

  it('reads nothing more when the caret block is already in the outline', async () => {
    const view: DocumentView = { revision: 'r1', rootId: null, blocks: [{ id: 'p1', type: 'paragraph', depth: 0, text: 'x' }] };
    const read = vi.fn(async () => view);

    await composeFirstMessage('Fix it', '', read, ['p1']);

    expect(read).toHaveBeenCalledTimes(1);
  });

  it('keeps the outline when the caret block cannot be read', async () => {
    const view: DocumentView = { revision: 'r1', rootId: null, blocks: [], next: 'c:b51' };
    const message = await composeFirstMessage('Fix it', '(ctx)', async (args) => {
      if (args.ids !== undefined) {
        throw new Error('gone');
      }

      return view;
    }, ['b99']);

    expect(message).toContain(JSON.stringify(view));
    expect(message.endsWith('(ctx)')).toBe(true);
  });

  it('says what the outline leaves out, so the model reads before answering from cut text', async () => {
    const view: DocumentView = { revision: 'r1', rootId: null, blocks: [] };
    const message = await composeFirstMessage('Fix it', '', async () => view);

    expect(OUTLINE_READ.textLimit).toBe(120);
    expect(message).toContain(`Text is cut at ${OUTLINE_READ.textLimit} characters and has no formatting.`);
    expect(message).toContain('For full text, formatting, table cells or other block data, call blok_read with ids.');
    expect(message).not.toContain('Do not read it again');
  });

  it('still tells the model not to repeat the outline read, which would return the same thing', async () => {
    const view: DocumentView = { revision: 'r1', rootId: null, blocks: [] };
    const message = await composeFirstMessage('Fix it', '', async () => view);

    expect(message).toContain(`read for you with blok_read ${JSON.stringify(OUTLINE_READ)}. Do not repeat that read.`);
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
