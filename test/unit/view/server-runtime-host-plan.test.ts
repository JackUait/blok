// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PAGE_ACTION_HANDLERS } from '../../../src/shared/tool-actions/page';
import { isObject } from '../../../src/shared/type-guards';
import { invoke } from '../../../src/view/server-runtime';

const actor = { id: 'agent-cs', name: 'Server agent', kind: 'agent' };
const document = {
  id: 'source',
  title: 'Source title',
  blocks: [{ id: 'pg', type: 'page', data: { pageId: 'page-2' } }],
};
const rename = { name: 'page.rename', args: { id: 'pg', title: 'Roadmap' } };
const plan = async (batch: unknown, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
  const output: unknown = JSON.parse(await invoke('agentPlanHost', JSON.stringify({
    document, actor, batch, services: ['pageBackend'], ...extra,
  })));

  if (!isObject(output)) {
    throw new TypeError('The host plan must be a record.');
  }

  return output;
};
const sourceRevision = async (): Promise<string> => {
  const output: unknown = JSON.parse(await invoke('agentExecute', JSON.stringify({
    document, actor, batch: { commands: [{ name: 'doc.read', args: { detail: 'full' } }] },
  })));

  if (!isObject(output) || !isObject(output.result) || typeof output.result.revision !== 'string') {
    throw new TypeError('A source read must return its revision.');
  }

  return output.result.revision;
};

describe('server runtime host planning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a real pending plan and source view without preparing or running the host action', async () => {
    const handler = PAGE_ACTION_HANDLERS.rename;

    if (handler === undefined || handler.prepare === undefined) {
      throw new Error('The installed page rename handler needs prepare.');
    }
    const prepare = vi.spyOn(handler, 'prepare');
    const run = vi.spyOn(handler, 'run');
    const revision = await sourceRevision();
    const pending = plan({ commands: [rename], expectRevision: revision });

    await expect(pending).resolves.toMatchObject({
      plan: { edits: [], results: [{}], refs: {}, warnings: [], touched: [] },
      result: { ok: true, revision, results: [{}], refs: {}, warnings: [] },
    });
    const output = await pending;

    expect(output.plan).toEqual({
      edits: [], results: [{}], refs: {},
      changed: { created: [], updated: [], moved: [], removed: [] },
      warnings: [], touched: [],
    });
    expect(output.result).toEqual({
      ok: true, revision, results: [{}], refs: {},
      changed: { created: [], updated: [], moved: [], removed: [] },
      warnings: [],
    });
    expect(output.view).toEqual({
      revision, rootId: null, page: { title: 'Source title' },
      blocks: [{ id: 'pg', type: 'page', depth: 0, attrs: { pageId: 'page-2' }, data: { pageId: 'page-2' } }],
    });
    expect(output.batch).toEqual({ commands: [rename], expectRevision: revision });
    expect(output).not.toHaveProperty('document');
    expect(prepare).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    { icon: { type: 'emoji', value: '🚀', hostMetadata: { keep: 'icon' } } },
    { icon: { type: 'image', url: 'https://example.com/icon.png' } },
    { icon: null },
  ])('keeps the original icon value for the outside-Jint target command: $icon', async ({ icon }) => {
    const batch = { commands: [{ name: 'page.setIcon', args: { id: 'pg', icon } }] };
    const output = await plan(batch);

    expect(output.batch).toEqual(batch);
    expect(output.result).toMatchObject({ ok: true, revision: await sourceRevision(), results: [{}] });
    expect(output.plan).toMatchObject({ edits: [] });
  });

  it.each([
    { batch: { expectRevision: 1, commands: [rename] }, path: '/expectRevision' },
    { batch: { commands: [{ ...rename, ref: 1 }] }, path: '/commands/0' },
    { batch: { commands: [{ ...rename, ref: 'created' }] }, path: '/commands/0/ref' },
    { batch: { commands: [{ name: 'page.rename', args: { id: 'pg', title: 7 } }] }, path: '/commands/0/args/title' },
    { batch: { commands: [rename, { name: 'doc.setTitle', args: { title: 'Never written' } }] }, path: '/commands/0/name' },
    { batch: { commands: null }, path: '/commands' },
  ])('returns the shared source INVALID_ARGS for $path without a plan', async ({ batch, path }) => {
    const output = await plan(batch);

    expect(output.result).toMatchObject({
      ok: false, revision: await sourceRevision(),
      error: { code: 'INVALID_ARGS', path, retryable: false }, warnings: [],
    });
    expect(output).not.toHaveProperty('plan');
    expect(output).not.toHaveProperty('view');
    expect(output).not.toHaveProperty('document');
  });

  it('returns the source stale context before producing a host plan', async () => {
    const revision = await sourceRevision();
    const output = await plan({ commands: [rename], expectRevision: 'not-the-source-revision' });

    expect(output.result).toEqual({
      ok: false, revision,
      error: {
        code: 'STALE', message: 'The document changed since you read it. Read it again, then retry.',
        retryable: true, details: { revision, current: [{ id: 'pg', type: 'page' }] },
      },
      warnings: [],
    });
    expect(output).not.toHaveProperty('plan');
  });

  it('uses the source contract service availability', async () => {
    const output = await plan({ commands: [rename] }, { services: [] });

    expect(output.result).toMatchObject({
      ok: false, revision: await sourceRevision(),
      error: {
        code: 'COMMAND_UNAVAILABLE', commandIndex: 0, path: '/commands/0/name',
        details: { reason: 'service', requires: ['pageBackend'] },
      },
    });
    expect(output).not.toHaveProperty('plan');
  });

  it.each([{ page: { hidden: true } }, { page: { hiddenActions: ['rename'] } }])(
    'honors the original source override before a plan is exposed',
    async overrides => {
      const output = await plan({ commands: [rename] }, { overrides });

      expect(output.result).toMatchObject({
        ok: false, revision: await sourceRevision(),
        error: { code: 'UNKNOWN_COMMAND', commandIndex: 0, path: '/commands/0/name' },
      });
      expect(output).not.toHaveProperty('plan');
    }
  );

  it.each([
    { source: { blocks: [] }, code: 'BLOCK_NOT_FOUND' },
    { source: { blocks: [{ id: 'pg', type: 'paragraph', data: { text: [], pageId: 'page-2' } }] }, code: 'INVALID_ARGS' },
  ])('validates the source action block through the real planner: $code', async ({ source, code }) => {
    const output = await plan({ commands: [rename] }, { document: source });

    expect(output.result).toMatchObject({
      ok: false,
      error: { code, commandIndex: 0, path: '/commands/0/args/id' },
      warnings: [],
    });
    expect(output).not.toHaveProperty('plan');
    expect(output).not.toHaveProperty('document');
  });

  it('refuses a document edit at the host-only planning boundary', async () => {
    const output = await plan({ commands: [{ name: 'doc.setTitle', args: { title: 'Never written' } }] });

    expect(output.result).toMatchObject({
      ok: false, revision: await sourceRevision(),
      error: { code: 'INVALID_ARGS', commandIndex: 0, path: '/commands/0/name' }, warnings: [],
    });
    expect(output).not.toHaveProperty('plan');
    expect(output).not.toHaveProperty('document');
  });

  it('selects the addressed page after more than 200 preceding blocks', async () => {
    const source = {
      id: 'long-source', title: 'Long source',
      blocks: [
        ...Array.from({ length: 201 }, (_, index) => ({
          id: `before-${index}`, type: 'paragraph', data: { text: [{ text: `Before ${index}` }] },
        })),
        { id: 'late-page', type: 'page', data: { pageId: 'page-late' } },
      ],
    };
    const read: unknown = JSON.parse(await invoke('agentExecute', JSON.stringify({
      document: source, actor,
      batch: { commands: [{ name: 'doc.read', args: { ids: ['late-page'], detail: 'full' } }] },
    })));

    if (!isObject(read) || !isObject(read.result) || typeof read.result.revision !== 'string') {
      throw new TypeError('The selected source read must return its revision.');
    }
    const revision = read.result.revision;
    const batch = {
      commands: [{ name: 'page.rename', args: { id: 'late-page', title: 'New late title' } }],
      expectRevision: revision,
    };
    const pending = plan(batch, { document: source });

    await expect(pending).resolves.toMatchObject({
      result: { ok: true, revision },
      view: { revision, blocks: [{ id: 'late-page', type: 'page', data: { pageId: 'page-late' } }] },
    });
    const output = await pending;

    expect(output.view).toEqual({
      revision, rootId: null, page: { title: 'Long source' },
      blocks: [{
        id: 'late-page', type: 'page', depth: 0,
        attrs: { pageId: 'page-late' }, data: { pageId: 'page-late' },
      }],
    });
    expect(output.batch).toEqual(batch);
    expect(output).not.toHaveProperty('document');
  });
});
