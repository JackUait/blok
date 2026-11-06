// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isObject } from '../../../src/shared/type-guards';
import { invoke } from '../../../src/view/server-runtime';

import type { AgentActor, AgentBatch } from '../../../types/agent';
import type { OutputData } from '../../../types/data-formats/output-data';

const actor: AgentActor = { id: 'agent-jint', name: 'Server agent', kind: 'agent' };
const empty: OutputData = { blocks: [] };
const insertPage = (count = 1): AgentBatch => ({
  commands: Array.from({ length: count }, (_, index) => ({ name: 'block.insert', args: { type: 'page', id: `np${index}`, position: 'end' } })),
});

const wire = async (operation: string, input: unknown): Promise<Record<string, unknown>> => {
  const response: unknown = JSON.parse(await invoke(operation, JSON.stringify(input)));

  if (!isObject(response)) {
    throw new TypeError(`${operation} must return a JSON object.`);
  }

  return response;
};

const pageOf = (output: Record<string, unknown>, id: string): unknown => {
  const document = output.document;
  const blocks = isObject(document) && Array.isArray(document.blocks) ? document.blocks : [];
  const block: unknown = blocks.find((item: unknown) => isObject(item) && item.id === id);

  return isObject(block) && isObject(block.data) ? block.data.pageId : undefined;
};

// What C# sends when its page target can create pages.
const creating = { services: ['pageBackend'], prepares: ['page'] };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('server runtime page creation', () => {
  it('lists page as insertable only when the host creates pages, and says the host is missing otherwise', async () => {
    const pageEntry = async (input: Record<string, unknown>): Promise<unknown> => {
      const output = await wire('manifest', input);
      const contract = isObject(output.contract) ? output.contract : {};
      const manifest = isObject(contract.manifest) ? contract.manifest : {};

      return (Array.isArray(manifest.blocks) ? manifest.blocks : []).find((block: unknown) => isObject(block) && block.name === 'page');
    };

    expect(await pageEntry(creating)).toMatchObject({ insertable: true });
    expect(await pageEntry({ ...creating, runtime: 'csharp-live' })).toMatchObject({ insertable: true });
    expect(await pageEntry({ services: ['pageBackend'] })).toMatchObject({ insertable: false, insertUnavailableReason: 'host' });
    expect(await pageEntry({ services: [], prepares: ['page', 'quiz'] })).toMatchObject({ insertable: true });
  });

  it('counts the pages a batch creates without creating any, and answers a refusal instead', async () => {
    expect(await wire('agentPagesNeeded', { ...creating, document: empty, actor, batch: insertPage(2) })).toEqual({ count: 2 });
    expect(await wire('agentPagesNeeded', { ...creating, document: empty, actor, batch: { commands: [{ name: 'block.delete', args: { id: 'x' } }] } }))
      .toMatchObject({ count: 0, result: { ok: false, error: { code: 'BLOCK_NOT_FOUND' } } });
  });

  it('names the pages a refused batch had already prepared, as Node makes them before the refusal', async () => {
    const badPage = { commands: [{ name: 'block.insert', args: { type: 'page', id: 'np0', data: { title: 'x' } } }] };
    const counted = await wire('agentPagesNeeded', { ...creating, document: empty, actor, batch: badPage });

    expect(counted).toMatchObject({ count: 0, prepared: 1, result: { ok: false, error: { code: 'ORPHANED_SIDE_EFFECT' } } });
    expect(await wire('agentPagesNeeded', { ...creating, document: empty, actor, batch: { commands: [{ name: 'block.delete', args: { id: 'x' } }] } }))
      .not.toHaveProperty('prepared');
    const ran = await wire('agentExecute', { ...creating, document: empty, actor, batch: badPage, createdPages: ['host-a'] });

    expect(ran.result).toMatchObject({
      ok: false,
      error: { code: 'ORPHANED_SIDE_EFFECT', details: { orphaned: [{ command: 'block.insert', type: 'page', prepared: { pageId: 'host-a' } }] } },
    });
  });

  it('points each inserted page at the next page the host created', async () => {
    const output = await wire('agentExecute', { ...creating, document: empty, actor, batch: insertPage(2), createdPages: ['host-a', 'host-b'] });

    expect(output.result).toMatchObject({ ok: true });
    expect(pageOf(output, 'np0')).toBe('host-a');
    expect(pageOf(output, 'np1')).toBe('host-b');
  });

  it('fails closed when the batch needs more pages than the host created', async () => {
    const output = await wire('agentExecute', { ...creating, document: empty, actor, batch: insertPage(2), createdPages: ['host-a'] });

    expect(output.result).toMatchObject({
      ok: false,
      error: { code: 'ORPHANED_SIDE_EFFECT', details: { cause: { code: 'STALE' }, orphaned: [{ prepared: { pageId: 'host-a' } }] } },
    });
  });

  it('reports a created page the batch did not use as orphaned, so the host can clean it up', async () => {
    const output = await wire('agentExecute', { ...creating, document: empty, actor, batch: insertPage(1), createdPages: ['host-a', 'host-b'] });

    expect(output.result).toMatchObject({
      ok: false,
      error: { code: 'ORPHANED_SIDE_EFFECT', details: { cause: { code: 'STALE' } } },
    });
    expect(JSON.stringify(output.result)).toContain('host-b');
  });

  it('fails the page insert the host could not create with the host error, at its command', async () => {
    const refused = { code: 'FORBIDDEN', message: 'You may not create a page document here.', details: { pageId: 'host-x' } };
    const batch: AgentBatch = { commands: [{ name: 'doc.setTitle', args: { title: 'Parent' } }, ...insertPage(1).commands] };
    const output = await wire('agentExecute', { ...creating, document: empty, actor, batch, createPageFailure: { helper: 'surface', error: refused } });

    expect(output.result).toMatchObject({ ok: false, error: { ...refused, retryable: false, commandIndex: 1 } });
    expect(output.document).toEqual(empty);
  });

  it('reports the pages made before the one the host could not create as orphaned', async () => {
    const refused = { code: 'SOURCE_UNAVAILABLE', message: 'The new page id is taken. Try again.', retryable: true, details: { pageId: 'host-x' } };
    const output = await wire('agentExecute', {
      ...creating, document: empty, actor, batch: insertPage(2), createdPages: ['host-a'], createPageFailure: { helper: 'as-is', error: refused },
    });

    expect(output.result).toMatchObject({
      ok: false,
      error: { code: 'ORPHANED_SIDE_EFFECT', details: { cause: refused, orphaned: [{ prepared: { pageId: 'host-a' } }] } },
    });
  });

  it('refuses a page insert where the host creates none, with reason host', async () => {
    const output = await wire('agentExecute', { services: ['pageBackend'], document: empty, actor, batch: insertPage(1) });

    expect(output.result).toMatchObject({ ok: false, error: { code: 'COMMAND_UNAVAILABLE', details: { reason: 'host' } } });
  });
});
