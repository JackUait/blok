// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openJsonSession, openStoreSession } from './harness';

import type { AgentBatch, AgentResult, AgentSession, OutputData } from '../../../types';

const WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const CHANNEL = 'https://www.youtube.com/@PewDiePie';

const sessions: Array<[string, (seed: OutputData) => AgentSession]> = [
  ['json', seed => openJsonSession(seed)],
  ['store', seed => openStoreSession(seed)],
];

const run = (session: AgentSession, name: string, args: Record<string, unknown>): Promise<AgentResult> =>
  session.execute({ commands: [{ name, args }] } as AgentBatch);

const embedData = (result: AgentResult): Record<string, unknown> | undefined => {
  if (!result.ok) {
    return undefined;
  }
  const block = result.blocks?.find(candidate => candidate.type === 'embed');

  return block?.data;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(sessions)('agent embed writes (%s session)', (_label, open) => {
  it('refuses an embed inserted with no source, so no empty embed lands in the doc', async () => {
    const session = open({ blocks: [] });
    const result = await run(session, 'block.insert', { type: 'embed', data: { service: '', source: '', embed: '' } });

    expect(result.ok).toBe(false);
    expect((await session.read()).blocks).toEqual([]);
    await session.close();
  });

  it('refuses a provider page the registry cannot embed and points to a bookmark', async () => {
    const session = open({ blocks: [] });
    const result = await run(session, 'block.insert', {
      type: 'embed', data: { service: 'youtube', source: CHANNEL, embed: 'https://www.youtube.com/embed/x' },
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error.message).toContain('bookmark');
    expect((await session.read()).blocks).toEqual([]);
    await session.close();
  });

  it('derives service and embed from the source instead of trusting the model', async () => {
    const session = open({ blocks: [] });
    const result = await run(session, 'block.insert', {
      type: 'embed', data: { service: 'vimeo', source: WATCH, embed: 'https://evil.example/frame' },
    });

    expect(embedData(result)).toMatchObject({ service: 'youtube', source: WATCH, embed: 'https://www.youtube.com/embed/dQw4w9WgXcQ' });
    await session.close();
  });

  it('refuses an update that points a working embed at a page the registry cannot embed', async () => {
    const session = open({ blocks: [
      { id: 'e', type: 'embed', data: { service: 'youtube', source: WATCH, embed: 'https://www.youtube.com/embed/dQw4w9WgXcQ' } },
    ] });
    const result = await run(session, 'block.update', { id: 'e', data: { source: CHANNEL } });

    expect(result.ok).toBe(false);
    await session.close();
  });

  it('creates a working embed from a URL in one step', async () => {
    const session = open({ blocks: [] });
    const result = await run(session, 'embed.create', { url: WATCH });

    expect(embedData(result)).toMatchObject({ service: 'youtube', source: WATCH, embed: 'https://www.youtube.com/embed/dQw4w9WgXcQ', kind: 'iframe' });
    await session.close();
  });

  it('refuses to create an embed from a URL no provider knows', async () => {
    const session = open({ blocks: [] });
    const result = await run(session, 'embed.create', { url: CHANNEL });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error.message).toContain('bookmark');
    expect((await session.read()).blocks).toEqual([]);
    await session.close();
  });
});
