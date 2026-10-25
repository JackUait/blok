import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COMMANDS } from '../../../../src/shared/agent/commands';
import { plannerContextFrom } from '../../../../src/shared/agent/context';
import { runBatch } from '../../../../src/shared/agent/executor';
import { DocSnapshot } from '../../../../src/shared/agent/snapshot';
import { buildBuiltInSnapshot } from '../../../../src/shared/built-in-snapshot';
import { validateAgainst } from '../../../../src/shared/schema/validate';
import { BUILT_IN_TOOL_RUNTIMES } from '../../../../src/shared/tool-actions';
import { PAGE_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/page';
import { describePage } from '../../../../src/shared/tool-descriptions/page';
import { buildAgentContract, buildToolManifest } from '../../../../src/shared/tool-manifest';
import { PageTool } from '../../../../src/tools/page';
import { stubPorts } from '../agent/fixtures';
import { createFakeCtx, docOf } from './fake-ctx';

import type { AgentApplier, BatchInput } from '../../../../src/shared/agent/executor';
import type { PageBackendService } from '../../../../src/shared/tool-actions/services';
import type { ContractWhere } from '../../../../src/shared/tool-manifest';
import type { AgentCommand } from '../../../../types/agent';
import type { OutputData } from '../../../../types/data-formats/output-data';
import type { BlockToolConstructable } from '../../../../types/tools/block-tool';
import type { PageIcon } from '../../../../types/tools/page';
import type { ToolActionDeclaration, ToolActionImpl } from '../../../../types/tools/tool-description';

type PageActionName = 'rename' | 'setIcon';

const actionNames: PageActionName[] = ['rename', 'setIcon'];
const runtimes: ContractWhere['runtime'][] = ['node', 'jint', 'editor'];
const sourceBlocks = (): Parameters<typeof docOf>[0] => [
  { id: 'before', type: 'paragraph', data: { text: [{ text: 'Keep this text' }] } },
  { id: 'page-block', type: 'page', data: { pageId: 'target-document', textColor: 'red' } },
  { id: 'other-page', type: 'page', data: { pageId: 'other-document' } },
];
const sourceDocument = (): OutputData => ({
  title: 'Source title',
  icon: { type: 'emoji', value: 'S' },
  blocks: sourceBlocks(),
});

const emojiWithExtras: PageIcon & { label: string } = { type: 'emoji', value: 'P', label: 'keep' };
const imageWithExtras: PageIcon & { label: string } = { type: 'image', url: 'not-a-url', label: 'keep' };
const icons: Array<{ label: string; icon: PageIcon | null }> = [
  { label: 'null', icon: null },
  { label: 'emoji', icon: { type: 'emoji', value: 'P' } },
  { label: 'empty emoji', icon: { type: 'emoji', value: '' } },
  { label: 'image', icon: { type: 'image', url: 'https://example.test/icon.png' } },
  { label: 'empty image URL', icon: { type: 'image', url: '' } },
  { label: 'emoji with extra keys', icon: emojiWithExtras },
  { label: 'image with extra keys and a raw URL', icon: imageWithExtras },
];

const actionOf = (name: PageActionName): ToolActionDeclaration => {
  const action = describePage({}).actions?.find(candidate => candidate.name === name);

  if (action === undefined) {
    throw new Error(`Missing page action "${name}".`);
  }

  return action;
};

const handlerOf = (name: PageActionName): ToolActionImpl => {
  const handler = PAGE_ACTION_HANDLERS[name];

  if (handler === undefined) {
    throw new Error(`Missing page handler "${name}".`);
  }

  return handler;
};

const contractFor = (where: ContractWhere) => buildAgentContract(
  buildToolManifest(buildBuiltInSnapshot({ blokVersion: 'task49-tests', services: where.services })),
  COMMANDS,
  where
);

const commandFor = (name: PageActionName): AgentCommand => name === 'rename'
  ? { name: 'page.rename', args: { id: 'page-block', title: 'Roadmap' } }
  : { name: 'page.setIcon', args: { id: 'page-block', icon: null } };

const batchFixture = (pageBackend: PageBackendService) => {
  let current = DocSnapshot.fromOutput(sourceDocument());
  let version = 0;
  const apply = vi.fn<AgentApplier['apply']>().mockImplementation((_plan, draft) => {
    current = draft;
    version += 1;

    return Promise.resolve();
  });
  const applier: AgentApplier = {
    runtime: 'node',
    isReadOnly: () => false,
    snapshot: () => current,
    revision: () => `source-r${version}`,
    apply,
  };
  const input: Omit<BatchInput, 'batch'> = {
    ctx: plannerContextFrom(
      contractFor({ runtime: 'node', services: ['pageBackend'] }),
      BUILT_IN_TOOL_RUNTIMES,
      stubPorts(),
      validateAgainst,
      { pageBackend }
    ),
    applier,
    actor: { id: 'page-actions-agent', name: 'Page actions', kind: 'agent' },
    log: [],
    batchNo: 1,
    now: () => 1,
  };

  return { input, applier, apply };
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('page host-action declarations', () => {
  it('declares both block actions as host effects requiring pageBackend in every runtime', () => {
    expect((describePage({}).actions ?? []).map(action => ({
      name: action.name,
      target: action.target,
      runtime: action.runtime ?? 'any',
      effects: action.effects,
      requires: action.requires,
    }))).toEqual([
      { name: 'rename', target: 'block', runtime: 'any', effects: 'host', requires: ['pageBackend'] },
      { name: 'setIcon', target: 'block', runtime: 'any', effects: 'host', requires: ['pageBackend'] },
    ]);
  });

  it('registers the same handlers in the shared runtime, built-in snapshot and page class', () => {
    const pageClass: Pick<BlockToolConstructable, 'describe' | 'actionHandlers'> = PageTool;
    const snapshot = buildBuiltInSnapshot({ blokVersion: 'task49-tests' });

    expect(snapshot.blocks.find(block => block.name === 'page')?.handlers.slice().sort()).toEqual(['rename', 'setIcon']);
    expect(Object.keys(PAGE_ACTION_HANDLERS).sort()).toEqual(['rename', 'setIcon']);
    expect(BUILT_IN_TOOL_RUNTIMES.get('page')?.actions).toBe(PAGE_ACTION_HANDLERS);
    expect(pageClass.actionHandlers).toBe(PAGE_ACTION_HANDLERS);
    expect(pageClass.describe).toBe(describePage);
  });

  it.each(runtimes)('uses service opt-in, not an editor-only gate, in the %s contract', runtime => {
    const absent = contractFor({ runtime, services: [] });
    const unrelated = contractFor({ runtime, services: ['host', 'uploader', 'linkMetadata'] });
    const present = contractFor({ runtime, services: ['pageBackend'] });
    const entries = (contract: ReturnType<typeof contractFor>) => contract.commands
      .filter(command => command.name === 'page.rename' || command.name === 'page.setIcon')
      .map(command => ({
        name: command.name,
        available: command.available,
        unavailableReason: command.unavailableReason,
        runtime: command.runtime,
        requires: command.requires,
        effects: command.effects,
        source: command.source,
      }));
    const unavailable = [
      { name: 'page.rename', available: false, unavailableReason: 'service', runtime: 'any', requires: ['pageBackend'], effects: 'host', source: { tool: 'page', target: 'block' } },
      { name: 'page.setIcon', available: false, unavailableReason: 'service', runtime: 'any', requires: ['pageBackend'], effects: 'host', source: { tool: 'page', target: 'block' } },
    ];

    expect(entries(absent)).toEqual(unavailable);
    expect(entries(unrelated)).toEqual(unavailable);
    expect(entries(present)).toEqual([
      { name: 'page.rename', available: true, unavailableReason: undefined, runtime: 'any', requires: ['pageBackend'], effects: 'host', source: { tool: 'page', target: 'block' } },
      { name: 'page.setIcon', available: true, unavailableReason: undefined, runtime: 'any', requires: ['pageBackend'], effects: 'host', source: { tool: 'page', target: 'block' } },
    ]);
  });

  it('leaves id to the core contract and requires the source block id there', () => {
    const contract = contractFor({ runtime: 'node', services: ['pageBackend'] });

    for (const name of actionNames) {
      const args = name === 'rename' ? { title: 'Roadmap' } : { icon: null };
      const entry = contract.commands.find(command => command.name === `page.${name}`);

      if (entry === undefined) {
        throw new Error(`Missing page command "${name}".`);
      }

      expect(validateAgainst(actionOf(name).args, args)).toEqual([]);
      expect(validateAgainst(actionOf(name).args, { ...args, id: 'page-block' }).length).toBeGreaterThan(0);
      expect(validateAgainst(entry.args, { ...args, id: 'page-block' })).toEqual([]);
      expect(validateAgainst(entry.args, args).length).toBeGreaterThan(0);
      expect(validateAgainst(entry.args, { ...args, id: null }).length).toBeGreaterThan(0);
    }
  });

  it.each(['Roadmap', '', '  <Plan> & notes  '])('accepts the string title %j without adding restrictions', title => {
    expect(validateAgainst(actionOf('rename').args, { title })).toEqual([]);
  });

  it.each([{}, { title: null }, { title: 1 }, { title: 'Roadmap', pageId: 'target-document' }])(
    'rejects invalid rename arguments %j',
    args => {
      expect(validateAgainst(actionOf('rename').args, args).length).toBeGreaterThan(0);
    }
  );

  it.each(icons)('accepts $label under the published icon schema', ({ icon }) => {
    expect(validateAgainst(actionOf('setIcon').args, { icon })).toEqual([]);
  });

  it.each([
    {},
    { icon: 1 },
    { icon: {} },
    { icon: { type: 'emoji' } },
    { icon: { type: 'emoji', value: 1 } },
    { icon: { type: 'image' } },
    { icon: { type: 'image', url: 1 } },
    { icon: { type: 'unknown', value: 'P' } },
    { icon: null, pageId: 'target-document' },
  ])('rejects invalid setIcon arguments %j', args => {
    expect(validateAgainst(actionOf('setIcon').args, args).length).toBeGreaterThan(0);
  });
});

describe('page action prepare and run', () => {
  it.each(['Roadmap', '', '  <Plan> & notes  '])('delegates title %j once in prepare using blockId, not pageId', async title => {
    const hostResult = { pageId: 'target-document', applied: true, receipt: { title } };
    const rename = vi.fn<PageBackendService['rename']>().mockResolvedValue(hostResult);
    const setIcon = vi.fn<PageBackendService['setIcon']>().mockResolvedValue(undefined);
    const pageBackend: PageBackendService = { rename, setIcon };
    const ctx = createFakeCtx(docOf(sourceBlocks()), 'page-block');
    const before = JSON.stringify([...ctx.doc.values()]);
    const handler = handlerOf('rename');
    const prepare = handler.prepare;

    if (prepare === undefined) {
      throw new Error('page.rename must prepare its host effect.');
    }

    const args = { id: 'page-block', title };
    const prepared = await prepare({ services: { pageBackend } }, args);

    expect(rename).toHaveBeenCalledWith({ blockId: 'page-block', title });
    expect(prepared).toBe(hostResult);
    const result = handler.run(ctx, args, prepared);

    expect(ctx.edits).toEqual([]);
    expect(JSON.stringify([...ctx.doc.values()])).toBe(before);
    expect(result).toBe(hostResult);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(setIcon).not.toHaveBeenCalled();
  });

  it.each(icons)('delegates $label once in prepare without rewriting the icon or source', async ({ icon }) => {
    const hostResult = { pageId: 'target-document', applied: true, receipt: { icon } };
    const rename = vi.fn<PageBackendService['rename']>().mockResolvedValue(undefined);
    const setIcon = vi.fn<PageBackendService['setIcon']>().mockResolvedValue(hostResult);
    const pageBackend: PageBackendService = { rename, setIcon };
    const ctx = createFakeCtx(docOf(sourceBlocks()), 'page-block');
    const before = JSON.stringify([...ctx.doc.values()]);
    const beforeIcon = JSON.stringify(icon);
    const handler = handlerOf('setIcon');
    const prepare = handler.prepare;

    if (prepare === undefined) {
      throw new Error('page.setIcon must prepare its host effect.');
    }

    const args = { id: 'page-block', icon: icon === null ? null : { ...icon } };
    const prepared = await prepare({ services: { pageBackend } }, args);

    expect(setIcon).toHaveBeenCalledWith({ blockId: 'page-block', icon });
    expect(prepared).toBe(hostResult);
    const result = handler.run(ctx, args, prepared);

    expect(ctx.edits).toEqual([]);
    expect(JSON.stringify([...ctx.doc.values()])).toBe(before);
    expect(JSON.stringify(args.icon)).toBe(beforeIcon);
    expect(result).toBe(hostResult);
    expect(setIcon).toHaveBeenCalledTimes(1);
    expect(rename).not.toHaveBeenCalled();
  });

  it.each(actionNames)('%s returns an absent prepared result without inventing data or edits', name => {
    const ctx = createFakeCtx(docOf(sourceBlocks()), 'page-block');
    const before = JSON.stringify([...ctx.doc.values()]);
    const result = handlerOf(name).run(ctx, commandFor(name).args, undefined);

    expect(result).toBeUndefined();
    expect(ctx.edits).toEqual([]);
    expect(JSON.stringify([...ctx.doc.values()])).toBe(before);
  });
});

describe('page actions through the shared executor', () => {
  it.each(actionNames)('%s returns the host result without applying any source-document edits', async name => {
    const hostResult = { pageId: 'target-document', applied: true };
    const rename = vi.fn<PageBackendService['rename']>().mockResolvedValue(hostResult);
    const setIcon = vi.fn<PageBackendService['setIcon']>().mockResolvedValue(hostResult);
    const fixture = batchFixture({ rename, setIcon });
    const result = await runBatch({ ...fixture.input, batch: { commands: [commandFor(name)] } });

    expect(fixture.applier.snapshot().toOutput()).toEqual(sourceDocument());
    expect(fixture.apply).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      revision: 'source-r0',
      results: [hostResult],
      changed: { created: [], updated: [], moved: [], removed: [] },
    });
    expect(name === 'rename' ? rename : setIcon).toHaveBeenCalledTimes(1);
    expect(name === 'rename' ? setIcon : rename).not.toHaveBeenCalled();
  });

  it.each(actionNames)('%s reports a service failure without mutating or applying the source document', async name => {
    const error = new Error('Target page save failed');
    const rename = vi.fn<PageBackendService['rename']>().mockRejectedValue(error);
    const setIcon = vi.fn<PageBackendService['setIcon']>().mockRejectedValue(error);
    const fixture = batchFixture({ rename, setIcon });
    const result = await runBatch({ ...fixture.input, batch: { commands: [commandFor(name)] } });

    expect(fixture.applier.snapshot().toOutput()).toEqual(sourceDocument());
    expect(fixture.apply).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      revision: 'source-r0',
      error: { code: 'TOOL_ACTION_FAILED', commandIndex: 0 },
    });
    expect(name === 'rename' ? rename : setIcon).toHaveBeenCalledTimes(1);
    expect(name === 'rename' ? setIcon : rename).not.toHaveBeenCalled();
  });

  it('refuses a javascript: image icon before the host is called', async () => {
    const rename = vi.fn<PageBackendService['rename']>().mockResolvedValue(undefined);
    const setIcon = vi.fn<PageBackendService['setIcon']>().mockResolvedValue(undefined);
    const fixture = batchFixture({ rename, setIcon });
    const result = await runBatch({
      ...fixture.input,
      batch: { commands: [{ name: 'page.setIcon', args: { id: 'page-block', icon: { type: 'image', url: 'javascript:alert(1)' } } }] },
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_ARGS', commandIndex: 0 } });
    expect(setIcon).not.toHaveBeenCalled();
    expect(fixture.apply).not.toHaveBeenCalled();
  });

  it.each(actionNames)('%s must be alone in its batch before either the host or source is touched', async name => {
    const rename = vi.fn<PageBackendService['rename']>().mockResolvedValue(undefined);
    const setIcon = vi.fn<PageBackendService['setIcon']>().mockResolvedValue(undefined);
    const fixture = batchFixture({ rename, setIcon });
    const result = await runBatch({
      ...fixture.input,
      batch: { commands: [commandFor(name), { name: 'doc.setTitle', args: { title: 'Must not replace source title' } }] },
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_ARGS', commandIndex: 0 } });
    expect(rename).not.toHaveBeenCalled();
    expect(setIcon).not.toHaveBeenCalled();
    expect(fixture.apply).not.toHaveBeenCalled();
    expect(fixture.applier.snapshot().toOutput()).toEqual(sourceDocument());
  });
});
