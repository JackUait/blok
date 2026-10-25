import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../../src/components/core';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import {
  createEditorAgentSession,
  type ContractSource,
} from '../../../../../src/components/modules/agent/editor-session';
import { snapshotFromTools, runtimesFromTools } from '../../../../../src/components/tools/registry-snapshot';
import { Listeners } from '../../../../../src/components/utils/listeners';
import { destroy as destroyTooltip } from '../../../../../src/components/utils/tooltip';
import { getBlokVersion } from '../../../../../src/components/utils/version';
import { COMMANDS } from '../../../../../src/shared/agent/commands';
import { buildAgentContract, buildToolManifest } from '../../../../../src/shared/tool-manifest';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { BlockChanged } from '../../../../../src/components/events';
import { failure } from '../../../../../src/shared/agent/errors';
import type { PageBackendService } from '../../../../../src/shared/tool-actions/services';
import { BlockChangedMutationType } from '../../../../../types/events/block/BlockChanged';
import { BlockAddedMutationType } from '../../../../../types/events/block/BlockAdded';
import type { BlockToolDescription, ToolActionImpl } from '../../../../../types/tools/tool-description';

import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { AgentActor, AgentCommand, AgentSession } from '../../../../../types/agent';

const actor: AgentActor = { id: 'agent-1', name: 'Agent', kind: 'agent' };
const competingActors: AgentActor[] = [
  actor,
  { id: 'agent-2', name: 'Other agent', kind: 'agent' },
];
const historyCommands: Array<'history.undo' | 'history.redo'> = ['history.undo', 'history.redo'];
const original = [{ id: 'p', type: 'paragraph', text: [{ text: 'P' }] }];
const withA = [
  ...original,
  { id: 'a', type: 'paragraph', text: [{ text: 'A' }] },
];
const withAB = [
  ...withA,
  { id: 'b', type: 'paragraph', text: [{ text: 'B' }] },
];

let holder: HTMLDivElement | undefined;
let core: Core | undefined;
let ready = false;
const sessions: AgentSession[] = [];
const cleanups: Array<() => void> = [];

const hasDestroy = (value: unknown): value is { destroy(): void | Promise<void> } =>
  typeof value === 'object' && value !== null &&
  'destroy' in value && typeof value.destroy === 'function';

const settle = async (editor: BlokModules): Promise<void> => {
  await vi.waitFor(() => {
    expect(editor.BlockManager.isSyncingFromYjs).toBe(false);
  });
  await new Promise<void>((resolve) => {
    cleanups.push(editor.YjsManager.onPendingBlockWritesSettled(resolve));
  });
  editor.YjsManager.flushPendingBlockWrites();
  await vi.waitFor(() => {
    expect(editor.BlockManager.isSyncingFromYjs).toBe(false);
    expect(editor.BlockManager.suppressStopCapturing).toBe(false);
  });
};

const destroyModule = async (owner: unknown, failures: unknown[]): Promise<void> => {
  try {
    if (hasDestroy(owner)) {
      await owner.destroy();
    }
  } catch (error) {
    failures.push(error);
  } finally {
    if (typeof owner === 'object' && owner !== null &&
      'listeners' in owner && owner.listeners instanceof Listeners) {
      owner.listeners.removeAll();
    }
  }
};

const destroyCore = async (instance: Core): Promise<void> => {
  const modules = Object.values<BlokModules[keyof BlokModules]>({ ...instance.moduleInstances });
  const failures: unknown[] = [];

  for (const module of modules) {
    module.markDestroyed();
  }
  for (const module of modules) {
    await destroyModule(module, failures);
  }
  destroyTooltip();

  if (failures.length > 0) {
    throw new AggregateError(failures, 'Editor teardown failed.');
  }
};

const boot = async (): Promise<BlokModules> => {
  if (holder === undefined) {
    throw new Error('The test holder is missing.');
  }
  if (core !== undefined) {
    throw new Error('The test editor is already booted.');
  }

  const instance = new Core({
    holder,
    tabSync: false,
    i18n: { locale: 'en' },
    user: { id: 'human-1', name: 'Human' },
    tools: { paragraph: { class: Paragraph } },
    data: { blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] } }] },
  });

  core = instance;
  await instance.isReady;
  ready = true;
  await settle(instance.moduleInstances);

  return instance.moduleInstances;
};

const openSession = (
  editor: BlokModules,
  sessionActor: AgentActor = actor,
  contractSource?: ContractSource
): AgentSession => {
  const session = createEditorAgentSession(
    editor,
    sessionActor,
    contractSource === undefined ? {} : { contractSource }
  );

  sessions.push(session);

  return session;
};

const saved = (editor: BlokModules) => editor.YjsManager.toJSON().map(block => ({
  id: block.id,
  type: block.type,
  text: editor.YjsManager.richSegmentsOf(block.data.text),
}));

const humanEdit = async (editor: BlokModules): Promise<void> => {
  editor.YjsManager.beginGesture('discrete');
  await editor.API.methods.blocks.update('p', { text: [{ text: 'Human' }] });
  await settle(editor);
};

const cleanupEditor = async (): Promise<void> => {
  sessions.splice(0).forEach(session => session.close());
  cleanups.splice(0).forEach(cleanup => cleanup());
  if (core !== undefined) {
    await core.isReady.catch(() => undefined);
    await destroyCore(core);
  }
};

describe('createEditorAgentSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ready = false;
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    try {
      if (core !== undefined && ready) {
        await settle(core.moduleInstances);
      }
    } finally {
      try {
        await cleanupEditor();
      } finally {
        core = undefined;
        ready = false;
        holder?.remove();
        holder = undefined;
        vi.restoreAllMocks();
      }
    }
  });

  it('undoes every write in one execute with one editor undo', async () => {
    const editor = await boot();
    const session = openSession(editor);
    const result = await session.execute({ commands: [
      { name: 'block.insert', args: { id: 'a', type: 'paragraph', data: { text: 'A' } } },
      { name: 'block.insert', args: { id: 'b', type: 'paragraph', data: { text: 'B' } } },
      { name: 'text.format', args: { id: 'p', range: 'all', set: { bold: true } } },
    ] });

    await settle(editor);
    const written = saved(editor);
    const token = editor.YjsManager.topUndoToken();

    editor.YjsManager.undo();
    await settle(editor);

    expect(saved(editor)).toEqual(original);
    expect(editor.YjsManager.canUndo()).toBe(false);
    expect(result).toMatchObject({ ok: true });
    expect(written).toEqual([
      { id: 'p', type: 'paragraph', text: [{ text: 'P', marks: { bold: true } }] },
      { id: 'a', type: 'paragraph', text: [{ text: 'A' }] },
      { id: 'b', type: 'paragraph', text: [{ text: 'B' }] },
    ]);
    expect(token).toBeDefined();
    expect(editor.YjsManager.topRedoToken()).toBe(token);
    expect(editor.YjsManager.undoStepTag(token)).toEqual({
      actorId: actor.id, sessionId: session.id,
    });
  }, 60_000);

  it('undoes and redoes its own step without losing ownership', async () => {
    const editor = await boot();
    const session = openSession(editor);
    const inserted = await session.execute({ commands: [
      { name: 'block.insert', args: { id: 'a', type: 'paragraph', data: { text: 'A' } } },
    ] });

    await settle(editor);
    const token = editor.YjsManager.topUndoToken();
    const undone = await session.execute({ commands: [{ name: 'history.undo', args: {} }] });

    await settle(editor);

    expect(saved(editor)).toEqual(original);
    expect(undone).toMatchObject({ ok: true });
    expect(inserted).toMatchObject({ ok: true });
    expect(token).toBeDefined();
    expect(editor.YjsManager.canUndo()).toBe(false);
    expect(editor.YjsManager.topRedoToken()).toBe(token);
    expect(editor.YjsManager.undoStepTag(editor.YjsManager.topRedoToken())).toEqual({
      actorId: actor.id, sessionId: session.id,
    });

    const redone = await session.execute({ commands: [{ name: 'history.redo', args: {} }] });

    await settle(editor);

    expect(saved(editor)).toEqual(withA);
    expect(redone).toMatchObject({ ok: true });
    expect(editor.YjsManager.topUndoToken()).toBe(token);
    expect(editor.YjsManager.canRedo()).toBe(false);
    expect(editor.YjsManager.undoStepTag(editor.YjsManager.topUndoToken())).toEqual({
      actorId: actor.id, sessionId: session.id,
    });

    const undoneAgain = await session.execute({ commands: [{ name: 'history.undo', args: {} }] });

    await settle(editor);

    expect(saved(editor)).toEqual(original);
    expect(undoneAgain).toMatchObject({ ok: true });
    expect(editor.YjsManager.canUndo()).toBe(false);
    expect(editor.YjsManager.topRedoToken()).toBe(token);
  }, 60_000);

  it('refuses to undo a human step and allows its own after the human undoes', async () => {
    const editor = await boot();
    const session = openSession(editor);

    expect(await session.execute({ commands: [
      { name: 'block.insert', args: { id: 'a', type: 'paragraph', data: { text: 'A' } } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    const ownToken = editor.YjsManager.topUndoToken();

    await humanEdit(editor);
    const humanToken = editor.YjsManager.topUndoToken();
    const refused = await session.execute({ commands: [{ name: 'history.undo', args: {} }] });

    await settle(editor);

    expect(refused).toMatchObject({ ok: false, error: { code: 'UNDO_NOT_OWN' } });
    expect(saved(editor)).toEqual([
      { id: 'p', type: 'paragraph', text: [{ text: 'Human' }] },
      { id: 'a', type: 'paragraph', text: [{ text: 'A' }] },
    ]);
    expect(humanToken).toBeDefined();
    expect(humanToken).not.toBe(ownToken);
    expect(editor.YjsManager.topUndoToken()).toBe(humanToken);
    expect(editor.YjsManager.undoStepTag(humanToken)).toBeUndefined();

    editor.YjsManager.undo();
    await settle(editor);

    expect(saved(editor)).toEqual(withA);
    expect(editor.YjsManager.topUndoToken()).toBe(ownToken);
    expect(await session.execute({ commands: [{ name: 'history.undo', args: {} }] }))
      .toMatchObject({ ok: true });
    await settle(editor);
    expect(saved(editor)).toEqual(original);
    expect(editor.YjsManager.canUndo()).toBe(false);
  }, 60_000);

  it.each(competingActors)('refuses a newer undo step from another session with actor $id', async (otherActor) => {
    const editor = await boot();
    const first = openSession(editor);
    const other = openSession(editor, otherActor);

    expect(await first.execute({ commands: [
      { name: 'block.insert', args: { id: 'a', type: 'paragraph', data: { text: 'A' } } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    const ownToken = editor.YjsManager.topUndoToken();

    expect(await other.execute({ commands: [
      { name: 'block.insert', args: { id: 'b', type: 'paragraph', data: { text: 'B' } } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    const otherToken = editor.YjsManager.topUndoToken();
    const refused = await first.execute({ commands: [{ name: 'history.undo', args: {} }] });

    await settle(editor);

    expect(refused).toMatchObject({ ok: false, error: { code: 'UNDO_NOT_OWN' } });
    expect(saved(editor)).toEqual(withAB);
    expect(other.id).not.toBe(first.id);
    expect(otherToken).toBeDefined();
    expect(otherToken).not.toBe(ownToken);
    expect(editor.YjsManager.topUndoToken()).toBe(otherToken);
    expect(editor.YjsManager.undoStepTag(otherToken)).toEqual({
      actorId: otherActor.id, sessionId: other.id,
    });

    expect(await other.execute({ commands: [{ name: 'history.undo', args: {} }] }))
      .toMatchObject({ ok: true });
    await settle(editor);
    expect(saved(editor)).toEqual(withA);
    expect(editor.YjsManager.topUndoToken()).toBe(ownToken);
    expect(await first.execute({ commands: [{ name: 'history.undo', args: {} }] }))
      .toMatchObject({ ok: true });
    await settle(editor);
    expect(saved(editor)).toEqual(original);
  }, 60_000);

  it('refuses to redo a human step without changing the redo stack', async () => {
    const editor = await boot();
    const session = openSession(editor);

    expect(await session.execute({ commands: [
      { name: 'block.insert', args: { id: 'a', type: 'paragraph', data: { text: 'A' } } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    expect(await session.execute({ commands: [{ name: 'history.undo', args: {} }] }))
      .toMatchObject({ ok: true });
    await settle(editor);
    const ownRedoToken = editor.YjsManager.topRedoToken();

    await humanEdit(editor);
    const humanToken = editor.YjsManager.topUndoToken();

    editor.YjsManager.undo();
    await settle(editor);
    const refused = await session.execute({ commands: [{ name: 'history.redo', args: {} }] });

    await settle(editor);

    expect(refused).toMatchObject({ ok: false, error: { code: 'UNDO_NOT_OWN' } });
    expect(saved(editor)).toEqual(original);
    expect(humanToken).toBeDefined();
    expect(humanToken).not.toBe(ownRedoToken);
    expect(editor.YjsManager.topRedoToken()).toBe(humanToken);
    expect(editor.YjsManager.undoStepTag(humanToken)).toBeUndefined();

    editor.YjsManager.redo();
    await settle(editor);

    expect(saved(editor)).toEqual([
      { id: 'p', type: 'paragraph', text: [{ text: 'Human' }] },
    ]);
  }, 60_000);

  it.each(competingActors)('refuses another session redo step with actor $id', async (otherActor) => {
    const editor = await boot();
    const first = openSession(editor);
    const other = openSession(editor, otherActor);

    expect(await first.execute({ commands: [
      { name: 'block.insert', args: { id: 'a', type: 'paragraph', data: { text: 'A' } } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    expect(await first.execute({ commands: [{ name: 'history.undo', args: {} }] }))
      .toMatchObject({ ok: true });
    await settle(editor);
    const ownRedoToken = editor.YjsManager.topRedoToken();

    expect(await other.execute({ commands: [
      { name: 'block.insert', args: { id: 'b', type: 'paragraph', data: { text: 'B' } } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    const otherToken = editor.YjsManager.topUndoToken();

    expect(await other.execute({ commands: [{ name: 'history.undo', args: {} }] }))
      .toMatchObject({ ok: true });
    await settle(editor);
    const refused = await first.execute({ commands: [{ name: 'history.redo', args: {} }] });

    await settle(editor);

    expect(refused).toMatchObject({ ok: false, error: { code: 'UNDO_NOT_OWN' } });
    expect(saved(editor)).toEqual(original);
    expect(otherToken).toBeDefined();
    expect(otherToken).not.toBe(ownRedoToken);
    expect(editor.YjsManager.topRedoToken()).toBe(otherToken);
    expect(editor.YjsManager.undoStepTag(otherToken)).toEqual({
      actorId: otherActor.id, sessionId: other.id,
    });

    expect(await other.execute({ commands: [{ name: 'history.redo', args: {} }] }))
      .toMatchObject({ ok: true });
    await settle(editor);
    expect(saved(editor)).toEqual([
      ...original,
      { id: 'b', type: 'paragraph', text: [{ text: 'B' }] },
    ]);
  }, 60_000);

  it.each(historyCommands)('returns NOTHING_TO_UNDO for %s after reads with empty history', async (name) => {
    const editor = await boot();
    const session = openSession(editor);
    const view = await session.read({ detail: 'full' });
    const read = await session.execute({ commands: [{ name: 'doc.read', args: {} }] });
    const result = await session.execute({ commands: [{ name, args: {} }] });

    await settle(editor);

    expect(result).toMatchObject({ ok: false, error: { code: 'NOTHING_TO_UNDO' } });
    expect(saved(editor)).toEqual(original);
    expect(editor.YjsManager.canUndo()).toBe(false);
    expect(editor.YjsManager.canRedo()).toBe(false);
    expect(editor.YjsManager.topUndoToken()).toBeUndefined();
    expect(editor.YjsManager.topRedoToken()).toBeUndefined();
    expect(read).toMatchObject({ ok: true });
    expect(view.blocks).toMatchObject([
      { id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] } },
    ]);
    expect(view.blocks).toHaveLength(1);
  }, 60_000);

  it('refuses writes in read-only mode while both read APIs still return content', async () => {
    const editor = await boot();
    const session = openSession(editor);

    expect(await session.execute({ commands: [
      { name: 'block.insert', args: { id: 'a', type: 'paragraph', data: { text: 'A' } } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    const token = editor.YjsManager.topUndoToken();

    await editor.ReadOnly.toggle(true);
    await settle(editor);
    const writes: AgentCommand[] = [
      { name: 'block.insert', args: { id: 'b', type: 'paragraph', data: { text: 'B' } } },
      { name: 'block.delete', args: { id: 'p' } },
      { name: 'text.format', args: { id: 'p', range: 'all', set: { bold: true } } },
      { name: 'history.undo', args: {} },
      { name: 'history.redo', args: {} },
    ];

    for (const command of writes) {
      const refused = await session.execute({ commands: [command] });

      expect(refused).toMatchObject({ ok: false, error: { code: 'READ_ONLY' } });
      await settle(editor);
      expect(saved(editor)).toEqual(withA);
      expect(editor.YjsManager.topUndoToken()).toBe(token);
    }

    const view = await session.read({ detail: 'full' });
    const read = await session.execute({ commands: [{ name: 'doc.read', args: { detail: 'full' } }] });

    expect(view.blocks).toMatchObject([
      { id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] } },
      { id: 'a', type: 'paragraph', data: { text: [{ text: 'A' }] } },
    ]);
    expect(view.blocks).toHaveLength(2);
    expect(read).toMatchObject({
      ok: true,
      results: [{
        blocks: [
          { id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] } },
          { id: 'a', type: 'paragraph', data: { text: [{ text: 'A' }] } },
        ],
      }],
    });
    expect(saved(editor)).toEqual(withA);
    expect(editor.ReadOnly.isEnabled).toBe(true);
    expect(editor.YjsManager.topUndoToken()).toBe(token);
  }, 60_000);

  it('reuses real tool runtimes until the built contract revision changes', async () => {
    const editor = await boot();
    const builtRevisions: string[] = [];
    let guidance = 'Use short paragraphs.';
    const source: ContractSource = {
      contract: () => buildAgentContract(
        buildToolManifest(snapshotFromTools(editor.Tools, {
          blokVersion: getBlokVersion(),
          readOnly: editor.ReadOnly.isEnabled,
          defaultBlock: editor.Tools.defaultTool.name,
          services: [],
          i18n: editor.I18n,
        }), { paragraph: { guidance } }),
        COMMANDS,
        { runtime: 'editor', services: [] }
      ),
      runtimes: (contract) => {
        const runtimes = runtimesFromTools(editor.Tools);

        builtRevisions.push(contract.revision);

        return runtimes;
      },
    };
    const firstContract = source.contract();
    const sameContract = source.contract();
    const session = openSession(editor, actor, source);
    const firstRead = await session.read({ detail: 'full' });
    const read = await session.execute({ commands: [{ name: 'doc.read', args: {} }] });
    const inserted = await session.execute({ commands: [
      { name: 'block.insert', args: { id: 'a', type: 'paragraph', data: { text: 'A' } } },
    ] });

    await settle(editor);
    const afterWrite = await session.read({ detail: 'full' });

    expect(builtRevisions).toEqual([firstContract.revision]);
    expect(sameContract).not.toBe(firstContract);
    expect(sameContract.revision).toBe(firstContract.revision);
    expect(source.contract().revision).toBe(firstContract.revision);
    expect(afterWrite.revision).not.toBe(firstRead.revision);
    expect(saved(editor)).toEqual(withA);
    expect(read).toMatchObject({ ok: true });
    expect(inserted).toMatchObject({ ok: true });

    guidance = 'Use a separate paragraph for each point.';
    const changedContract = source.contract();
    const nextInserted = await session.execute({ commands: [
      { name: 'block.insert', args: { id: 'b', type: 'paragraph', data: { text: 'B' } } },
    ] });

    await settle(editor);
    const finalRead = await session.read({ detail: 'full' });

    expect(builtRevisions).toEqual([firstContract.revision, changedContract.revision]);
    expect(changedContract.revision).not.toBe(firstContract.revision);
    expect(nextInserted).toMatchObject({ ok: true });
    expect(saved(editor)).toEqual(withAB);
    expect(finalRead.blocks.map(block => block.id)).toEqual(['p', 'a', 'b']);
  }, 60_000);

  it.each([
    { mode: 'default', optOut: false, expectedEditor: 'agent-1' },
    { mode: 'user', optOut: true, expectedEditor: 'human-1' },
  ])('names the $mode as creator and editor of what the session inserts and updates', async ({ optOut, expectedEditor }) => {
    const editor = await boot();
    const details = new Map<string, unknown>();
    const onChange = (payload: unknown): void => {
      if (typeof payload !== 'object' || payload === null || !('event' in payload)
        || !(payload.event instanceof CustomEvent)
        || (payload.event.type !== BlockChangedMutationType && payload.event.type !== BlockAddedMutationType)) {
        return;
      }
      const detail: unknown = payload.event.detail;

      if (typeof detail !== 'object' || detail === null || !('target' in detail)
        || typeof detail.target !== 'object' || detail.target === null
        || !('id' in detail.target) || typeof detail.target.id !== 'string') {
        return;
      }
      details.set(payload.event.type + ':' + detail.target.id, detail);
    };

    editor.EventsAPI.methods.on(BlockChanged, onChange);
    cleanups.push(() => editor.EventsAPI.methods.off(BlockChanged, onChange));
    const session = createEditorAgentSession(editor, actor, optOut
      ? { turnId: 'attribution-turn', attributeLastEditedBy: false }
      : { turnId: 'attribution-turn' });

    sessions.push(session);
    const result = await session.execute({ commands: [
      { name: 'block.insert', args: { id: 'inserted', type: 'paragraph', data: { text: [{ text: 'Session insert' }] } } },
      { name: 'block.update', args: { id: 'p', data: { text: [{ text: 'Session update' }] } } },
    ] });

    await settle(editor);
    const insertedLive = editor.BlockManager.getBlockById('inserted');
    const updatedLive = editor.BlockManager.getBlockById('p');
    const shared = editor.YjsManager.toJSON();
    const insertedShared = shared.find(block => block.id === 'inserted');
    const updatedShared = shared.find(block => block.id === 'p');
    const output = await editor.Saver.save();
    const insertedSaved = output?.blocks.find(block => block.id === 'inserted');
    const updatedSaved = output?.blocks.find(block => block.id === 'p');

    expect(insertedLive?.lastEditedBy).toBe(expectedEditor);
    expect(insertedShared?.lastEditedBy).toBe(expectedEditor);
    expect(insertedSaved?.lastEditedBy).toBe(expectedEditor);
    expect(updatedLive?.lastEditedBy).toBe(expectedEditor);
    expect(updatedShared?.lastEditedBy).toBe(expectedEditor);
    expect(updatedSaved?.lastEditedBy).toBe(expectedEditor);
    expect(insertedShared?.createdBy).toBe(expectedEditor);
    expect(insertedSaved?.createdBy).toBe(expectedEditor);
    await vi.waitFor(() => {
      expect(details.get(BlockAddedMutationType + ':inserted')).toMatchObject({
        target: { id: 'inserted' }, origin: 'local',
        agent: { id: 'agent-1', name: 'Agent', turnId: 'attribution-turn' },
      });
      expect(details.get(BlockChangedMutationType + ':p')).toMatchObject({
        target: { id: 'p' }, origin: 'local',
        agent: { id: 'agent-1', name: 'Agent', turnId: 'attribution-turn' },
      });
    });
    expect(result).toMatchObject({ ok: true });
    expect(insertedLive?.pluginsContent.textContent).toBe('Session insert');
    expect(editor.YjsManager.richSegmentsOf(insertedShared?.data.text)).toEqual([{ text: 'Session insert' }]);
    expect(insertedSaved?.data.text).toEqual([{ text: 'Session insert' }]);
    expect(updatedLive?.pluginsContent.textContent).toBe('Session update');
    expect(editor.YjsManager.richSegmentsOf(updatedShared?.data.text)).toEqual([{ text: 'Session update' }]);
    expect(updatedSaved?.data.text).toEqual([{ text: 'Session update' }]);
  }, 60_000);

  it('passes a supplied service to a custom fixture prepare and applies its visible edit', async () => {
    if (holder === undefined || core !== undefined) {
      throw new Error('The service fixture needs an unused test holder.');
    }
    const calls: Array<Parameters<PageBackendService['rename']>[0]> = [];
    const serviceRecord = { blockId: 'service-note', title: 'Seed' };
    let observedService: unknown;
    const pageBackend: PageBackendService = {
      rename: async input => {
        if (input.blockId !== serviceRecord.blockId) {
          throw new Error('The service received an unknown fixture record.');
        }
        calls.push({ ...input });
        serviceRecord.title = input.title;

        return { title: serviceRecord.title };
      },
      setIcon: async () => {
        throw new Error('This fixture does not change icons.');
      },
    };
    const isPageBackend = (value: unknown): value is PageBackendService =>
      typeof value === 'object' && value !== null &&
      'rename' in value && typeof value.rename === 'function' &&
      'setIcon' in value && typeof value.setIcon === 'function';

    class ServiceFixtureParagraph extends Paragraph {
      public static describe = (): BlockToolDescription => ({
        ...Paragraph.describe(),
        summary: 'A custom fixture that projects a service title into visible text.',
        actions: [{
          name: 'applyTitle', summary: 'Apply the service title.', target: 'block',
          effects: 'host', requires: ['pageBackend'],
          args: {
            type: 'object', required: ['title'], additionalProperties: false,
            properties: { title: { type: 'string' } },
          },
        }],
      });

      public static actionHandlers: Readonly<Record<string, ToolActionImpl>> = {
        applyTitle: {
          prepare: async ({ services }, args) => {
            if (typeof args !== 'object' || args === null ||
              !('id' in args) || typeof args.id !== 'string' ||
              !('title' in args) || typeof args.title !== 'string') {
              throw failure('INVALID_ARGS', 'Expected a block id and title.');
            }
            observedService = services.pageBackend;
            if (!isPageBackend(services.pageBackend)) {
              throw failure('COMMAND_UNAVAILABLE', 'The fixture service is absent.');
            }

            return services.pageBackend.rename({ blockId: args.id, title: args.title });
          },
          run: (ctx, _args, prepared) => {
            if (ctx.block === undefined || typeof prepared !== 'object' || prepared === null ||
              !('title' in prepared) || typeof prepared.title !== 'string') {
              return ctx.fail('INVALID_ARGS', 'Expected a prepared title for the fixture block.');
            }
            ctx.setRichText(ctx.block.id, 'text', [{ text: prepared.title }]);

            return { id: ctx.block.id, title: prepared.title };
          },
        },
      };
    }

    const instance = new Core({
      holder, tabSync: false, i18n: { locale: 'en' },
      user: { id: 'human-1', name: 'Human' },
      tools: {
        paragraph: { class: Paragraph },
        servicefixture: { class: ServiceFixtureParagraph },
      },
      data: { blocks: [
        { id: 'service-note', type: 'servicefixture', data: { text: [{ text: 'Seed' }] } },
      ] },
    });

    core = instance;
    await instance.isReady;
    ready = true;
    const editor = instance.moduleInstances;

    await settle(editor);
    const session = createEditorAgentSession(editor, actor, { services: { pageBackend } });

    sessions.push(session);
    const result = await session.execute({ commands: [{
      name: 'servicefixture.applyTitle',
      args: { id: 'service-note', title: 'Service supplied title.' },
    }] });

    await settle(editor);
    const live = editor.BlockManager.getBlockById('service-note');
    const shared = editor.YjsManager.toJSON().find(block => block.id === 'service-note');
    const output = await editor.Saver.save();
    const persisted = output?.blocks.find(block => block.id === 'service-note');

    expect(live?.pluginsContent.textContent).toBe('Service supplied title.');
    expect(editor.YjsManager.richSegmentsOf(shared?.data.text)).toEqual([{ text: 'Service supplied title.' }]);
    expect(persisted?.data.text).toEqual([{ text: 'Service supplied title.' }]);
    expect(result).toMatchObject({
      ok: true, results: [{ id: 'service-note', title: 'Service supplied title.' }],
    });
    expect(serviceRecord.title).toBe('Service supplied title.');
    const described = session.describe({ command: 'servicefixture.applyTitle' });

    if (!('command' in described)) {
      throw new Error('Expected the fixture command description.');
    }
    expect(described.command.available).toBe(true);
    expect(observedService).toBe(pageBackend);
    expect(calls).toEqual([{ blockId: 'service-note', title: 'Service supplied title.' }]);
  }, 60_000);

  it('returns CONFLICT without undoing older human work when a peer occupies its own replacement', async () => {
    const editor = await boot();
    const session = openSession(editor);
    const originalTitle = editor.YjsManager.getPageFields().title;

    expect(editor.YjsManager.canUndo()).toBe(false);
    editor.YjsManager.beginGesture('discrete');
    editor.YjsManager.setPageField('title', 'Human title');
    await settle(editor);
    const humanToken = editor.YjsManager.topUndoToken();

    expect(humanToken).toBeDefined();
    expect(editor.YjsManager.undoStepTag(humanToken)).toBeUndefined();
    expect(editor.YjsManager.getPageFields().title).toBe('Human title');
    expect(editor.YjsManager.topRedoToken()).toBeUndefined();

    const written = await session.execute({ commands: [
      { name: 'block.insert', args: { id: 'n', type: 'paragraph', data: { text: [] } } },
      { name: 'block.delete', args: { id: 'p' } },
    ] });

    await settle(editor);
    const ownToken = editor.YjsManager.topUndoToken();

    expect(written).toMatchObject({ ok: true });
    expect(ownToken).toBeDefined();
    expect(ownToken).not.toBe(humanToken);
    expect(editor.YjsManager.undoStepTag(ownToken)).toEqual({
      actorId: actor.id, sessionId: session.id,
    });
    expect(editor.YjsManager.undoStepTag(humanToken)).toBeUndefined();
    expect(saved(editor)).toEqual([{ id: 'n', type: 'paragraph', text: [] }]);
    expect(editor.BlockManager.getBlockById('p')).toBeUndefined();
    if (ownToken === undefined) {
      throw new Error('Expected a native session undo token.');
    }

    const peer = new DocumentStore(new YBlockSerializer());

    try {
      peer.applyRemoteUpdate(editor.YjsManager.encodeStateAsUpdate(peer.getStateVector()));
      expect(peer.updateBlockData('n', 'text', [{ text: 'Peer' }])).toBe(true);
      editor.YjsManager.applyRemoteUpdate(
        peer.encodeStateAsUpdate(editor.YjsManager.getStateVector()),
        peer
      );
      await settle(editor);
      await vi.waitFor(() => {
        expect(editor.BlockManager.getBlockById('n')?.pluginsContent.textContent).toBe('Peer');
      });
      expect(saved(editor)).toEqual([{ id: 'n', type: 'paragraph', text: [{ text: 'Peer' }] }]);
      expect(editor.YjsManager.topUndoToken()).toBe(ownToken);
      expect(editor.YjsManager.getPageFields().title).toBe('Human title');

      const refused = await session.execute({ commands: [{ name: 'history.undo', args: {} }] });

      await settle(editor);
      expect(editor.YjsManager.getPageFields().title).toBe('Human title');
      expect(refused).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
      expect(editor.YjsManager.topUndoToken()).toBe(ownToken);
      expect(editor.YjsManager.topRedoToken()).toBeUndefined();
      expect(editor.YjsManager.undoStepTag(ownToken)).toEqual({
        actorId: actor.id, sessionId: session.id,
      });
      expect(editor.YjsManager.undoStepTag(humanToken)).toBeUndefined();
      expect(editor.BlockManager.blocks.map(block => block.id)).toEqual(['n']);
      expect(editor.BlockManager.getBlockById('p')).toBeUndefined();
      expect(editor.BlockManager.getBlockById('n')?.pluginsContent.textContent).toBe('Peer');
      expect(saved(editor)).toEqual([{ id: 'n', type: 'paragraph', text: [{ text: 'Peer' }] }]);
      const view = await session.read({ detail: 'full' });

      expect(view.page?.title).toBe('Human title');
      expect(view.blocks).toHaveLength(1);
      expect(view.blocks).toMatchObject([
        { id: 'n', type: 'paragraph', data: { text: [{ text: 'Peer' }] } },
      ]);
      const output = await editor.Saver.save();

      expect(output?.title).toBe('Human title');
      expect(output?.blocks.map(block => ({ id: block.id, type: block.type, text: block.data.text })))
        .toEqual([{ id: 'n', type: 'paragraph', text: [{ text: 'Peer' }] }]);

      expect(editor.YjsManager.undoStep(ownToken)).toBe(false);
      await settle(editor);
      expect(editor.YjsManager.getPageFields().title).toBe('Human title');
      expect(editor.YjsManager.topUndoToken()).toBe(ownToken);
      expect(editor.YjsManager.topRedoToken()).toBeUndefined();
      expect(editor.BlockManager.getBlockById('p')).toBeUndefined();
      expect(saved(editor)).toEqual([{ id: 'n', type: 'paragraph', text: [{ text: 'Peer' }] }]);

      editor.YjsManager.undo();
      await settle(editor);
      expect(editor.YjsManager.getPageFields().title).toBe(originalTitle);
      expect(editor.YjsManager.topUndoToken()).toBe(ownToken);
      expect(editor.YjsManager.topRedoToken()).toBe(humanToken);
      expect(editor.YjsManager.undoStepTag(humanToken)).toBeUndefined();
      expect(editor.YjsManager.undoStepTag(ownToken)).toEqual({
        actorId: actor.id, sessionId: session.id,
      });
      expect(editor.BlockManager.getBlockById('p')).toBeUndefined();
      expect(saved(editor)).toEqual([{ id: 'n', type: 'paragraph', text: [{ text: 'Peer' }] }]);

      editor.YjsManager.redo();
      await settle(editor);
      expect(editor.YjsManager.getPageFields().title).toBe('Human title');
      expect(editor.YjsManager.topUndoToken()).toBe(ownToken);
      expect(editor.YjsManager.undoStepTag(ownToken)).toEqual({
        actorId: actor.id, sessionId: session.id,
      });
      expect(saved(editor)).toEqual([{ id: 'n', type: 'paragraph', text: [{ text: 'Peer' }] }]);
    } finally {
      peer.destroy();
    }
  }, 60_000);

});
