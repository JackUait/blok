// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openJsonSession, openStoreSession } from '../../agent/harness';
import type { AgentResult, AgentSession, ViewBlock } from '../../../../types/agent';
import type { OutputData } from '../../../../types';

const seed: OutputData = {
  blocks: [
    { id: 'p1', type: 'paragraph', data: { text: [{ text: 'Notes' }] } },
    { id: 'p2', type: 'paragraph', data: { text: [{ text: 'Old' }] } },
    { id: 'p3', type: 'paragraph', data: { text: [{ text: 'Gone' }] } },
  ],
};

const blocksOf = (result: AgentResult): ViewBlock[] | undefined => (result.ok ? result.blocks : undefined);

const sessions: Array<[string, (doc: OutputData) => AgentSession]> = [
  ['stored JSON session', (doc) => openJsonSession(doc)],
  ['live store session', (doc) => openStoreSession(doc)],
];

describe.each(sessions)('blok_execute result on a %s', (_name, open) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows each created, updated and moved block, with its data, as reading those ids right after would', async () => {
    const session = open(seed);

    try {
      const result = await session.execute({
        commands: [
          { name: 'markdown.insert', args: { position: { after: 'p1' }, markdown: '## Plan\n\n- One\n- Two' } },
          { name: 'text.replace', args: { id: 'p2', range: 'all', with: 'New' } },
          { name: 'block.delete', args: { id: 'p3' } },
        ],
      });

      expect(result.ok, JSON.stringify(result)).toBe(true);
      const changed = result.ok ? [...result.changed.created, ...result.changed.updated, ...result.changed.moved] : [];
      const full = await session.read({ ids: changed });

      expect(blocksOf(result)).toEqual(full.blocks);
      expect(blocksOf(result)?.map((block) => block.text)).toEqual(['Plan', 'One', 'Two', 'New']);
    } finally {
      await session.close();
    }
  });

  it('shows the first 50 changed blocks and counts the rest, so a bulk edit does not flood the result', async () => {
    const session = open(seed);

    try {
      const commands = Array.from({ length: 52 }, (_, index) => (
        { name: 'block.insert' as const, args: { type: 'paragraph', data: { text: `Row ${index}` }, position: 'end' } }
      ));
      const result = await session.execute({ commands });

      expect(result.ok, JSON.stringify(result).slice(0, 300)).toBe(true);
      expect(blocksOf(result)?.map((block) => block.text)).toEqual(Array.from({ length: 50 }, (_, index) => `Row ${index}`));
      expect(result.ok && result.moreBlocks).toBe(2);
    } finally {
      await session.close();
    }
  });

  it('leaves blocks out when nothing in the document changed', async () => {
    const session = open(seed);

    try {
      const result = await session.execute({ commands: [{ name: 'doc.find', args: { text: 'Old' } }] });

      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect(blocksOf(result)).toBeUndefined();
    } finally {
      await session.close();
    }
  });
});
