// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as McpContractsModule from '../../../src/view/mcp-contracts';

const built = vi.hoisted(() => vi.fn());

vi.mock('../../../src/view/mcp-contracts', async importOriginal => {
  const actual = await importOriginal<typeof McpContractsModule>();

  return {
    ...actual,
    mcpContractFor: (...args: Parameters<typeof actual.mcpContractFor>) => {
      built(...args);

      return actual.mcpContractFor(...args);
    },
  };
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const read = async (mcp: Record<string, unknown> = {}, text = 'First document', actor = 'first-agent'): Promise<string> => {
  const { invoke } = await import('../../../src/view/server-runtime');

  return invoke('agentExecute', JSON.stringify({
    mcp,
    document: { blocks: [{ id: 'p', type: 'paragraph', data: { text } }] },
    actor: { id: actor, name: actor, kind: 'agent' },
    batch: { commands: [{ name: 'doc.read', args: {} }] },
  }));
};

describe('server runtime reusable MCP setup', () => {
  it('reuses a normalized setup across separately parsed calls without retaining document or actor state', async () => {
    await read({ source: true, comments: true }, 'First private text', 'alice');
    const second = await read({ source: true, pageTitles: 'off', write: false, documentId: 'other' }, 'Second private text', 'bob');

    expect(built).toHaveBeenCalledTimes(1);
    expect(second).toContain('Second private text');
    expect(second).not.toContain('First private text');
    expect(second).not.toContain('alice');
  });

  it('isolates every setup-affecting option while reusing equivalent object key orders', async () => {
    const variants: Array<Record<string, unknown>> = [
      {}, { sync: true }, { source: true }, { uploads: true }, { comments: false },
      { pageTitles: 'page-map' }, { mode: 'live' },
      { overrides: { paragraph: { guidance: 'A' } } },
      { overrides: { paragraph: { guidance: 'B' } } },
      { richTextFields: { custom: ['body'] } },
      { richTextFields: { custom: ['caption'] } },
      { manifest: { formatVersion: 1, blocks: [] } },
    ];

    for (const options of variants) {
      await read(options);
    }
    expect(built).toHaveBeenCalledTimes(variants.length);

    await read({ overrides: { paragraph: { guidance: 'A' } }, write: true });
    expect(built).toHaveBeenCalledTimes(variants.length);

    await read({ richTextFields: { beta: ['body'], alpha: ['caption'] } });
    await read({ richTextFields: { alpha: ['caption'], beta: ['body'] } });
    expect(built).toHaveBeenCalledTimes(variants.length + 1);
  });

  it('enforces each caller write permission and attribution after warming the same setup', async () => {
    const { invoke } = await import('../../../src/view/server-runtime');
    const document = { blocks: [] };
    interface WriteAnswer {
      result: { ok: boolean; error?: { code: string } };
      document: { blocks: Array<{ createdBy?: string; lastEditedBy?: string }> };
      save: boolean;
    }
    const write = async (actor: string, allowed: boolean): Promise<WriteAnswer> => JSON.parse(await invoke('agentExecute', JSON.stringify({
      mcp: { source: true, write: allowed },
      document,
      actor: { id: actor, name: actor, kind: 'agent' },
      batch: { commands: [{ name: 'block.insert', args: { id: 'new', type: 'paragraph', data: { text: 'Added' } } }] },
    }))) as WriteAnswer;

    const first = await write('alice', true);
    const refused = await write('bob', false);
    const second = await write('bob', true);

    expect(refused.result).toMatchObject({ ok: false, error: { code: 'READ_ONLY' } });
    expect(refused.document).toEqual(document);
    expect(refused.save).toBe(false);
    expect(first.result.ok).toBe(true);
    expect(second.result.ok).toBe(true);
    expect(first.document.blocks[0]).toMatchObject({ createdBy: 'alice', lastEditedBy: 'alice' });
    expect(second.document.blocks[0]).toMatchObject({ createdBy: 'bob', lastEditedBy: 'bob' });
    expect(built).toHaveBeenCalledTimes(1);
  });

  it('evicts the least recently used setup after sixteen configurations', async () => {
    const config = (index: number): Record<string, unknown> => ({ overrides: { paragraph: { guidance: `Configuration ${index}` } } });

    for (let index = 0; index < 16; index++) {
      await read(config(index));
    }
    await read(config(0));
    expect(built).toHaveBeenCalledTimes(16);

    await read(config(16));
    await read(config(0));
    expect(built).toHaveBeenCalledTimes(17);

    await read(config(1));
    expect(built).toHaveBeenCalledTimes(18);
  });
});
