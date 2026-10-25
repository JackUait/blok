// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COMMANDS } from '../../../../src/shared/agent/commands';
import { BUILT_IN_INLINE_DESCRIPTIONS } from '../../../../src/shared/tool-descriptions/inline';
import { openJsonSession } from '../../agent/harness';

import type { OutputData } from '../../../../types';

const seed: OutputData = { blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'Hello world' }] } }] };

const textOf = async (session: ReturnType<typeof openJsonSession>, id: string): Promise<unknown> =>
  (await session.read({ ids: [id], detail: 'full' })).blocks.find(block => block.id === id)?.data?.text;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('what the model is told about inline formats is true', () => {
  it('tells the model that unset removes a mark and "tag:*" clears custom marks', () => {
    const unset = JSON.stringify(COMMANDS['text.format'].argsSchema);

    expect(unset).toContain('tag:*');
    expect(unset).toMatch(/remove a mark/i);
  });

  it('refuses false in text.format set, so the model is pointed at unset instead', async () => {
    const session = openJsonSession(seed);

    try {
      const result = await session.execute({ commands: [{ name: 'text.format', args: { id: 'p', range: { find: 'world' }, set: { bold: false } } }] });

      expect(result.ok).toBe(false);
    } finally {
      await session.close();
    }
  });

  it('does not promise any CSS colour on the marker, because oklch is dropped', async () => {
    const summary = BUILT_IN_INLINE_DESCRIPTIONS.marker().summary;

    expect(summary).not.toMatch(/any CSS colou?r/i);

    const session = openJsonSession(seed);

    try {
      await session.execute({ commands: [{ name: 'text.format', args: { id: 'p', range: { find: 'world' }, set: { color: 'oklch(0.6 0.2 30)' } } }] });

      expect(await textOf(session, 'p')).toEqual([{ text: 'Hello world' }]);
    } finally {
      await session.close();
    }
  });
});

describe('what the model is told about find and replace is true', () => {
  it('says plain text keeps the marks where the range starts, and it does', async () => {
    expect(COMMANDS['text.replace'].summary).toMatch(/Plain text takes the marks/);

    const session = openJsonSession({ blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'Hello ' }, { text: 'world', marks: { bold: true } }] } }] });

    try {
      await session.execute({ commands: [{ name: 'text.replace', args: { id: 'p', range: { find: 'world' }, with: 'there' } }] });

      expect(await textOf(session, 'p')).toEqual([{ text: 'Hello ' }, { text: 'there', marks: { bold: true } }]);
    } finally {
      await session.close();
    }
  });

  it('says a find folds case unless matchCase, and replace-all is one pass, and both hold', async () => {
    expect(COMMANDS['text.replace'].guidance).toMatch(/case.*fold.*unless matchCase/);
    expect(COMMANDS['text.replace'].guidance).toContain('all: true');

    const session = openJsonSession({ blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'Cat cat' }] } }] });

    try {
      await session.execute({ commands: [{ name: 'text.replace', args: { id: 'p', range: { find: 'cat', all: true }, with: 'concat' } }] });

      expect(await textOf(session, 'p')).toEqual([{ text: 'concat concat' }]);
    } finally {
      await session.close();
    }
  });
});
