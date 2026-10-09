// @vitest-environment node
// Install under test/unit/shared/agent; imports target that location.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMANDS } from '../../../../src/shared/agent/commands';
import { plannerContextFrom } from '../../../../src/shared/agent/context';
import { describeContract } from '../../../../src/shared/agent/describe';
import { createDocumentAgentSession, createPageMapBackend } from '../../../../src/shared/agent/document-session';
import { AgentFailure, failure } from '../../../../src/shared/agent/errors';
import { planBatch } from '../../../../src/shared/agent/planner';
import { contentRevision, canonicalJson } from '../../../../src/shared/agent/revision';
import { richTextHelpers } from '../../../../src/shared/agent/rich-text-ops';
import { DocSnapshot } from '../../../../src/shared/agent/snapshot';
import { validateAgainst } from '../../../../src/shared/schema/validate';
import { buildToolRuntimes } from '../../../../src/shared/tool-actions/runtime';
import { PAGE_DATA, PAGE_ICON_SCHEMA } from '../../../../src/shared/tool-descriptions/page';
import { buildAgentContract } from '../../../../src/shared/tool-manifest';
import { stubPorts } from './fixtures';

import type { AgentPorts } from '../../../../src/shared/agent/types';
import type { PageBackendService } from '../../../../src/shared/tool-actions/services';
import type { AgentActor, AgentBatch, AgentResult, AgentSession } from '../../../../types/agent';
import type { OutputData } from '../../../../types/data-formats/output-data';
import type { BlokToolManifest, BlockToolManifestEntry, CommandEntry } from '../../../../types/tool-manifest';
import type { HostService, ToolActionImpl } from '../../../../types/tools/tool-description';
import type { PageIcon } from '../../../../types/tools/page';

type StoredSession = AgentSession & { output(): OutputData };
type SessionInput = Parameters<typeof createDocumentAgentSession>[0];
type SessionOptions = Partial<Pick<SessionInput, 'contract' | 'ports' | 'services' | 'pageTitles' | 'validate' | 'runtime'>>;
type OpenPage = NonNullable<AgentPorts['openPageDocument']>;

const actor: AgentActor = { id: 'agent-1', name: 'Agent', kind: 'agent', onBehalfOf: 'owner' };
const icon: PageIcon = { type: 'emoji', value: 'P' };
const guidance = 'Use segments, never Markdown.';
const initial = (): OutputData => ({
  id: 'doc-1', version: 'fixture', time: 7, title: 'Original', icon,
  blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] }, lastEditedBy: 'owner', lastEditedAt: 1 }],
});
const sourceDocument = (): OutputData => ({
  blocks: [{ id: 'pb', type: 'page', data: { pageId: 'pg-1' } }],
});
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isPageIcon = (value: unknown): value is PageIcon => isRecord(value) && (
  (value.type === 'emoji' && typeof value.value === 'string') ||
  (value.type === 'image' && typeof value.url === 'string')
);
const isPageBackend = (value: unknown): value is PageBackendService =>
  isRecord(value) && typeof value.rename === 'function' && typeof value.setIcon === 'function';
const thrownFailure = (read: () => unknown): AgentFailure => {
  try {
    read();
  } catch (error) {
    if (error instanceof AgentFailure) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected an AgentFailure.');
};

const observePageBackend = vi.fn<NonNullable<ToolActionImpl['prepare']>>(async ({ services }) => ({
  hasBackend: services.pageBackend !== undefined,
}));

// These service consumers are fixtures, not the future built-in page actions.
const pageActions: Readonly<Record<string, ToolActionImpl>> = {
  observeBackend: {
    prepare: observePageBackend,
    run: (_ctx, _args, prepared) => prepared,
  },
  rename: {
    prepare: async ({ services }, args) => {
      if (!isRecord(args) || typeof args.id !== 'string' || typeof args.title !== 'string') {
        throw failure('INVALID_ARGS', 'Expected a block id and title.');
      }
      if (!isPageBackend(services.pageBackend)) {
        throw failure('COMMAND_UNAVAILABLE', 'The page backend is absent.');
      }

      return services.pageBackend.rename({ blockId: args.id, title: args.title });
    },
    run: (_ctx, _args, prepared) => prepared,
  },
  setIcon: {
    prepare: async ({ services }, args) => {
      if (!isRecord(args) || typeof args.id !== 'string' || (args.icon !== null && !isPageIcon(args.icon))) {
        throw failure('INVALID_ARGS', 'Expected a block id and icon.');
      }
      if (!isPageBackend(services.pageBackend)) {
        throw failure('COMMAND_UNAVAILABLE', 'The page backend is absent.');
      }

      return services.pageBackend.setIcon({ blockId: args.id, icon: args.icon });
    },
    run: (_ctx, _args, prepared) => prepared,
  },
};

const manifestBlock = (name: string, data: BlockToolManifestEntry['data'], richTextFields: string[] = []): BlockToolManifestEntry => ({
  name, title: name, summary: `${name} block`, level: 'described', insertable: true,
  variants: [], data, richTextFields, viewState: [], guardedFields: {},
  children: { accepts: true, ownedByTool: false, layout: false, deletedWithParent: false },
  selfPlacesChildren: false, restrictedInTableCell: false,
  convertsTo: [], conversion: {}, inlineTools: [], tunes: [], actions: [],
});
const manifest: BlokToolManifest = {
  formatVersion: 1, blokVersion: 'fixture', revision: 'manifest-1', readOnly: false, defaultBlock: 'paragraph',
  inlineTools: [], tunes: [],
  blocks: [
    manifestBlock('paragraph', { type: 'object', properties: { text: { type: 'array' } }, additionalProperties: false }, ['text']),
    { ...manifestBlock('header', {
      type: 'object', properties: { text: { type: 'array' }, level: { type: 'integer', minimum: 1, maximum: 6 } },
      additionalProperties: false,
    }, ['text']), summaryFields: ['level'] },
    {
      ...manifestBlock('page', PAGE_DATA),
      children: { accepts: false, ownedByTool: false, layout: false, deletedWithParent: false },
      actions: [
        {
          name: 'observeBackend', command: 'page.observeBackend', summary: 'Observe the session backend.', target: 'block',
          runtime: 'any', available: true, args: { type: 'object', properties: {}, additionalProperties: false },
        },
        {
          name: 'rename', command: 'page.rename', summary: 'Rename the target page.', target: 'block', runtime: 'any',
          effects: 'host', requires: ['pageBackend'], available: true,
          args: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'], additionalProperties: false },
        },
        {
          name: 'setIcon', command: 'page.setIcon', summary: 'Set the target page icon.', target: 'block', runtime: 'any',
          effects: 'host', requires: ['pageBackend'], available: true,
          args: { type: 'object', properties: { icon: { oneOf: [PAGE_ICON_SCHEMA, { type: 'null' }] } }, required: ['icon'], additionalProperties: false },
        },
      ],
    },
  ],
};
const runtimes = buildToolRuntimes([
  { name: 'paragraph', ownSanitize: {}, inlineSanitize: [] },
  { name: 'header', ownSanitize: {}, inlineSanitize: [] },
  { name: 'page', ownSanitize: {}, inlineSanitize: [], actions: pageActions },
]);
const contractFor = (runtime: 'node' | 'jint' = 'node', services: HostService[] = []) =>
  buildAgentContract(manifest, COMMANDS, { runtime, services }, guidance);
const open = (document: OutputData = initial(), options: SessionOptions = {}): StoredSession =>
  createDocumentAgentSession({ document, tools: runtimes, contract: contractFor(), actor, ports: stubPorts(), ...options });
const sessions: StoredSession[] = [];
const track = (session: StoredSession): StoredSession => {
  sessions.push(session);

  return session;
};
const targetPort = (target: StoredSession) => {
  const closes: Array<() => void> = [];
  const openPage = vi.fn<OpenPage>(async () => {
    const close = vi.fn<() => void>();

    closes.push(close);

    return {
      id: target.id, actor: target.actor,
      read: args => target.read(args),
      describe: query => target.describe(query),
      execute: (batch, options) => target.execute(batch, options),
      log: () => target.log(),
      close,
    };
  });

  return { closes, openPage };
};
const expectClosedHandles = (closes: ReadonlyArray<() => void>, count: number): void => {
  expect(closes).toHaveLength(count);
  closes.forEach(close => expect(close).toHaveBeenCalledTimes(1));
};

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  sessions.splice(0).forEach(session => session.close());
  vi.restoreAllMocks();
});

describe('stored document session', () => {
  it('canonicalizes nested keys without reordering arrays', () => {
    expect(canonicalJson({ z: [{ b: 2, a: 1 }, null], a: { y: true, x: 'P', omitted: undefined } }))
      .toBe('{"a":{"x":"P","y":true},"z":[{"a":1,"b":2},null]}');
    expect(canonicalJson([2, 1])).toBe('[2,1]');
  });

  it('hashes canonical document content with the prescribed cyrb53 format', () => {
    expect(contentRevision({ blocks: [] })).toBe('h155265c9b42162');
    expect(contentRevision({ title: 'a', blocks: [] })).toBe('h19450c1151db09');
    const left: OutputData = { blocks: [{ id: 'p', type: 'header', data: { level: 2, text: [{ text: 'P' }] } }] };
    const right: OutputData = { blocks: [{ data: { text: [{ text: 'P' }], level: 2 }, type: 'header', id: 'p' }] };

    expect(contentRevision(left)).toBe(contentRevision(right));
    expect(contentRevision({ blocks: [...left.blocks, { id: 'q', type: 'paragraph', data: {} }] }))
      .not.toBe(contentRevision({ blocks: [{ id: 'q', type: 'paragraph', data: {} }, ...left.blocks] }));
    expect(contentRevision({ ...left, icon })).not.toBe(contentRevision(left));
  });

  it('builds a planner context using the supplied real interfaces', () => {
    const contract = contractFor();
    const ports = stubPorts();
    const services = { fixture: { name: 'service' } };
    const context = plannerContextFrom(contract, runtimes, ports, validateAgainst, services);
    const paragraph = context.tools.get('paragraph');

    expect(paragraph?.runtime).toBe(runtimes.get('paragraph'));
    expect(context.commands.get('doc.read')).toBe(contract.commands.find(command => command.name === 'doc.read'));
    expect(context.ports).toBe(ports);
    expect(context.validate).toBe(validateAgainst);
    expect(context.services).toBe(services);
    expect(context.richText).toBe(richTextHelpers);
    const planned = planBatch({
      snapshot: DocSnapshot.fromOutput({ blocks: [] }),
      batch: { commands: [{ name: 'block.insert', args: { type: context.defaultBlock, data: { text: 'hello' } } }] },
      ctx: { ...context, prepared: new Map() }, stamp: { actorId: actor.id, at: 1 }, warnings: [],
    });

    expect(planned.draft.toOutput().blocks).toMatchObject([{ type: 'paragraph', data: { text: [{ text: 'hello' }] } }]);
  });

  it('reads segments and page fields with a content revision without logging convenience reads', async () => {
    const document = initial();
    const session = track(open(document));

    expect(await session.read()).toMatchObject({
      revision: contentRevision(session.output()), rootId: null,
      page: { title: 'Original', icon }, blocks: [{ id: 'p', text: 'P' }],
    });
    expect(await session.read({ ids: ['p'], detail: 'full' })).toMatchObject({
      blocks: [{ id: 'p', data: { text: [{ text: 'P' }] } }],
    });
    expect(session.output()).toEqual(document);
    expect(session.actor).toEqual(actor);
    expect(session.id).not.toBe('');
    expect(track(open(document)).id).not.toBe(session.id);
    expect(session.log()).toEqual([]);
  });

  it('owns its snapshots rather than leaking input or output mutations into the document', async () => {
    const document = initial();
    const expected = initial();
    const session = track(open(document));

    const inputBlock = document.blocks[0];

    if (inputBlock === undefined) {
      throw new Error('Expected the input block.');
    }
    inputBlock.data.text = [{ text: 'Input changed' }];
    document.blocks.splice(0);
    document.title = 'Input changed';
    const exported = session.output();
    const outputBlock = exported.blocks[0];

    if (outputBlock === undefined) {
      throw new Error('Expected the output block.');
    }
    outputBlock.data.text = [{ text: 'Output changed' }];
    exported.blocks.splice(0);
    exported.title = 'Output changed';
    expect(session.output()).toEqual(expected);
    expect((await session.read()).revision).toBe(contentRevision(expected));
  });

  it('executes real writes, stamps touched blocks, and returns the post-batch revision', async () => {
    const session = track(open());
    const before = (await session.read()).revision;
    const result = await session.execute({ commands: [
      { name: 'block.insert', ref: 'created', args: { type: 'paragraph', data: { text: 'new' } } },
      { name: 'doc.read', args: { detail: 'full' } },
    ] });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.revision).not.toBe(before);
    expect(result.revision).toBe(contentRevision(session.output()));
    expect(result.results[1]).toMatchObject({ revision: result.revision });
    const inserted = session.output().blocks.find(block => block.id === result.refs.created);

    expect(inserted).toMatchObject({ data: { text: [{ text: 'new' }] }, lastEditedBy: actor.id });
    if (inserted === undefined || typeof inserted.lastEditedAt !== 'number') {
      throw new Error('Expected a timestamp on the inserted block.');
    }
    expect(inserted.lastEditedAt).toBeGreaterThan(1);
    expect(session.output().blocks.find(block => block.id === 'p')).toMatchObject({ lastEditedBy: 'owner', lastEditedAt: 1 });
  });

  it('restores one pre-batch snapshot for mixed block and page writes, then redoes exactly', async () => {
    const session = track(open());
    const before = session.output();
    const result = await session.execute({ commands: [
      { name: 'block.insert', args: { id: 'new', type: 'paragraph', data: { text: 'new' } } },
      { name: 'doc.setTitle', args: { title: 'Changed' } },
      { name: 'doc.setIcon', args: { icon: { type: 'image', url: 'https://example.com/icon.png' } } },
    ] });
    const written = session.output();

    expect(result.ok).toBe(true);
    expect(written).toMatchObject({ title: 'Changed', icon: { type: 'image', url: 'https://example.com/icon.png' } });
    expect(written.blocks.map(block => block.id)).toEqual(['p', 'new']);
    expect(await session.execute({ commands: [{ name: 'history.undo', args: {} }] })).toMatchObject({ ok: true, revision: contentRevision(before) });
    expect(session.output()).toEqual(before);
    expect(await session.execute({ commands: [{ name: 'history.undo', args: {} }] })).toMatchObject({ ok: false, error: { code: 'NOTHING_TO_UNDO' } });
    expect(await session.execute({ commands: [{ name: 'history.redo', args: {} }] })).toMatchObject({ ok: true, revision: contentRevision(written) });
    expect(session.output()).toEqual(written);
    expect(await session.execute({ commands: [{ name: 'history.redo', args: {} }] })).toMatchObject({ ok: false, error: { code: 'NOTHING_TO_UNDO' } });
  });

  it('keeps reads, rejected batches and cancellation out of stored undo history', async () => {
    const session = track(open());
    const before = session.output();
    const controller = new AbortController();

    controller.abort();
    expect(await session.execute({ commands: [{ name: 'doc.read', args: {} }] })).toMatchObject({ ok: true });
    expect(await session.execute({ commands: [
      { name: 'doc.setTitle', args: { title: 'Never applied' } },
      { name: 'block.delete', args: { id: 'missing' } },
    ] })).toMatchObject({ ok: false, error: { code: 'BLOCK_NOT_FOUND' } });
    expect(await session.execute({ commands: [{ name: 'doc.setTitle', args: { title: 'Cancelled' } }] }, { signal: controller.signal }))
      .toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(session.output()).toEqual(before);
    expect(await session.execute({ commands: [{ name: 'history.undo', args: {} }] })).toMatchObject({ ok: false, error: { code: 'NOTHING_TO_UNDO' } });
  });

  it('rejects schema-invalid inserted data without committing or recording an undo step', async () => {
    const session = track(open());
    const before = session.output();
    const result = await session.execute({ commands: [
      { name: 'doc.setTitle', args: { title: 'Never applied' } },
      { name: 'block.insert', args: { id: 'bad', type: 'paragraph', data: { unknown: true } } },
    ] });

    expect(result).toMatchObject({ ok: false, error: { code: 'DATA_REJECTED', commandIndex: 1 } });
    expect(session.output()).toEqual(before);
    expect(await session.execute({ commands: [{ name: 'history.undo', args: {} }] })).toMatchObject({ ok: false, error: { code: 'NOTHING_TO_UNDO' } });
  });

  it('preserves redo across a read or failed batch but clears it after a new write', async () => {
    const session = track(open());

    await session.execute({ commands: [{ name: 'doc.setTitle', args: { title: 'First' } }] });
    const first = session.output();

    await session.execute({ commands: [{ name: 'history.undo', args: {} }] });
    await session.execute({ commands: [{ name: 'doc.read', args: {} }] });
    await session.execute({ commands: [{ name: 'block.delete', args: { id: 'missing' } }] });
    expect(await session.execute({ commands: [{ name: 'history.redo', args: {} }] })).toMatchObject({ ok: true });
    expect(session.output()).toEqual(first);
    await session.execute({ commands: [{ name: 'history.undo', args: {} }] });
    expect(await session.execute({ commands: [{ name: 'doc.setTitle', args: { title: 'Second' } }] })).toMatchObject({ ok: true });
    expect(await session.execute({ commands: [{ name: 'history.redo', args: {} }] })).toMatchObject({ ok: false, error: { code: 'NOTHING_TO_UNDO' } });
    expect(session.output().title).toBe('Second');
  });

  it('restores successive successful batches in stack order', async () => {
    const session = track(open());

    expect(await session.execute({ commands: [{ name: 'doc.setTitle', args: { title: 'First' } }] })).toMatchObject({ ok: true });
    const first = session.output();

    expect(await session.execute({ commands: [{ name: 'block.delete', args: { id: 'p' } }] })).toMatchObject({ ok: true });
    const second = session.output();

    await session.execute({ commands: [{ name: 'history.undo', args: {} }] });
    expect(session.output()).toEqual(first);
    await session.execute({ commands: [{ name: 'history.undo', args: {} }] });
    expect(session.output()).toEqual(initial());
    await session.execute({ commands: [{ name: 'history.redo', args: {} }] });
    expect(session.output()).toEqual(first);
    await session.execute({ commands: [{ name: 'history.redo', args: {} }] });
    expect(session.output()).toEqual(second);
  });

  it('keeps undo history session-local', async () => {
    const first = track(open());
    const second = track(open());

    expect(await first.execute({ commands: [{ name: 'block.delete', args: { id: 'p' } }] })).toMatchObject({ ok: true });
    expect(await second.execute({ commands: [{ name: 'history.undo', args: {} }] })).toMatchObject({ ok: false, error: { code: 'NOTHING_TO_UNDO' } });
    expect(second.output()).toEqual(initial());
    expect(first.output().blocks).toEqual([]);
  });

  it('enforces revision preconditions for stored writes and history', async () => {
    const session = track(open());
    const old = (await session.read()).revision;

    await session.execute({ commands: [{ name: 'doc.setTitle', args: { title: 'New' } }], expectRevision: old });
    const current = session.output();

    const stale = await session.execute({ commands: [{ name: 'block.delete', args: { id: 'p' } }], expectRevision: old });

    expect(stale).toMatchObject({ ok: false, error: { code: 'STALE', retryable: true } });
    if (stale.ok) {
      throw new Error('Expected a stale result.');
    }
    expect(stale.error.details?.current).toEqual([{ id: 'p', type: 'paragraph', text: 'P' }]);
    const staleUndo = await session.execute({ commands: [{ name: 'history.undo', args: {} }], expectRevision: old });

    expect(staleUndo).toMatchObject({ ok: false, error: { code: 'STALE', retryable: true } });
    if (staleUndo.ok) {
      throw new Error('Expected a stale history result.');
    }
    expect(staleUndo.error.details?.current).toEqual([]);
    expect(session.output()).toEqual(current);
    expect(await session.execute({ commands: [{ name: 'history.undo', args: {} }], expectRevision: contentRevision(current) }))
      .toMatchObject({ ok: true });
    expect(session.output()).toEqual(initial());
  });

  it('uses the Jint contract to make history unavailable while retaining stored content hashes', async () => {
    const session = track(open(initial(), { runtime: 'jint', contract: contractFor('jint') }));

    expect(await session.execute({ commands: [{ name: 'doc.setTitle', args: { title: 'Jint' } }] })).toMatchObject({ ok: true });
    expect(await session.execute({ commands: [{ name: 'history.undo', args: {} }] }))
      .toMatchObject({ ok: false, error: { code: 'COMMAND_UNAVAILABLE', details: { reason: 'runtime' } } });
    expect(await session.execute({ commands: [{ name: 'history.redo', args: {} }] }))
      .toMatchObject({ ok: false, error: { code: 'COMMAND_UNAVAILABLE', details: { reason: 'runtime' } } });
    expect((await session.read()).revision).toBe(contentRevision(session.output()));
    expect(session.output().title).toBe('Jint');
  });

  it('retains command logs across batches with errors and actor attribution', async () => {
    const session = track(open());

    await session.read();
    await session.execute({ commands: [{ name: 'doc.read', args: {} }] });
    await session.execute({ commands: [{ name: 'block.delete', args: { id: 'missing' } }] });
    await session.execute({ commands: [{ name: 'doc.read', args: {} }] });
    expect(session.log()).toMatchObject([
      { batch: 1, index: 0, name: 'doc.read', actorId: actor.id },
      { batch: 2, index: 0, name: 'block.delete', actorId: actor.id, error: { code: 'BLOCK_NOT_FOUND' } },
      { batch: 3, index: 0, name: 'doc.read', actorId: actor.id },
    ]);
    expect(session.log()).toHaveLength(3);
  });

  it('describes the index and exact tool or command slices, including unavailable commands', () => {
    const contract = contractFor();
    const session = track(open(initial(), { contract }));
    const pageCommands = contract.commands.filter(command => typeof command.source === 'object' && command.source.tool === 'page');

    expect(session.describe()).toEqual({
      index: {
        tools: contract.manifest.blocks.map(tool => ({ name: tool.name, summary: tool.summary })),
        commands: contract.commands.map(command => ({ name: command.name, summary: command.summary })),
        guidance,
      },
    });
    expect(describeContract(contract)).toEqual(session.describe());
    expect(session.describe({ tool: 'page' })).toEqual({ tool: contract.manifest.blocks.find(tool => tool.name === 'page'), commands: pageCommands });
    expect(session.describe({ command: 'page.rename' })).toEqual({ command: pageCommands.find(command => command.name === 'page.rename') });
    expect(session.describe({ command: 'text.format' })).toEqual({ command: contract.commands.find(command => command.name === 'text.format') });
    expect(session.describe({ command: 'page.rename' })).toMatchObject({ command: { available: false, unavailableReason: 'service' } });
    expect(thrownFailure(() => session.describe({ tool: 'missing' })).error.code).toBe('UNKNOWN_TOOL');
    expect(thrownFailure(() => session.describe({ command: 'page.missing' })).error.code).toBe('UNKNOWN_COMMAND');
  });
});

describe('page-map backend', () => {
  it('opens the pointed-to document with the actor, applies title and icon, and closes every opened handle', async () => {
    const source = sourceDocument();
    const target = track(open({ blocks: [] }));
    const { closes, openPage } = targetPort(target);
    const backend = createPageMapBackend(openPage, actor, id => source.blocks.find(block => block.id === id));

    expect(await backend.rename({ blockId: 'pb', title: 'Roadmap' })).toEqual({ pageId: 'pg-1', applied: true });
    expect(await backend.setIcon({ blockId: 'pb', icon })).toEqual({ pageId: 'pg-1', applied: true });
    expect(target.output()).toEqual({ blocks: [], title: 'Roadmap', icon });
    expect(openPage.mock.calls).toEqual([['pg-1', actor], ['pg-1', actor]]);
    expectClosedHandles(closes, 2);
    expect(await backend.rename({ blockId: 'pb', title: '' })).toEqual({ pageId: 'pg-1', applied: true });
    expect(await backend.setIcon({ blockId: 'pb', icon: null })).toEqual({ pageId: 'pg-1', applied: true });
    expect(target.output()).toEqual({ blocks: [] });
    expectClosedHandles(closes, 4);
    expect(source).toEqual(sourceDocument());
  });

  it('rejects missing blocks and malformed page pointers before opening anything', async () => {
    const target = track(open({ blocks: [] }));
    const { closes, openPage } = targetPort(target);
    const blocks: Record<string, { type: string; data: Record<string, unknown> }> = {
      ordinary: { type: 'paragraph', data: { pageId: 'pg-1' } },
      absent: { type: 'page', data: {} },
      malformed: { type: 'page', data: { pageId: 7 } },
    };
    const backend = createPageMapBackend(openPage, actor, id => blocks[id]);

    await expect(backend.rename({ blockId: 'missing', title: 'X' })).rejects.toMatchObject({ error: { code: 'BLOCK_NOT_FOUND' } });
    for (const blockId of ['ordinary', 'absent', 'malformed']) {
      await expect(backend.setIcon({ blockId, icon })).rejects.toMatchObject({ error: { code: 'INVALID_ARGS' } });
    }
    expect(openPage).not.toHaveBeenCalled();
    expectClosedHandles(closes, 0);
    expect(target.output()).toEqual({ blocks: [] });
  });

  it('adds the target page id to a failed target result and still closes its handle', async () => {
    const contract = contractFor();

    contract.commands = contract.commands.map<CommandEntry>(command => command.name === 'doc.setTitle'
      ? { ...command, available: false, unavailableReason: 'service', requires: ['host'] }
      : command);
    const target = track(open({ blocks: [] }, { contract }));
    const { closes, openPage } = targetPort(target);
    const backend = createPageMapBackend(openPage, actor, id => sourceDocument().blocks.find(block => block.id === id));

    const pending = backend.rename({ blockId: 'pb', title: 'X' });

    await expect(pending).rejects.toBeInstanceOf(AgentFailure);
    await expect(pending).rejects.toMatchObject({
      error: { code: 'COMMAND_UNAVAILABLE', retryable: false, details: { pageId: 'pg-1', reason: 'service', requires: ['host'] } },
    });
    expect(target.output()).toEqual({ blocks: [] });
    expectClosedHandles(closes, 1);
  });

  it('adds the page id to a typed execute rejection and closes its handle', async () => {
    const target = track(open({ blocks: [] }));
    const closes: Array<() => void> = [];
    const execute = vi.fn<(batch: AgentBatch) => Promise<AgentResult>>(async () => {
      throw failure('CONFLICT', 'Target changed.', { details: { token: 'target' } });
    });
    const openPage: OpenPage = async () => {
      const close = vi.fn<() => void>();

      closes.push(close);

      return { ...target, execute, close };
    };
    const backend = createPageMapBackend(openPage, actor, id => sourceDocument().blocks.find(block => block.id === id));

    await expect(backend.setIcon({ blockId: 'pb', icon })).rejects.toMatchObject({
      error: { code: 'CONFLICT', retryable: true, details: { pageId: 'pg-1', token: 'target' } },
    });
    expect(execute).toHaveBeenCalledWith({ commands: [{ name: 'doc.setIcon', args: { icon } }] });
    expectClosedHandles(closes, 1);
  });

  it('installs the backend only for the opt-in source session and leaves the source document unchanged', async () => {
    const target = track(open({ blocks: [] }));
    const { openPage, closes } = targetPort(target);
    const ports = stubPorts({ openPageDocument: openPage });
    const disabled = track(open(sourceDocument(), { ports }));
    const enabled = track(open(sourceDocument(), {
      ports, pageTitles: 'page-map', contract: contractFor('node', ['pageBackend']),
    }));

    expect(disabled.describe({ command: 'page.observeBackend' })).toMatchObject({ command: { available: true } });
    expect(await disabled.execute({ commands: [{ name: 'page.observeBackend', args: { id: 'pb' } }] }))
      .toMatchObject({ ok: true, results: [{ hasBackend: false }] });
    expect(observePageBackend).toHaveBeenCalledTimes(1);
    expect(observePageBackend.mock.calls.map(([context]) => context.services.pageBackend)).toEqual([undefined]);
    expect(await disabled.execute({ commands: [{ name: 'page.rename', args: { id: 'pb', title: 'Off' } }] }))
      .toMatchObject({ ok: false, error: { code: 'COMMAND_UNAVAILABLE', details: { reason: 'service', requires: ['pageBackend'] } } });
    expect(openPage).not.toHaveBeenCalled();
    expectClosedHandles(closes, 0);
    const before = enabled.output();
    const result = await enabled.execute({ commands: [{ name: 'page.rename', args: { id: 'pb', title: 'Enabled' } }] });

    expect(result).toMatchObject({ ok: true, revision: contentRevision(before), results: [{ pageId: 'pg-1', applied: true }] });
    expect(target.output().title).toBe('Enabled');
    expect(enabled.output()).toEqual(before);
    expectClosedHandles(closes, 1);
  });

  it('does not install the page backend when the opt-in has no open-page port', async () => {
    const session = track(open(sourceDocument(), { pageTitles: 'page-map' }));

    expect(session.describe({ command: 'page.observeBackend' })).toMatchObject({ command: { available: true } });
    expect(await session.execute({ commands: [{ name: 'page.observeBackend', args: { id: 'pb' } }] }))
      .toMatchObject({ ok: true, results: [{ hasBackend: false }] });
    expect(observePageBackend).toHaveBeenCalledTimes(1);
    expect(observePageBackend.mock.calls.map(([context]) => context.services.pageBackend)).toEqual([undefined]);
    expect(session.describe({ command: 'page.rename' })).toMatchObject({ command: { available: false, unavailableReason: 'service' } });
    expect(await session.execute({ commands: [{ name: 'page.rename', args: { id: 'pb', title: 'Unavailable' } }] }))
      .toMatchObject({ ok: false, error: { code: 'COMMAND_UNAVAILABLE', details: { reason: 'service', requires: ['pageBackend'] } } });
    expect(session.output()).toEqual(sourceDocument());
  });

  it('resolves the page pointer from the current source snapshot rather than the construction snapshot', async () => {
    const target = track(open({ blocks: [] }));
    const { openPage, closes } = targetPort(target);
    const session = track(open(sourceDocument(), {
      ports: stubPorts({ openPageDocument: openPage }), pageTitles: 'page-map', contract: contractFor('node', ['pageBackend']),
    }));

    expect(await session.execute({ commands: [{ name: 'block.update', args: { id: 'pb', data: { pageId: 'pg-2' } } }] })).toMatchObject({ ok: true });
    expect(await session.execute({ commands: [{ name: 'page.setIcon', args: { id: 'pb', icon } }] })).toMatchObject({ ok: true });
    expect(openPage).toHaveBeenCalledWith('pg-2', actor);
    expect(target.output().icon).toEqual(icon);
    expect(await session.execute({ commands: [{ name: 'block.delete', args: { id: 'pb' } }] })).toMatchObject({ ok: true });
    expect(await session.execute({ commands: [{ name: 'page.rename', args: { id: 'pb', title: 'Missing' } }] }))
      .toMatchObject({ ok: false, error: { code: 'BLOCK_NOT_FOUND' } });
    expect(openPage).toHaveBeenCalledTimes(1);
    expectClosedHandles(closes, 1);
  });

  it('rejects stale or mixed host-effect batches before any cross-document write', async () => {
    const target = track(open({ blocks: [] }));
    const { openPage, closes } = targetPort(target);
    const session = track(open(sourceDocument(), {
      ports: stubPorts({ openPageDocument: openPage }), pageTitles: 'page-map', contract: contractFor('node', ['pageBackend']),
    }));
    const old = (await session.read()).revision;

    await session.execute({ commands: [{ name: 'doc.setTitle', args: { title: 'Source changed' } }] });
    const before = session.output();

    const stale = await session.execute({ expectRevision: old, commands: [{ name: 'page.rename', args: { id: 'pb', title: 'Stale' } }] });

    expect(stale).toMatchObject({ ok: false, error: { code: 'STALE' } });
    if (stale.ok) {
      throw new Error('Expected a stale page action result.');
    }
    expect(stale.error.details?.current).toEqual([{ id: 'pb', type: 'page' }]);
    expect(await session.execute({ commands: [
      { name: 'page.rename', args: { id: 'pb', title: 'Mixed' } },
      { name: 'doc.setTitle', args: { title: 'Wrong' } },
    ] })).toMatchObject({ ok: false, error: { code: 'INVALID_ARGS' } });
    expect(openPage).not.toHaveBeenCalled();
    expectClosedHandles(closes, 0);
    expect(target.output()).toEqual({ blocks: [] });
    expect(session.output()).toEqual(before);
  });
});
