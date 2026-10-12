// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { plannerContextFrom } from '../../../../src/shared/agent/context';
import { planHostBatch } from '../../../../src/shared/agent/executor';
import { contentRevision } from '../../../../src/shared/agent/revision';
import { DocSnapshot } from '../../../../src/shared/agent/snapshot';
import { validateAgainst } from '../../../../src/shared/schema/validate';
import { createHeadlessAgentSetup, loadStoredDocument } from '../../../../src/view/agent-runtime';

import type { AgentApplier } from '../../../../src/shared/agent/executor';
import type { OutputData } from '../../../../types/data-formats/output-data';

const actor = { id: 'agent-cs', name: 'Server agent', kind: 'agent' as const };
const document: OutputData = {
  id: 'source', title: 'Source title',
  blocks: [{ id: 'pg', type: 'page', data: { pageId: 'page-2' } }],
};
const rename = { name: 'page.rename', args: { id: 'pg', title: 'Roadmap' } };

const fixture = (source = document, services: Array<'pageBackend'> = ['pageBackend']) => {
  const setup = createHeadlessAgentSetup({ runtime: 'jint', services });
  const snapshot = DocSnapshot.fromOutput(loadStoredDocument(source, setup.richTextFieldsFor));
  const revision = contentRevision(snapshot.toOutput());
  const backend = { rename: vi.fn(), setIcon: vi.fn() };
  const ctx = plannerContextFrom(setup.contract, setup.tools, setup.ports, validateAgainst, { pageBackend: backend });
  const page = setup.tools.get('page');
  const handler = page?.actions.rename;

  if (handler === undefined || handler.prepare === undefined) {
    throw new Error('The actual page action must have a prepare dependency.');
  }
  const prepare = vi.spyOn(handler, 'prepare');
  const run = vi.spyOn(handler, 'run');
  const apply = vi.fn<AgentApplier['apply']>();
  const applier: AgentApplier = {
    runtime: 'jint', isReadOnly: () => false,
    snapshot: () => snapshot, revision: () => revision, apply,
  };

  return {
    ctx, applier, actor, now: () => 1234,
    snapshot, revision, backend, prepare, run, apply,
  };
};

describe('host plan before outside-runtime effects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the actual pending source plan without prepare, run, apply or backend effects', async () => {
    const source = fixture();
    const batch = { commands: [rename], expectRevision: source.revision };
    const before = source.snapshot.toOutput();
    const output = await planHostBatch({ ...source, batch });

    expect(source.apply).not.toHaveBeenCalled();
    expect(source.prepare).not.toHaveBeenCalled();
    expect(source.run).not.toHaveBeenCalled();
    expect(source.backend.rename).not.toHaveBeenCalled();
    expect(source.backend.setIcon).not.toHaveBeenCalled();
    expect(output.result).toEqual({
      ok: true, revision: source.revision, results: [{}], refs: {},
      changed: { created: [], updated: [], moved: [], removed: [] }, warnings: [],
    });
    if (!('plan' in output)) {
      throw new Error('A successful host plan must carry the actual plan.');
    }
    expect(output.plan).toEqual({
      edits: [], results: [{}], refs: {},
      changed: { created: [], updated: [], moved: [], removed: [] },
      warnings: [], touched: new Set(),
    });
    expect(output.batch).toEqual(batch);
    expect(output.snapshot.toOutput()).toEqual(before);
    expect(source.snapshot.toOutput()).toEqual(before);
  });

  it.each([
    { batch: { expectRevision: 1, commands: [rename] }, path: '/expectRevision', code: 'INVALID_ARGS' },
    { batch: { commands: [{ ...rename, ref: 1 }] }, path: '/commands/0', code: 'INVALID_ARGS' },
    { batch: { commands: [{ ...rename, ref: 'created' }] }, path: '/commands/0/ref', code: 'INVALID_ARGS' },
    { batch: { commands: [{ name: 'page.rename', args: { id: 'pg', title: 7 } }] }, path: '/commands/0/args/title', code: 'INVALID_ARGS' },
    { batch: { commands: [{ ...rename, args: { ...rename.args, id: 'missing' } }] }, path: '/commands/0/args/id', code: 'BLOCK_NOT_FOUND' },
    { batch: { commands: [rename, { name: 'doc.setTitle', args: { title: 'Never written' } }] }, path: '/commands/0/name', code: 'INVALID_ARGS' },
  ])('retains the original source validation for $path / $code', async ({ batch, path, code }) => {
    const source = fixture();
    const output = await planHostBatch({ ...source, batch });

    expect(output.result).toMatchObject({
      ok: false, revision: source.revision, error: { code, path, retryable: false }, warnings: [],
    });
    expect(output).not.toHaveProperty('plan');
    expect(source.apply).not.toHaveBeenCalled();
    expect(source.prepare).not.toHaveBeenCalled();
    expect(source.run).not.toHaveBeenCalled();
    expect(source.backend.rename).not.toHaveBeenCalled();
    expect(source.backend.setIcon).not.toHaveBeenCalled();
  });

  it('returns the shared stale source context before any effect', async () => {
    const source = fixture();
    const output = await planHostBatch({
      ...source, batch: { commands: [rename], expectRevision: 'not-the-source-revision' },
    });

    expect(output.result).toEqual({
      ok: false, revision: source.revision,
      error: {
        code: 'STALE', message: 'The document changed since you read it. Read it again, then retry.',
        retryable: true, details: { revision: source.revision, current: [{ id: 'pg', type: 'page' }] },
      }, warnings: [],
    });
    expect(source.apply).not.toHaveBeenCalled();
    expect(source.prepare).not.toHaveBeenCalled();
    expect(source.backend.rename).not.toHaveBeenCalled();
    expect(source.backend.setIcon).not.toHaveBeenCalled();
  });

  it('checks availability from the actual source contract', async () => {
    const source = fixture(document, []);
    const output = await planHostBatch({ ...source, batch: { commands: [rename] } });

    expect(output.result).toMatchObject({
      ok: false, revision: source.revision,
      error: {
        code: 'COMMAND_UNAVAILABLE', commandIndex: 0, path: '/commands/0/name',
        details: { reason: 'service', requires: ['pageBackend'] },
      }, warnings: [],
    });
    expect(source.apply).not.toHaveBeenCalled();
    expect(source.prepare).not.toHaveBeenCalled();
    expect(source.backend.rename).not.toHaveBeenCalled();
  });

  it('checks the source tool before exposing a pending plan', async () => {
    const source = fixture({ blocks: [{ id: 'pg', type: 'paragraph', data: { text: [], pageId: 'page-2' } }] });
    const output = await planHostBatch({ ...source, batch: { commands: [rename] } });

    expect(output.result).toMatchObject({
      ok: false, revision: source.revision,
      error: { code: 'INVALID_ARGS', commandIndex: 0, path: '/commands/0/args/id' }, warnings: [],
    });
    expect(source.apply).not.toHaveBeenCalled();
    expect(source.prepare).not.toHaveBeenCalled();
    expect(source.backend.rename).not.toHaveBeenCalled();
  });

  it('refuses a read-only source before prepare, run, apply or backend effects', async () => {
    const source = fixture();
    const before = source.snapshot.toOutput();
    const output = await planHostBatch({
      ...source,
      applier: { ...source.applier, isReadOnly: () => true },
      batch: { commands: [rename] },
    });

    expect(output.result).toEqual({
      ok: false, revision: source.revision,
      error: {
        code: 'READ_ONLY', message: 'The document is read-only now. Reads still work.', retryable: false,
      },
      warnings: [],
    });
    expect(output).not.toHaveProperty('plan');
    expect(source.prepare).not.toHaveBeenCalled();
    expect(source.run).not.toHaveBeenCalled();
    expect(source.apply).not.toHaveBeenCalled();
    expect(source.backend.rename).not.toHaveBeenCalled();
    expect(source.backend.setIcon).not.toHaveBeenCalled();
    expect(source.snapshot.toOutput()).toEqual(before);
  });
});
