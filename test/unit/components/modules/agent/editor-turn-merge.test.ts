import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../../src/components/core';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { createEditorAgentSession } from '../../../../../src/components/modules/agent/editor-session';
import { Listeners } from '../../../../../src/components/utils/listeners';
import { destroy as destroyTooltip } from '../../../../../src/components/utils/tooltip';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Database, DatabaseRow } from '../../../../../src/tools';

import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { OutputData } from '../../../../../types';
import type { AgentActor, AgentApprover, AgentSession } from '../../../../../types/agent';

const actor: AgentActor = { id: 'agent-1', name: 'Agent', kind: 'agent' };
const original = [
  { id: 'p', type: 'paragraph', text: [{ text: 'P' }] },
];
const withA = [
  { id: 'p', type: 'paragraph', text: [{ text: 'P' }] },
  { id: 'a', type: 'paragraph', text: [{ text: 'A' }] },
];
const withAB = [
  { id: 'p', type: 'paragraph', text: [{ text: 'P' }] },
  { id: 'a', type: 'paragraph', text: [{ text: 'A' }] },
  { id: 'b', type: 'paragraph', text: [{ text: 'B' }] },
];
const withABC = [
  { id: 'p', type: 'paragraph', text: [{ text: 'P' }] },
  { id: 'a', type: 'paragraph', text: [{ text: 'A' }] },
  { id: 'b', type: 'paragraph', text: [{ text: 'B' }] },
  { id: 'c', type: 'paragraph', text: [{ text: 'C' }] },
];
const humanWithA = [
  { id: 'p', type: 'paragraph', text: [{ text: 'Human' }] },
  { id: 'a', type: 'paragraph', text: [{ text: 'A' }] },
];
const humanWithAB = [
  { id: 'p', type: 'paragraph', text: [{ text: 'Human' }] },
  { id: 'a', type: 'paragraph', text: [{ text: 'A' }] },
  { id: 'b', type: 'paragraph', text: [{ text: 'B' }] },
];

let holder: HTMLDivElement | undefined;
let core: Core | undefined;
let ready = false;
let contentEditableDescriptor: PropertyDescriptor | undefined;
const sessions: AgentSession[] = [];
const unsubscribers = new Set<() => void>();

const hasDestroy = (value: unknown): value is { destroy(): void | Promise<void> } =>
  typeof value === 'object' && value !== null &&
  'destroy' in value && typeof value.destroy === 'function';

const destroyCore = async (instance: Core): Promise<void> => {
  const modules = Object.values<BlokModules[keyof BlokModules]>({ ...instance.moduleInstances });
  const failures: unknown[] = [];
  const clean = async (run: () => unknown): Promise<void> => {
    try {
      await run();
    } catch (error) {
      failures.push(error);
    }
  };

  for (const module of modules) {
    await clean(() => module.markDestroyed());
  }
  for (const module of modules) {
    const owner: unknown = module;

    if (hasDestroy(owner)) {
      await clean(() => owner.destroy());
    }
    if (typeof owner === 'object' && owner !== null &&
      'listeners' in owner && owner.listeners instanceof Listeners) {
      const listeners = owner.listeners;

      await clean(() => listeners.removeAll());
    }
  }
  await clean(() => destroyTooltip());

  if (failures.length > 0) {
    throw new AggregateError(failures, 'Editor teardown failed.');
  }
};

// API gestures close in a timer task, not a microtask.
const nextTask = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

const settle = async (editor: BlokModules): Promise<void> => {
  await vi.waitFor(() => {
    expect(editor.BlockManager.isSyncingFromYjs).toBe(false);
  }, { timeout: 5_000 });

  let writesSettled = false;
  const unsubscribe = editor.YjsManager.onPendingBlockWritesSettled(() => {
    writesSettled = true;
  });

  unsubscribers.add(unsubscribe);
  try {
    editor.YjsManager.flushPendingBlockWrites();
    await vi.waitFor(() => {
      expect(writesSettled).toBe(true);
      expect(editor.BlockManager.isSyncingFromYjs).toBe(false);
      expect(editor.BlockManager.suppressStopCapturing).toBe(false);
    }, { timeout: 5_000 });
  } finally {
    unsubscribe();
    unsubscribers.delete(unsubscribe);
  }
};

const boot = async (blocks: OutputData['blocks'] = [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] } }]): Promise<BlokModules> => {
  if (holder === undefined || core !== undefined) {
    throw new Error('The editor fixture is not ready to boot.');
  }

  const instance = new Core({
    holder,
    tabSync: false,
    i18n: { locale: 'en' },
    user: { id: 'human-1', name: 'Human' },
    tools: { paragraph: { class: Paragraph }, database: { class: Database }, 'database-row': { class: DatabaseRow } },
    data: { blocks },
  });

  core = instance;
  await instance.isReady;
  ready = true;
  await settle(instance.moduleInstances);

  return instance.moduleInstances;
};

const openSession = (
  editor: BlokModules,
  options: { mergeSteps?: 'batch' | 'turn' } = {}
): AgentSession & { sealSteps(): void } => {
  const session = createEditorAgentSession(editor, actor, options);

  sessions.push(session);

  return session;
};

const saved = (editor: BlokModules) => editor.YjsManager.toJSON().map(block => ({
  id: block.id,
  type: block.type,
  text: editor.YjsManager.richSegmentsOf(block.data.text),
}));

describe('agent turn merge through real Core modules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contentEditableDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'contentEditable');
    // Input lookup uses the attribute; jsdom does not reflect this property.
    Object.defineProperty(HTMLElement.prototype, 'contentEditable', {
      configurable: true,
      get(this: HTMLElement): string {
        return this.getAttribute('contenteditable') ?? 'inherit';
      },
      set(this: HTMLElement, value: string): void {
        this.setAttribute('contenteditable', value);
      },
    });
    ready = false;
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    const failures: unknown[] = [];
    const clean = async (run: () => unknown): Promise<void> => {
      try {
        await run();
      } catch (error) {
        failures.push(error);
      }
    };

    try {
      if (core !== undefined && ready) {
        const editor = core.moduleInstances;

        await clean(() => settle(editor));
      }
      for (const session of sessions.splice(0)) {
        await clean(() => session.close());
      }
      for (const unsubscribe of unsubscribers) {
        await clean(unsubscribe);
      }
      unsubscribers.clear();

      if (core !== undefined) {
        const instance = core;

        await clean(() => instance.isReady.catch(() => undefined));
        await clean(() => destroyCore(instance));
      }
    } finally {
      core = undefined;
      ready = false;
      await clean(() => holder?.remove());
      holder = undefined;
      await clean(() => document.getSelection()?.removeAllRanges());
      await clean(() => vi.restoreAllMocks());
      await clean(() => {
        if (contentEditableDescriptor === undefined) {
          Reflect.deleteProperty(HTMLElement.prototype, 'contentEditable');
        } else {
          Object.defineProperty(HTMLElement.prototype, 'contentEditable', contentEditableDescriptor);
        }
      });
    }

    if (failures.length > 0) {
      throw new AggregateError(failures, 'Editor fixture teardown failed.');
    }
  });

  it('R-U1: two separated batches of one turn share one native undo', async () => {
    const editor = await boot();
    const session = openSession(editor, { mergeSteps: 'turn' });

    expect(await session.execute({ commands: [
      { name: 'block.insert', args: { id: 'a', type: 'paragraph', position: 'end', data: { text: 'A' } } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    expect(saved(editor)).toEqual(withA);
    const firstToken = editor.YjsManager.topUndoToken();
    const gesturesAtClose = editor.YjsManager.gestureCount();

    expect(firstToken).toBeDefined();
    expect(editor.YjsManager.undoStepTag(firstToken)).toEqual({
      actorId: actor.id, sessionId: session.id,
    });

    await nextTask();
    expect(editor.YjsManager.topUndoToken()).toBe(firstToken);
    expect(editor.YjsManager.gestureCount()).toBe(gesturesAtClose);
    expect(await session.execute({ commands: [
      { name: 'block.insert', args: { id: 'b', type: 'paragraph', position: 'end', data: { text: 'B' } } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    expect(saved(editor)).toEqual(withAB);
    const secondToken = editor.YjsManager.topUndoToken();

    expect(secondToken).toBeDefined();
    expect(editor.YjsManager.undoStepTag(secondToken)).toEqual({
      actorId: actor.id, sessionId: session.id,
    });

    editor.YjsManager.undo();
    await settle(editor);

    expect(saved(editor)).toEqual(original);
    expect(editor.YjsManager.canUndo()).toBe(false);
    expect(editor.YjsManager.topUndoToken()).toBeUndefined();
    // The batches stay separate steps until the user's undo joins them.
    expect(secondToken).not.toBe(firstToken);
    expect(editor.YjsManager.topRedoToken()).toBe(firstToken);
    expect(editor.YjsManager.undoStepTag(editor.YjsManager.topRedoToken())).toEqual({
      actorId: actor.id, sessionId: session.id,
    });
  }, 60_000);

  it('history.undo takes back one batch of a turn, and a human gesture joins the rest into one step', async () => {
    const editor = await boot();
    const session = openSession(editor, { mergeSteps: 'turn' });

    const tokens = [];

    for (const id of ['a', 'b', 'c']) {
      expect(await session.execute({ commands: [
        { name: 'block.insert', args: { id, type: 'paragraph', position: 'end', data: { text: id.toUpperCase() } } },
      ] })).toMatchObject({ ok: true });
      await settle(editor);
      tokens.push(editor.YjsManager.topUndoToken());
      await nextTask();
    }
    expect(await session.execute({ commands: [{ name: 'history.undo', args: {} }] })).toMatchObject({ ok: true });
    await settle(editor);
    expect(saved(editor)).toEqual(withAB);

    editor.YjsManager.beginGesture('discrete');
    expect(editor.YjsManager.topUndoToken()).toBe(tokens[0]);
    editor.YjsManager.undo();
    await settle(editor);
    expect(saved(editor)).toEqual(original);
    expect(editor.YjsManager.canUndo()).toBe(false);
  }, 60_000);

  it('R-U3: a human gesture splits the turn even without a content write', async () => {
    const editor = await boot();
    const session = openSession(editor, { mergeSteps: 'turn' });

    expect(await session.execute({ commands: [
      { name: 'block.insert', args: { id: 'a', type: 'paragraph', position: 'end', data: { text: 'A' } } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    expect(saved(editor)).toEqual(withA);
    const firstToken = editor.YjsManager.topUndoToken();
    const gesturesAtClose = editor.YjsManager.gestureCount();

    expect(firstToken).toBeDefined();
    expect(editor.YjsManager.undoStepTag(firstToken)).toEqual({
      actorId: actor.id, sessionId: session.id,
    });

    await nextTask();
    editor.YjsManager.beginGesture('discrete');
    await nextTask();
    expect(saved(editor)).toEqual(withA);
    expect(editor.YjsManager.topUndoToken()).toBe(firstToken);
    expect(editor.YjsManager.gestureCount()).toBe(gesturesAtClose + 1);

    expect(await session.execute({ commands: [
      { name: 'block.insert', args: { id: 'b', type: 'paragraph', position: 'end', data: { text: 'B' } } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    expect(saved(editor)).toEqual(withAB);
    const secondToken = editor.YjsManager.topUndoToken();

    expect(secondToken).toBeDefined();
    expect(editor.YjsManager.undoStepTag(secondToken)).toEqual({
      actorId: actor.id, sessionId: session.id,
    });

    editor.YjsManager.undo();
    await settle(editor);

    expect(saved(editor)).toEqual(withA);
    expect(secondToken).not.toBe(firstToken);
    expect(editor.YjsManager.topUndoToken()).toBe(firstToken);
    expect(editor.YjsManager.topRedoToken()).toBe(secondToken);
    expect(editor.YjsManager.undoStepTag(editor.YjsManager.topUndoToken())).toEqual({
      actorId: actor.id, sessionId: session.id,
    });

    editor.YjsManager.undo();
    await settle(editor);

    expect(saved(editor)).toEqual(original);
    expect(editor.YjsManager.canUndo()).toBe(false);
    expect(editor.YjsManager.topUndoToken()).toBeUndefined();
  }, 60_000);

  it('keeps an actual human edit separate and preserves it when undoing the next batch', async () => {
    const editor = await boot();
    const session = openSession(editor, { mergeSteps: 'turn' });

    expect(await session.execute({ commands: [
      { name: 'block.insert', args: { id: 'a', type: 'paragraph', position: 'end', data: { text: 'A' } } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    expect(saved(editor)).toEqual(withA);
    const firstToken = editor.YjsManager.topUndoToken();
    const gesturesAtClose = editor.YjsManager.gestureCount();

    expect(firstToken).toBeDefined();
    expect(editor.YjsManager.undoStepTag(firstToken)).toEqual({
      actorId: actor.id, sessionId: session.id,
    });

    await nextTask();
    editor.YjsManager.beginGesture('discrete');
    await editor.API.methods.blocks.update('p', { text: [{ text: 'Human' }] });
    await settle(editor);
    expect(saved(editor)).toEqual(humanWithA);
    const humanToken = editor.YjsManager.topUndoToken();

    expect(humanToken).toBeDefined();
    expect(humanToken).not.toBe(firstToken);
    expect(editor.YjsManager.undoStepTag(humanToken)).toBeUndefined();
    expect(editor.YjsManager.gestureCount()).toBeGreaterThan(gesturesAtClose);

    await nextTask();
    expect(await session.execute({ commands: [
      { name: 'block.insert', args: { id: 'b', type: 'paragraph', position: 'end', data: { text: 'B' } } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    expect(saved(editor)).toEqual(humanWithAB);
    const secondToken = editor.YjsManager.topUndoToken();

    expect(secondToken).toBeDefined();
    expect(editor.YjsManager.undoStepTag(secondToken)).toEqual({
      actorId: actor.id, sessionId: session.id,
    });

    editor.YjsManager.undo();
    await settle(editor);

    expect(saved(editor)).toEqual(humanWithA);
    expect(secondToken).not.toBe(humanToken);
    expect(secondToken).not.toBe(firstToken);
    expect(editor.YjsManager.topUndoToken()).toBe(humanToken);
    expect(editor.YjsManager.topRedoToken()).toBe(secondToken);
    expect(editor.YjsManager.undoStepTag(editor.YjsManager.topUndoToken())).toBeUndefined();

    editor.YjsManager.undo();
    await settle(editor);

    expect(saved(editor)).toEqual(withA);
    expect(editor.YjsManager.topUndoToken()).toBe(firstToken);
    expect(editor.YjsManager.topRedoToken()).toBe(humanToken);

    editor.YjsManager.undo();
    await settle(editor);

    expect(saved(editor)).toEqual(original);
    expect(editor.YjsManager.canUndo()).toBe(false);
    expect(editor.YjsManager.topUndoToken()).toBeUndefined();
  }, 60_000);

  it('does not join another session with the same actor, including when the first resumes', async () => {
    const editor = await boot();
    const first = openSession(editor, { mergeSteps: 'turn' });
    const other = openSession(editor, { mergeSteps: 'turn' });

    expect(other.id).not.toBe(first.id);
    expect(other.actor).toEqual(first.actor);
    expect(await first.execute({ commands: [
      { name: 'block.insert', args: { id: 'a', type: 'paragraph', position: 'end', data: { text: 'A' } } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    expect(saved(editor)).toEqual(withA);
    const firstToken = editor.YjsManager.topUndoToken();

    expect(firstToken).toBeDefined();
    expect(editor.YjsManager.undoStepTag(firstToken)).toEqual({
      actorId: actor.id, sessionId: first.id,
    });

    await nextTask();
    expect(await other.execute({ commands: [
      { name: 'block.insert', args: { id: 'b', type: 'paragraph', position: 'end', data: { text: 'B' } } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    expect(saved(editor)).toEqual(withAB);
    const otherToken = editor.YjsManager.topUndoToken();

    expect(otherToken).toBeDefined();
    expect(otherToken).not.toBe(firstToken);
    expect(editor.YjsManager.undoStepTag(otherToken)).toEqual({
      actorId: actor.id, sessionId: other.id,
    });
    expect(editor.YjsManager.undoStepTag(firstToken)).toEqual({
      actorId: actor.id, sessionId: first.id,
    });

    await nextTask();
    expect(await first.execute({ commands: [
      { name: 'block.insert', args: { id: 'c', type: 'paragraph', position: 'end', data: { text: 'C' } } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    expect(saved(editor)).toEqual(withABC);
    const resumedToken = editor.YjsManager.topUndoToken();

    expect(resumedToken).toBeDefined();
    expect(editor.YjsManager.undoStepTag(resumedToken)).toEqual({
      actorId: actor.id, sessionId: first.id,
    });
    expect(editor.YjsManager.undoStepTag(otherToken)).toEqual({
      actorId: actor.id, sessionId: other.id,
    });

    editor.YjsManager.undo();
    await settle(editor);

    expect(saved(editor)).toEqual(withAB);
    expect(resumedToken).not.toBe(firstToken);
    expect(resumedToken).not.toBe(otherToken);
    expect(editor.YjsManager.topUndoToken()).toBe(otherToken);
    expect(editor.YjsManager.topRedoToken()).toBe(resumedToken);
    expect(editor.YjsManager.undoStepTag(editor.YjsManager.topUndoToken())).toEqual({
      actorId: actor.id, sessionId: other.id,
    });

    editor.YjsManager.undo();
    await settle(editor);

    expect(saved(editor)).toEqual(withA);
    expect(editor.YjsManager.topUndoToken()).toBe(firstToken);
    expect(editor.YjsManager.topRedoToken()).toBe(otherToken);
    expect(editor.YjsManager.undoStepTag(editor.YjsManager.topUndoToken())).toEqual({
      actorId: actor.id, sessionId: first.id,
    });

    editor.YjsManager.undo();
    await settle(editor);

    expect(saved(editor)).toEqual(original);
    expect(editor.YjsManager.canUndo()).toBe(false);
    expect(editor.YjsManager.topUndoToken()).toBeUndefined();
  }, 60_000);

  it('keeps separated batches as separate steps when mergeSteps is omitted', async () => {
    const editor = await boot();
    const session = openSession(editor);

    expect(await session.execute({ commands: [
      { name: 'block.insert', args: { id: 'a', type: 'paragraph', position: 'end', data: { text: 'A' } } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    expect(saved(editor)).toEqual(withA);
    const firstToken = editor.YjsManager.topUndoToken();

    expect(firstToken).toBeDefined();
    expect(editor.YjsManager.undoStepTag(firstToken)).toEqual({
      actorId: actor.id, sessionId: session.id,
    });

    await nextTask();
    expect(await session.execute({ commands: [
      { name: 'block.insert', args: { id: 'b', type: 'paragraph', position: 'end', data: { text: 'B' } } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    expect(saved(editor)).toEqual(withAB);
    const secondToken = editor.YjsManager.topUndoToken();

    expect(secondToken).toBeDefined();
    expect(editor.YjsManager.undoStepTag(secondToken)).toEqual({
      actorId: actor.id, sessionId: session.id,
    });

    editor.YjsManager.undo();
    await settle(editor);

    expect(saved(editor)).toEqual(withA);
    expect(secondToken).not.toBe(firstToken);
    expect(editor.YjsManager.topUndoToken()).toBe(firstToken);
    expect(editor.YjsManager.topRedoToken()).toBe(secondToken);

    editor.YjsManager.undo();
    await settle(editor);

    expect(saved(editor)).toEqual(original);
    expect(editor.YjsManager.canUndo()).toBe(false);
    expect(editor.YjsManager.topUndoToken()).toBeUndefined();
  }, 60_000);

  it('keeps the earlier turn step when a later batch fails after a real insert', async () => {
    const editor = await boot();
    const session = openSession(editor, { mergeSteps: 'turn' });

    expect(await session.execute({ commands: [
      { name: 'block.insert', args: { id: 'a', type: 'paragraph', position: 'end', data: { text: 'A' } } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    expect(saved(editor)).toEqual(withA);
    const firstToken = editor.YjsManager.topUndoToken();

    expect(firstToken).toBeDefined();
    await nextTask();
    let sawInserted = false;
    const update = vi.spyOn(editor.BlockManager, 'update').mockImplementation(async () => {
      sawInserted = editor.YjsManager.toJSON().some(block => block.id === 'b');
      throw new Error('The fixture refuses this write.');
    });
    const result = await session.execute({ commands: [
      { name: 'block.insert', args: { id: 'b', type: 'paragraph', position: 'end', data: { text: 'B' } } },
      { name: 'block.update', args: { id: 'p', data: { text: [{ text: 'Refused' }] } } },
    ] });

    update.mockRestore();
    await settle(editor);
    expect(saved(editor)).toEqual(withA);
    expect(result).toMatchObject({ ok: false, error: { code: 'APPLY_FAILED' } });
    expect(sawInserted).toBe(true);
    expect(editor.YjsManager.topUndoToken()).toBe(firstToken);
    expect(editor.YjsManager.undoStepTag(firstToken)).toEqual({ actorId: actor.id, sessionId: session.id });
    editor.YjsManager.undo();
    await settle(editor);
    expect(saved(editor)).toEqual(original);
    expect(editor.YjsManager.canUndo()).toBe(false);
  }, 60_000);

  it('replays a turn with cross-batch deletes, placements, rich text, tunes and title through session history', async () => {
    const editor = await boot();

    await editor.API.methods.blocks.render({
      title: 'Baseline',
      blocks: [
        { id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] } },
        { id: 'l', type: 'paragraph', data: { text: [{ text: 'L' }] } },
        { id: 'd', type: 'paragraph', data: { text: [{ text: 'D' }] } },
        { id: 'r', type: 'paragraph', data: { text: [{ text: 'R' }] } },
      ],
    });
    await settle(editor);
    const session = openSession(editor, { mergeSteps: 'turn' });
    const state = () => ({
      title: editor.YjsManager.getPageFields().title ?? '',
      blocks: editor.YjsManager.toJSON().map(block => ({
        id: block.id,
        parent: block.parent ?? null,
        children: block.content ?? [],
        text: editor.YjsManager.richSegmentsOf(block.data.text),
        tune: block.tunes?.absentTune ?? null,
      })),
    });
    const baseline = {
      title: 'Baseline',
      blocks: [
        { id: 'p', parent: null, children: [], text: [{ text: 'P' }], tune: null },
        { id: 'l', parent: null, children: [], text: [{ text: 'L' }], tune: null },
        { id: 'd', parent: null, children: [], text: [{ text: 'D' }], tune: null },
        { id: 'r', parent: null, children: [], text: [{ text: 'R' }], tune: null },
      ],
    };
    const final = {
      title: 'Final',
      blocks: [
        { id: 'a', parent: null, children: ['c', 'r'], text: [{ text: 'A' }], tune: { value: 'final' } },
        { id: 'c', parent: 'a', children: [], text: [{ text: 'Child' }], tune: null },
        { id: 'r', parent: 'a', children: [], text: [{ text: 'R' }], tune: null },
        { id: 'p', parent: null, children: [], text: [{ text: 'Final P', marks: { bold: true } }], tune: null },
        { id: 'l', parent: null, children: [], text: [{ text: 'L' }], tune: null },
      ],
    };

    expect(state()).toEqual(baseline);
    expect(editor.YjsManager.topUndoToken()).toBeUndefined();
    expect(await session.execute({ commands: [
      { name: 'block.insert', args: {
        id: 'a', type: 'paragraph', position: 'end', data: { text: 'A' },
        tunes: { absentTune: { value: 'seed' } },
        children: [{ id: 'c', type: 'paragraph', data: { text: 'Child' } }],
      } },
      { name: 'block.insert', args: { id: 'temp', type: 'paragraph', position: 'end', data: { text: 'Temporary' } } },
      { name: 'block.update', args: { id: 'p', data: { text: 'First P' } } },
      { name: 'doc.setTitle', args: { title: 'First' } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    const token = editor.YjsManager.topUndoToken();

    expect(token).toBeDefined();
    await nextTask();
    expect(await session.execute({ commands: [
      { name: 'block.delete', args: { id: 'temp' } },
      { name: 'block.delete', args: { id: 'd' } },
      { name: 'block.move', args: { id: 'l', parentId: null, position: 'end' } },
      { name: 'block.move', args: { id: 'l', parentId: null, position: { after: 'p' } } },
      { name: 'block.move', args: { id: 'r', parentId: 'a', position: 'end' } },
      { name: 'block.update', args: { id: 'p', data: { text: [{ text: 'Final P', marks: { bold: true } }] } } },
      { name: 'block.update', args: { id: 'a', tunes: { absentTune: { value: 'final' } } } },
      { name: 'doc.setTitle', args: { title: 'Final' } },
      { name: 'block.move', args: { id: 'a', parentId: null, position: 'start' } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    expect(state()).toEqual(final);
    for (const id of ['a', 'c', 'r']) {
      const blockHolder = editor.BlockManager.getBlockById(id)?.holder;

      expect(blockHolder?.isConnected).toBe(true);
      expect(blockHolder?.parentElement).toBe(editor.UI.nodes.redactor);
    }

    session.sealSteps();
    const otherSession = openSession(editor, { mergeSteps: 'turn' });
    const tokenBeforeOtherUndo = editor.YjsManager.topUndoToken();
    const otherUndo = await otherSession.execute({ commands: [{ name: 'history.undo', args: {} }] });

    await settle(editor);
    expect(state()).toEqual(final);
    expect(otherUndo).toMatchObject({ ok: false, error: { code: 'UNDO_NOT_OWN' } });
    expect(editor.YjsManager.topUndoToken()).toBe(tokenBeforeOtherUndo);
    expect(editor.YjsManager.undoStepTag(editor.YjsManager.topUndoToken())).toEqual({
      actorId: actor.id, sessionId: session.id,
    });

    const undone = await session.execute({ commands: [{ name: 'history.undo', args: {} }] });

    await settle(editor);
    expect(state()).toEqual(baseline);
    expect(undone).toMatchObject({ ok: true });
    const restoredD = editor.BlockManager.getBlockById('d');
    const restoredL = editor.BlockManager.getBlockById('l');
    const restoredR = editor.BlockManager.getBlockById('r');

    if (restoredD === undefined || restoredL === undefined || restoredR === undefined) {
      throw new Error('Undo lost a restored neighbor.');
    }
    expect(restoredD.holder.isConnected).toBe(true);
    expect(restoredL.holder.isConnected).toBe(true);
    expect(restoredR.holder.isConnected).toBe(true);
    expect(restoredD.holder.previousElementSibling).toBe(restoredL.holder);
    expect(restoredD.holder.nextElementSibling).toBe(restoredR.holder);
    expect(editor.YjsManager.topUndoToken()).toBeUndefined();
    expect(editor.YjsManager.canUndo()).toBe(false);
    expect(editor.YjsManager.topRedoToken()).toBe(token);
    expect(editor.YjsManager.undoStepTag(editor.YjsManager.topRedoToken())).toEqual({
      actorId: actor.id, sessionId: session.id,
    });

    const otherRedo = await otherSession.execute({ commands: [{ name: 'history.redo', args: {} }] });

    await settle(editor);
    expect(state()).toEqual(baseline);
    expect(otherRedo).toMatchObject({ ok: false, error: { code: 'UNDO_NOT_OWN' } });
    expect(editor.YjsManager.topRedoToken()).toBe(token);
    expect(editor.YjsManager.undoStepTag(editor.YjsManager.topRedoToken())).toEqual({
      actorId: actor.id, sessionId: session.id,
    });

    const redone = await session.execute({ commands: [{ name: 'history.redo', args: {} }] });

    await settle(editor);
    expect(state()).toEqual(final);
    expect(redone).toMatchObject({ ok: true });
    expect(editor.BlockManager.getBlockById('temp')).toBeUndefined();
    expect(editor.BlockManager.getBlockById('d')).toBeUndefined();
    expect(editor.YjsManager.topUndoToken()).toBe(token);
    expect(editor.YjsManager.topRedoToken()).toBeUndefined();
    expect(editor.YjsManager.undoStepTag(editor.YjsManager.topUndoToken())).toEqual({
      actorId: actor.id, sessionId: session.id,
    });

    const undoneAgain = await session.execute({ commands: [{ name: 'history.undo', args: {} }] });

    await settle(editor);
    expect(state()).toEqual(baseline);
    expect(undoneAgain).toMatchObject({ ok: true });
    expect(editor.YjsManager.canUndo()).toBe(false);
    expect(editor.YjsManager.topRedoToken()).toBe(token);
    expect(editor.YjsManager.undoStepTag(editor.YjsManager.topRedoToken())).toEqual({
      actorId: actor.id, sessionId: session.id,
    });
  }, 60_000);

  it('preserves three successful turn batches when the fourth fails after real writes', async () => {
    const editor = await boot();
    const session = openSession(editor, { mergeSteps: 'turn' });

    expect(await session.execute({ commands: [
      { name: 'block.insert', args: { id: 'a', type: 'paragraph', position: 'end', data: { text: 'A' } } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    const token = editor.YjsManager.topUndoToken();

    expect(token).toBeDefined();
    await nextTask();
    expect(await session.execute({ commands: [
      { name: 'block.insert', args: { id: 'b', type: 'paragraph', position: 'end', data: { text: 'B' } } },
      { name: 'block.update', args: { id: 'p', data: { text: 'Second' } } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    await nextTask();
    expect(await session.execute({ commands: [
      { name: 'block.insert', args: { id: 'c', type: 'paragraph', position: 'end', data: { text: 'C' } } },
      { name: 'block.update', args: { id: 'p', data: { text: [{ text: 'Third', marks: { bold: true } }] } } },
      { name: 'doc.setTitle', args: { title: 'Successful turn' } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    const successful = [
      { id: 'p', type: 'paragraph', text: [{ text: 'Third', marks: { bold: true } }] },
      { id: 'a', type: 'paragraph', text: [{ text: 'A' }] },
      { id: 'b', type: 'paragraph', text: [{ text: 'B' }] },
      { id: 'c', type: 'paragraph', text: [{ text: 'C' }] },
    ];
    const successfulOutput = structuredClone(editor.YjsManager.toJSON());

    expect(saved(editor)).toEqual(successful);
    await nextTask();
    let sawPartial = false;
    const nativeUpdate = editor.BlockManager.update.bind(editor.BlockManager);
    const update = vi.spyOn(editor.BlockManager, 'update').mockImplementation(async (block, ...args) => {
      if (block.id === 'c') {
        const written = saved(editor);
        const paragraphData = written.find(item => item.id === 'p')?.text;
        const firstSegment = paragraphData?.[0];

        sawPartial = written.some(item => item.id === 'd')
          && firstSegment !== undefined && 'text' in firstSegment && firstSegment.text === 'Failed P'
          && editor.YjsManager.getBlockPlacement('b')?.parentId === 'a'
          && editor.YjsManager.getPageFields().title === 'Failed title';
        throw new Error('The fixture refuses the final write.');
      }

      return nativeUpdate(block, ...args);
    });
    const result = await session.execute({ commands: [
      { name: 'block.update', args: { id: 'p', data: { text: 'Failed P' } } },
      { name: 'block.insert', args: { id: 'd', type: 'paragraph', position: 'end', data: { text: 'D' } } },
      { name: 'block.move', args: { id: 'b', parentId: 'a', position: 'end' } },
      { name: 'block.update', args: { id: 'a', tunes: { absentTune: { value: 'failed' } } } },
      { name: 'doc.setTitle', args: { title: 'Failed title' } },
      { name: 'block.update', args: { id: 'c', data: { text: 'Refused' } } },
    ] }).finally(() => update.mockRestore());

    await settle(editor);
    expect(saved(editor)).toEqual(successful);
    expect(editor.YjsManager.toJSON()).toEqual(successfulOutput);
    expect(editor.YjsManager.getPageFields().title).toBe('Successful turn');
    expect(editor.YjsManager.getBlockPlacement('b')).toEqual({ parentId: null, afterId: 'a' });
    expect(result).toMatchObject({ ok: false, error: { code: 'APPLY_FAILED' } });
    expect(sawPartial).toBe(true);
    session.sealSteps();
    expect(editor.YjsManager.topUndoToken()).toBe(token);
    expect(editor.YjsManager.undoStepTag(editor.YjsManager.topUndoToken())).toEqual({
      actorId: actor.id, sessionId: session.id,
    });
    expect(editor.BlockManager.suppressStopCapturing).toBe(false);

    const undone = await session.execute({ commands: [{ name: 'history.undo', args: {} }] });

    await settle(editor);
    expect(saved(editor)).toEqual(original);
    expect(editor.YjsManager.getPageFields().title ?? '').toBe('');
    expect(undone).toMatchObject({ ok: true });
    expect(editor.YjsManager.canUndo()).toBe(false);
    expect(editor.YjsManager.topRedoToken()).toBe(token);
    expect(editor.YjsManager.undoStepTag(editor.YjsManager.topRedoToken())).toEqual({
      actorId: actor.id, sessionId: session.id,
    });
  }, 60_000);

  it('splits a turn when a human gestures during an awaited tool update and releases capture', async () => {
    let enter = (): void => {};
    let release = (): void => {};
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const waiting = new Promise<void>(resolve => { release = resolve; });

    class AwaitedParagraph extends Paragraph {
      public async setData(data: Record<string, unknown>): Promise<boolean> {
        enter();
        await waiting;
        if (typeof data.text !== 'string') {
          throw new Error('The awaited paragraph expects HTML text.');
        }
        this.render().innerHTML = data.text;

        return true;
      }
    }

    if (holder === undefined || core !== undefined) {
      throw new Error('The editor fixture is not ready to boot.');
    }
    const instance = new Core({
      holder,
      tabSync: false,
      i18n: { locale: 'en' },
      user: { id: 'human-1', name: 'Human' },
      tools: { paragraph: { class: AwaitedParagraph } },
      data: { blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] } }] },
    });

    core = instance;
    await instance.isReady;
    ready = true;
    const editor = instance.moduleInstances;

    await settle(editor);
    const session = openSession(editor, { mergeSteps: 'turn' });

    expect(await session.execute({ commands: [
      { name: 'block.insert', args: { id: 'a', type: 'paragraph', position: 'end', data: { text: 'A' } } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    const firstToken = editor.YjsManager.topUndoToken();
    const gesturesAtClose = editor.YjsManager.gestureCount();

    expect(firstToken).toBeDefined();
    await nextTask();
    expect(editor.YjsManager.gestureCount()).toBe(gesturesAtClose);
    let finished = false;
    const applying = session.execute({ commands: [
      { name: 'block.update', args: { id: 'p', data: { text: 'Second' } } },
    ] }).then(result => {
      finished = true;

      return result;
    });

    try {
      await Promise.race([entered, applying]);
      expect(finished).toBe(false);
      expect(saved(editor)).toEqual(withA);
      expect(editor.BlockManager.suppressStopCapturing).toBe(true);
      const gesturesDuringApply = editor.YjsManager.gestureCount();

      editor.YjsManager.beginGesture('discrete');
      expect(editor.YjsManager.gestureCount()).toBe(gesturesDuringApply + 1);
      expect(saved(editor)).toEqual(withA);
      release();
      expect(await applying).toMatchObject({ ok: true });
    } finally {
      release();
      await applying.catch(() => undefined);
    }
    await settle(editor);
    const secondToken = editor.YjsManager.topUndoToken();
    const afterSecond = [
      { id: 'p', type: 'paragraph', text: [{ text: 'Second' }] },
      { id: 'a', type: 'paragraph', text: [{ text: 'A' }] },
    ];

    expect(saved(editor)).toEqual(afterSecond);
    expect(secondToken).toBeDefined();
    expect(secondToken).not.toBe(firstToken);
    expect(editor.YjsManager.undoStepTag(secondToken)).toEqual({
      actorId: actor.id, sessionId: session.id,
    });
    expect(editor.BlockManager.suppressStopCapturing).toBe(false);
    await nextTask();
    const gesturesBeforeHuman = editor.YjsManager.gestureCount();

    // An explicit gesture would hide a leaked capture hold.
    await editor.API.methods.blocks.update('p', { text: [{ text: 'Human' }] });
    await settle(editor);
    const humanToken = editor.YjsManager.topUndoToken();

    expect(saved(editor)).toEqual(humanWithA);
    expect(editor.YjsManager.gestureCount()).toBe(gesturesBeforeHuman + 1);
    expect(humanToken).toBeDefined();
    expect(humanToken).not.toBe(secondToken);
    expect(editor.YjsManager.undoStepTag(humanToken)).toBeUndefined();
    editor.YjsManager.undo();
    await settle(editor);
    expect(saved(editor)).toEqual(afterSecond);
    expect(editor.YjsManager.topUndoToken()).toBe(secondToken);

    const undoneSecond = await session.execute({ commands: [{ name: 'history.undo', args: {} }] });

    await settle(editor);
    expect(saved(editor)).toEqual(withA);
    expect(undoneSecond).toMatchObject({ ok: true });
    expect(editor.YjsManager.topUndoToken()).toBe(firstToken);
    expect(editor.YjsManager.topRedoToken()).toBe(secondToken);

    const undoneFirst = await session.execute({ commands: [{ name: 'history.undo', args: {} }] });

    await settle(editor);
    expect(saved(editor)).toEqual(original);
    expect(undoneFirst).toMatchObject({ ok: true });
    expect(editor.YjsManager.canUndo()).toBe(false);
    expect(editor.BlockManager.suppressStopCapturing).toBe(false);
  }, 60_000);

  it('restores the first range on turn undo and the latest range on redo', async () => {
    const editor = await boot();

    await editor.API.methods.blocks.render({
      blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'Anchor paragraph' }] } }],
    });
    await settle(editor);
    const session = openSession(editor, { mergeSteps: 'turn' });
    const input = editor.BlockManager.getBlockById('p')?.inputs[0];
    const text = input?.firstChild;
    const selection = document.getSelection();

    if (input === undefined || !(text instanceof Text) || selection === null) {
      throw new Error('The anchor paragraph needs a live text selection.');
    }
    input.focus();
    const firstRange = document.createRange();

    firstRange.setStart(text, 2);
    firstRange.setEnd(text, 5);
    selection.removeAllRanges();
    selection.addRange(firstRange);
    editor.YjsManager.beginGesture('discrete');
    await nextTask();
    expect(selection.anchorNode).toBe(text);
    expect(selection.anchorOffset).toBe(2);
    expect(selection.focusNode).toBe(text);
    expect(selection.focusOffset).toBe(5);
    expect(await session.execute({ commands: [
      { name: 'block.insert', args: { id: 'a', type: 'paragraph', position: 'end', data: { text: 'A' } } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    const firstToken = editor.YjsManager.topUndoToken();

    if (firstToken === undefined) {
      throw new Error('The first batch needs a native history token.');
    }
    expect(firstToken.before).toEqual({ blockId: 'p', inputIndex: 0, offset: 2, end: 5 });
    expect(firstToken.after).toEqual({ blockId: 'p', inputIndex: 0, offset: 2, end: 5 });
    const gesturesAtClose = editor.YjsManager.gestureCount();

    await nextTask();
    const secondRange = document.createRange();

    secondRange.setStart(text, 6);
    secondRange.setEnd(text, 8);
    selection.removeAllRanges();
    selection.addRange(secondRange);
    expect(selection.anchorOffset).toBe(6);
    expect(selection.focusOffset).toBe(8);
    expect(editor.YjsManager.gestureCount()).toBe(gesturesAtClose);
    let movedAfterWrite = false;
    let gesturesAtLatest = -1;
    const unsubscribe = editor.YjsManager.onAnyDocUpdate((_update, origin) => {
      if (origin !== 'local' || movedAfterWrite || editor.YjsManager.getBlockById('b') === undefined) {
        return;
      }
      movedAfterWrite = true;
      gesturesAtLatest = editor.YjsManager.gestureCount();
      const latestRange = document.createRange();

      latestRange.setStart(text, 10);
      latestRange.setEnd(text, 14);
      selection.removeAllRanges();
      selection.addRange(latestRange);
    });

    unsubscribers.add(unsubscribe);
    try {
      expect(await session.execute({ commands: [
        { name: 'block.insert', args: { id: 'b', type: 'paragraph', position: 'end', data: { text: 'B' } } },
      ] })).toMatchObject({ ok: true });
    } finally {
      unsubscribe();
      unsubscribers.delete(unsubscribe);
    }
    await settle(editor);
    expect(movedAfterWrite).toBe(true);
    expect(gesturesAtLatest).toBe(gesturesAtClose + 1);
    expect(editor.YjsManager.gestureCount()).toBe(gesturesAtLatest);
    expect(selection.anchorNode).toBe(text);
    expect(selection.anchorOffset).toBe(10);
    expect(selection.focusNode).toBe(text);
    expect(selection.focusOffset).toBe(14);
    expect(saved(editor)).toEqual([
      { id: 'p', type: 'paragraph', text: [{ text: 'Anchor paragraph' }] },
      { id: 'a', type: 'paragraph', text: [{ text: 'A' }] },
      { id: 'b', type: 'paragraph', text: [{ text: 'B' }] },
    ]);
    session.sealSteps();
    expect(editor.YjsManager.topUndoToken()).toBe(firstToken);
    const undone = await session.execute({ commands: [{ name: 'history.undo', args: {} }] });

    await settle(editor);
    const undoneText = editor.BlockManager.getBlockById('p')?.inputs[0]?.firstChild;

    if (!(undoneText instanceof Text)) {
      throw new Error('Undo lost the anchor paragraph input.');
    }
    expect(selection.anchorOffset).toBe(2);
    expect(selection.focusOffset).toBe(5);
    expect(selection.anchorNode).toBe(undoneText);
    expect(selection.focusNode).toBe(undoneText);
    expect(saved(editor)).toEqual([
      { id: 'p', type: 'paragraph', text: [{ text: 'Anchor paragraph' }] },
    ]);
    expect(undone).toMatchObject({ ok: true });
    expect(editor.YjsManager.topUndoToken()).toBeUndefined();
    expect(editor.YjsManager.topRedoToken()).toBe(firstToken);
    expect(editor.YjsManager.undoStepTag(firstToken)).toEqual({
      actorId: actor.id, sessionId: session.id,
    });
    const redone = await session.execute({ commands: [{ name: 'history.redo', args: {} }] });

    await settle(editor);
    const redoneText = editor.BlockManager.getBlockById('p')?.inputs[0]?.firstChild;

    if (!(redoneText instanceof Text)) {
      throw new Error('Redo lost the anchor paragraph input.');
    }
    expect(selection.anchorOffset).toBe(10);
    expect(selection.focusOffset).toBe(14);
    expect(selection.anchorNode).toBe(redoneText);
    expect(selection.focusNode).toBe(redoneText);
    expect(saved(editor)).toEqual([
      { id: 'p', type: 'paragraph', text: [{ text: 'Anchor paragraph' }] },
      { id: 'a', type: 'paragraph', text: [{ text: 'A' }] },
      { id: 'b', type: 'paragraph', text: [{ text: 'B' }] },
    ]);
    expect(redone).toMatchObject({ ok: true });
    expect(firstToken.before).toEqual({ blockId: 'p', inputIndex: 0, offset: 2, end: 5 });
    expect(firstToken.after).toEqual({ blockId: 'p', inputIndex: 0, offset: 10, end: 14 });
    expect(editor.YjsManager.topUndoToken()).toBe(firstToken);
    expect(editor.YjsManager.topRedoToken()).toBeUndefined();
    expect(editor.YjsManager.undoStepTag(firstToken)).toEqual({
      actorId: actor.id, sessionId: session.id,
    });
  }, 60_000);

  it('refuses direct native merging for foreign tags and non-top tokens without changing replay', async () => {
    const editor = await boot();
    const session = openSession(editor);

    expect(await session.execute({ commands: [
      { name: 'block.insert', args: { id: 'a', type: 'paragraph', position: 'end', data: { text: 'A' } } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    const firstToken = editor.YjsManager.topUndoToken();

    await nextTask();
    expect(await session.execute({ commands: [
      { name: 'block.insert', args: { id: 'b', type: 'paragraph', position: 'end', data: { text: 'B' } } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    const secondToken = editor.YjsManager.topUndoToken();

    if (firstToken === undefined || secondToken === undefined) {
      throw new Error('Two native batches need distinct history tokens.');
    }
    expect(secondToken).not.toBe(firstToken);
    expect(firstToken.kind).toBe('edit');
    expect(secondToken.kind).toBe('edit');
    expect(editor.YjsManager.undoStepTag(firstToken)).toEqual({
      actorId: actor.id, sessionId: session.id,
    });
    expect(editor.YjsManager.undoStepTag(secondToken)).toEqual({
      actorId: actor.id, sessionId: session.id,
    });

    for (const tag of [
      { actorId: 'other-agent', sessionId: session.id },
      { actorId: actor.id, sessionId: 'other-session' },
    ]) {
      const refused = editor.YjsManager.mergeTopUndoSteps(firstToken, secondToken, {
        ...tag, gestureCount: editor.YjsManager.gestureCount(),
      });

      expect(saved(editor)).toEqual(withAB);
      expect(editor.BlockManager.blocks.map(block => ({
        id: block.id, text: block.inputs[0]?.textContent,
      }))).toEqual([{ id: 'p', text: 'P' }, { id: 'a', text: 'A' }, { id: 'b', text: 'B' }]);
      expect(editor.BlockManager.blocks.every(block => block.holder.isConnected)).toBe(true);
      expect(editor.YjsManager.topUndoToken()).toBe(secondToken);
      expect(editor.YjsManager.topRedoToken()).toBeUndefined();
      expect(refused).toBe(false);
      expect(editor.YjsManager.undoStepTag(firstToken)).toEqual({
        actorId: actor.id, sessionId: session.id,
      });
      expect(editor.YjsManager.undoStepTag(secondToken)).toEqual({
        actorId: actor.id, sessionId: session.id,
      });
    }

    await nextTask();
    expect(await session.execute({ commands: [
      { name: 'block.insert', args: { id: 'c', type: 'paragraph', position: 'end', data: { text: 'C' } } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    const thirdToken = editor.YjsManager.topUndoToken();

    if (thirdToken === undefined) {
      throw new Error('The third native batch needs a history token.');
    }
    expect(thirdToken).not.toBe(secondToken);
    for (const pair of [
      { previous: firstToken, current: secondToken },
      { previous: firstToken, current: thirdToken },
    ]) {
      const refused = editor.YjsManager.mergeTopUndoSteps(pair.previous, pair.current, {
        actorId: actor.id, sessionId: session.id, gestureCount: editor.YjsManager.gestureCount(),
      });

      expect(saved(editor)).toEqual(withABC);
      expect(editor.BlockManager.blocks.map(block => ({
        id: block.id, text: block.inputs[0]?.textContent,
      }))).toEqual([
        { id: 'p', text: 'P' }, { id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' },
      ]);
      expect(editor.BlockManager.blocks.every(block => block.holder.isConnected)).toBe(true);
      expect(editor.YjsManager.topUndoToken()).toBe(thirdToken);
      expect(editor.YjsManager.topRedoToken()).toBeUndefined();
      expect(refused).toBe(false);
    }

    for (const step of [
      { state: withAB, top: secondToken, redo: thirdToken },
      { state: withA, top: firstToken, redo: secondToken },
      { state: original, top: undefined, redo: firstToken },
    ]) {
      const result = await session.execute({ commands: [{ name: 'history.undo', args: {} }] });

      await settle(editor);
      expect(saved(editor)).toEqual(step.state);
      expect(result).toMatchObject({ ok: true });
      expect(editor.YjsManager.topUndoToken()).toBe(step.top);
      expect(editor.YjsManager.topRedoToken()).toBe(step.redo);
    }
    for (const step of [
      { state: withA, token: firstToken },
      { state: withAB, token: secondToken },
      { state: withABC, token: thirdToken },
    ]) {
      const result = await session.execute({ commands: [{ name: 'history.redo', args: {} }] });

      await settle(editor);
      expect(saved(editor)).toEqual(step.state);
      expect(result).toMatchObject({ ok: true });
      expect(editor.YjsManager.topUndoToken()).toBe(step.token);
      expect(editor.YjsManager.undoStepTag(step.token)).toEqual({
        actorId: actor.id, sessionId: session.id,
      });
    }
  }, 60_000);

  it('refuses direct native merging under capture and transaction scopes or across a custom move', async () => {
    const editor = await boot();
    const session = openSession(editor);

    expect(await session.execute({ commands: [
      { name: 'block.insert', args: { id: 'a', type: 'paragraph', position: 'end', data: { text: 'A' } } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    const firstToken = editor.YjsManager.topUndoToken();

    await nextTask();
    expect(await session.execute({ commands: [
      { name: 'block.insert', args: { id: 'b', type: 'paragraph', position: 'end', data: { text: 'B' } } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    const secondToken = editor.YjsManager.topUndoToken();

    if (firstToken === undefined || secondToken === undefined) {
      throw new Error('Two native batches need distinct history tokens.');
    }
    expect(secondToken).not.toBe(firstToken);
    expect(firstToken.kind).toBe('edit');
    expect(secondToken.kind).toBe('edit');
    expect(editor.YjsManager.undoStepTag(firstToken)).toEqual({
      actorId: actor.id, sessionId: session.id,
    });
    expect(editor.YjsManager.undoStepTag(secondToken)).toEqual({
      actorId: actor.id, sessionId: session.id,
    });
    const expected = {
      actorId: actor.id, sessionId: session.id, gestureCount: editor.YjsManager.gestureCount(),
    };

    editor.YjsManager.holdCapture();
    try {
      const refused = editor.YjsManager.mergeTopUndoSteps(firstToken, secondToken, expected);

      expect(saved(editor)).toEqual(withAB);
      expect(editor.BlockManager.blocks.map(block => ({
        id: block.id, text: block.inputs[0]?.textContent,
      }))).toEqual([{ id: 'p', text: 'P' }, { id: 'a', text: 'A' }, { id: 'b', text: 'B' }]);
      expect(editor.BlockManager.blocks.every(block => block.holder.isConnected)).toBe(true);
      expect(editor.YjsManager.topUndoToken()).toBe(secondToken);
      expect(editor.YjsManager.topRedoToken()).toBeUndefined();
      expect(refused).toBe(false);
    } finally {
      editor.YjsManager.releaseCapture();
    }

    let refusedInTransaction: boolean | undefined;

    editor.YjsManager.transact(() => {
      refusedInTransaction = editor.YjsManager.mergeTopUndoSteps(firstToken, secondToken, expected);
    });
    expect(saved(editor)).toEqual(withAB);
    expect(editor.BlockManager.blocks.map(block => ({
      id: block.id, text: block.inputs[0]?.textContent,
    }))).toEqual([{ id: 'p', text: 'P' }, { id: 'a', text: 'A' }, { id: 'b', text: 'B' }]);
    expect(editor.BlockManager.blocks.every(block => block.holder.isConnected)).toBe(true);
    expect(editor.YjsManager.topUndoToken()).toBe(secondToken);
    expect(editor.YjsManager.topRedoToken()).toBeUndefined();
    expect(refusedInTransaction).toBe(false);
    let refusedInJoin: boolean | undefined;

    editor.YjsManager.joinMovesToStep(() => {
      refusedInJoin = editor.YjsManager.mergeTopUndoSteps(firstToken, secondToken, expected);
    });
    expect(saved(editor)).toEqual(withAB);
    expect(editor.BlockManager.blocks.map(block => ({
      id: block.id, text: block.inputs[0]?.textContent,
    }))).toEqual([{ id: 'p', text: 'P' }, { id: 'a', text: 'A' }, { id: 'b', text: 'B' }]);
    expect(editor.BlockManager.blocks.every(block => block.holder.isConnected)).toBe(true);
    expect(editor.YjsManager.topUndoToken()).toBe(secondToken);
    expect(editor.YjsManager.topRedoToken()).toBeUndefined();
    expect(refusedInJoin).toBe(false);
    let refusedInMoveGroup: boolean | undefined;

    editor.YjsManager.transactMoves(() => {
      refusedInMoveGroup = editor.YjsManager.mergeTopUndoSteps(firstToken, secondToken, expected);
    });
    expect(saved(editor)).toEqual(withAB);
    expect(editor.BlockManager.blocks.map(block => ({
      id: block.id, text: block.inputs[0]?.textContent,
    }))).toEqual([{ id: 'p', text: 'P' }, { id: 'a', text: 'A' }, { id: 'b', text: 'B' }]);
    expect(editor.BlockManager.blocks.every(block => block.holder.isConnected)).toBe(true);
    expect(editor.YjsManager.topUndoToken()).toBe(secondToken);
    expect(editor.YjsManager.topRedoToken()).toBeUndefined();
    expect(refusedInMoveGroup).toBe(false);

    await nextTask();
    editor.API.methods.blocks.moveTo('a', { parentId: null, position: 'start' });
    await settle(editor);
    const moveToken = editor.YjsManager.topUndoToken();

    if (moveToken === undefined) {
      throw new Error('The custom move needs a history token.');
    }
    const moved = [
      { id: 'a', type: 'paragraph', text: [{ text: 'A' }] },
      { id: 'p', type: 'paragraph', text: [{ text: 'P' }] },
      { id: 'b', type: 'paragraph', text: [{ text: 'B' }] },
    ];

    expect(saved(editor)).toEqual(moved);
    expect(moveToken.kind).toBe('move');
    expect(moveToken).not.toBe(secondToken);
    const refusedAcrossMove = editor.YjsManager.mergeTopUndoSteps(firstToken, secondToken, {
      ...expected, gestureCount: editor.YjsManager.gestureCount(),
    });

    expect(saved(editor)).toEqual(moved);
    expect(editor.BlockManager.blocks.map(block => ({
      id: block.id, text: block.inputs[0]?.textContent,
    }))).toEqual([{ id: 'a', text: 'A' }, { id: 'p', text: 'P' }, { id: 'b', text: 'B' }]);
    expect(editor.BlockManager.blocks.every(block => block.holder.isConnected)).toBe(true);
    expect(editor.YjsManager.topUndoToken()).toBe(moveToken);
    expect(editor.YjsManager.topRedoToken()).toBeUndefined();
    expect(refusedAcrossMove).toBe(false);
    editor.YjsManager.undo();
    await settle(editor);
    expect(saved(editor)).toEqual(withAB);
    expect(editor.YjsManager.topUndoToken()).toBe(secondToken);
    expect(editor.YjsManager.topRedoToken()).toBe(moveToken);

    for (const step of [
      { state: withA, top: firstToken, redo: secondToken },
      { state: original, top: undefined, redo: firstToken },
    ]) {
      const result = await session.execute({ commands: [{ name: 'history.undo', args: {} }] });

      await settle(editor);
      expect(saved(editor)).toEqual(step.state);
      expect(result).toMatchObject({ ok: true });
      expect(editor.YjsManager.topUndoToken()).toBe(step.top);
      expect(editor.YjsManager.topRedoToken()).toBe(step.redo);
    }
    for (const step of [
      { state: withA, token: firstToken },
      { state: withAB, token: secondToken },
    ]) {
      const result = await session.execute({ commands: [{ name: 'history.redo', args: {} }] });

      await settle(editor);
      expect(saved(editor)).toEqual(step.state);
      expect(result).toMatchObject({ ok: true });
      expect(editor.YjsManager.topUndoToken()).toBe(step.token);
    }
    editor.YjsManager.redo();
    await settle(editor);
    expect(saved(editor)).toEqual(moved);
    expect(editor.YjsManager.topUndoToken()).toBe(moveToken);
    expect(editor.YjsManager.topRedoToken()).toBeUndefined();
  }, 60_000);

  it('restores a later-batch deletion after a separate custom move is undone', async () => {
    const editor = await boot();

    await editor.API.methods.blocks.render({
      blocks: [
        { id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] } },
        { id: 'd', type: 'paragraph', data: { text: [{ text: 'D' }] } },
        { id: 'r', type: 'paragraph', data: { text: [{ text: 'R' }] } },
      ],
    });
    await settle(editor);
    const session = openSession(editor, { mergeSteps: 'turn' });
    const baseline = [
      { id: 'p', type: 'paragraph', text: [{ text: 'P' }] },
      { id: 'd', type: 'paragraph', text: [{ text: 'D' }] },
      { id: 'r', type: 'paragraph', text: [{ text: 'R' }] },
    ];
    const afterTurn = [
      { id: 'p', type: 'paragraph', text: [{ text: 'First P' }] },
      { id: 'r', type: 'paragraph', text: [{ text: 'R' }] },
    ];

    expect(saved(editor)).toEqual(baseline);
    expect(await session.execute({ commands: [
      { name: 'block.update', args: { id: 'p', data: { text: 'First P' } } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    const token = editor.YjsManager.topUndoToken();

    if (token === undefined) {
      throw new Error('The first batch needs a native history token.');
    }
    await nextTask();
    expect(await session.execute({ commands: [
      { name: 'block.delete', args: { id: 'd' } },
    ] })).toMatchObject({ ok: true });
    await settle(editor);
    expect(saved(editor)).toEqual(afterTurn);
    session.sealSteps();
    expect(editor.YjsManager.topUndoToken()).toBe(token);
    await nextTask();
    editor.API.methods.blocks.moveTo('r', { parentId: null, position: 'start' });
    await settle(editor);
    const moveToken = editor.YjsManager.topUndoToken();

    expect(saved(editor)).toEqual([
      { id: 'r', type: 'paragraph', text: [{ text: 'R' }] },
      { id: 'p', type: 'paragraph', text: [{ text: 'First P' }] },
    ]);
    expect(moveToken?.kind).toBe('move');
    expect(moveToken).not.toBe(token);
    editor.YjsManager.undo();
    await settle(editor);
    expect(saved(editor)).toEqual(afterTurn);
    expect(editor.YjsManager.topUndoToken()).toBe(token);
    const undone = await session.execute({ commands: [{ name: 'history.undo', args: {} }] });

    await settle(editor);
    expect(saved(editor)).toEqual(baseline);
    const reader = new DocumentStore(new YBlockSerializer());

    try {
      reader.applyRemoteUpdate(editor.YjsManager.encodeStateAsUpdate());
      expect(reader.rootOrder.toArray()).toEqual(['p', 'd', 'r']);
      expect(editor.BlockManager.blocks.map(block => ({
        id: block.id, text: block.inputs[0]?.textContent,
      }))).toEqual([{ id: 'p', text: 'P' }, { id: 'd', text: 'D' }, { id: 'r', text: 'R' }]);
      const restoredP = editor.BlockManager.getBlockById('p');
      const restoredD = editor.BlockManager.getBlockById('d');
      const restoredR = editor.BlockManager.getBlockById('r');

      if (restoredP === undefined || restoredD === undefined || restoredR === undefined) {
        throw new Error('Undo lost a restored neighbor.');
      }
      expect(restoredP.holder.isConnected).toBe(true);
      expect(restoredD.holder.isConnected).toBe(true);
      expect(restoredR.holder.isConnected).toBe(true);
      expect(restoredD.holder.previousElementSibling).toBe(restoredP.holder);
      expect(restoredD.holder.nextElementSibling).toBe(restoredR.holder);
      expect(undone).toMatchObject({ ok: true });
      expect(editor.YjsManager.topUndoToken()).toBeUndefined();
      expect(editor.YjsManager.topRedoToken()).toBe(token);
      expect(editor.YjsManager.undoStepTag(token)).toEqual({
        actorId: actor.id, sessionId: session.id,
      });
      const redone = await session.execute({ commands: [{ name: 'history.redo', args: {} }] });

      await settle(editor);
      expect(saved(editor)).toEqual(afterTurn);
      reader.applyRemoteUpdate(editor.YjsManager.encodeStateAsUpdate());
      expect(reader.rootOrder.toArray()).toEqual(['p', 'r']);
      expect(editor.BlockManager.getBlockById('d')).toBeUndefined();
      expect(editor.BlockManager.blocks.map(block => ({
        id: block.id, text: block.inputs[0]?.textContent,
      }))).toEqual([{ id: 'p', text: 'First P' }, { id: 'r', text: 'R' }]);
      expect(editor.BlockManager.blocks.every(block => block.holder.isConnected)).toBe(true);
      expect(redone).toMatchObject({ ok: true });
      expect(editor.YjsManager.topUndoToken()).toBe(token);
      expect(editor.YjsManager.topRedoToken()).toBe(moveToken);
    } finally {
      reader.destroy();
    }
  }, 60_000);


  describe('undo and redo cannot unlock a database behind the person\'s back', () => {
    const lockedDb = (locked: boolean): OutputData['blocks'][number] => ({
      id: 'db', type: 'database', content: [],
      data: {
        title: 'Tasks',
        schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0', ...(locked && { databaseLocked: true }) }],
        views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
        activeViewId: 'v',
      },
    });
    const isLocked = (editor: BlokModules): boolean => {
      const schema: unknown = editor.YjsManager.toJSON().find(block => block.id === 'db')?.data.schema;

      return Array.isArray(schema) && schema.some((property: unknown) => typeof property === 'object' && property !== null
        && 'databaseLocked' in property && property.databaseLocked === true);
    };
    const run = (session: AgentSession, commands: unknown[], approve?: AgentApprover) =>
      session.execute({ commands } as never, approve === undefined ? {} : { approve });


    it('an undo of two merged batches, the earlier one a lock, asks before it unlocks', async () => {
      const editor = await boot([{ id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] } }, lockedDb(false)]);
      const session = openSession(editor, { mergeSteps: 'turn' });

      expect(await run(session, [{ name: 'database.setLock', args: { id: 'db', locked: true } }])).toMatchObject({ ok: true });
      await settle(editor);
      await nextTask();
      expect(await run(session, [{ name: 'block.insert', args: { id: 'a', type: 'paragraph', position: 'end', data: { text: 'A' } } }])).toMatchObject({ ok: true });
      await settle(editor);
      session.sealSteps();

      const undone = await run(session, [{ name: 'history.undo', args: {} }]);

      await settle(editor);
      expect(isLocked(editor)).toBe(true);
      expect(undone).toMatchObject({ ok: false, error: { code: 'APPROVAL_REQUIRED' } });
    }, 60_000);

    it('an undo of two merged batches, the earlier one a sharing change, asks with exactly what it changes back', async () => {
      const form = { ...lockedDb(false), data: { ...lockedDb(false).data, views: [{ id: 'v', name: 'Signup', type: 'form', position: 'a0', sorts: [], filters: [], visibleProperties: [], form: {} }] } };
      const editor = await boot([{ id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] } }, form]);
      const session = openSession(editor, { mergeSteps: 'turn' });
      const formOf = (): unknown => (editor.YjsManager.toJSON().find(block => block.id === 'db')?.data.views as Array<{ form?: unknown }>)[0]?.form;
      const asked = vi.fn<AgentApprover>(() => Promise.resolve(false));

      expect(await run(session, [{ name: 'database.updateView', args: { id: 'db', viewId: 'v', changes: { form: { public: true } } } }], () => Promise.resolve(true)))
        .toMatchObject({ ok: true });
      await settle(editor);
      await nextTask();
      expect(await run(session, [{ name: 'block.insert', args: { id: 'a', type: 'paragraph', position: 'end', data: { text: 'A' } } }])).toMatchObject({ ok: true });
      await settle(editor);
      session.sealSteps();

      const undone = await run(session, [{ name: 'history.undo', args: {} }], asked);

      await settle(editor);
      expect(undone).toMatchObject({ ok: false, error: { code: 'APPROVAL_REQUIRED' } });
      expect(asked.mock.calls[0]?.[0]).toEqual({
        kind: 'database.share', blockId: 'db', title: 'Tasks', viewId: 'v', view: 'Signup', changes: [{ setting: 'access', to: 'workspace' }],
      });
      expect(formOf()).toEqual({ public: true });
    }, 60_000);

    it('a redo approved for one step, after the person changed the top step, is STALE', async () => {
      const editor = await boot([{ id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] } }, lockedDb(true), { ...lockedDb(true), id: 'db2' }]);
      const session = openSession(editor);
      const yes = vi.fn<AgentApprover>(() => Promise.resolve(true));
      const lockedId = (id: string): boolean => {
        const schema: unknown = editor.YjsManager.toJSON().find(block => block.id === id)?.data.schema;

        return Array.isArray(schema) && schema.some((property: unknown) => typeof property === 'object' && property !== null
          && 'databaseLocked' in property && property.databaseLocked === true);
      };

      for (const id of ['db', 'db2']) {
        expect(await run(session, [{ name: 'database.setLock', args: { id, locked: false } }], yes)).toMatchObject({ ok: true });
        await settle(editor);
        await nextTask();
      }
      for (let i = 0; i < 2; i++) {
        expect(await run(session, [{ name: 'history.undo', args: {} }])).toMatchObject({ ok: true });
        await settle(editor);
      }
      expect([lockedId('db'), lockedId('db2')]).toEqual([true, true]);

      // While the question about db is open, the person redoes it natively: db2's unlock is next now.
      const redone = await run(session, [{ name: 'history.redo', args: {} }], async () => {
        editor.YjsManager.beginGesture('discrete');
        editor.YjsManager.redo();
        await settle(editor);

        return true;
      });

      await settle(editor);
      expect(lockedId('db2')).toBe(true);
      expect(redone).toMatchObject({ ok: false, error: { code: 'STALE' } });
    }, 60_000);

    it('a redo of an unlock the person undid natively still asks', async () => {
      const editor = await boot([{ id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] } }, lockedDb(true)]);
      const session = openSession(editor);
      const approve = vi.fn<AgentApprover>(() => Promise.resolve(true));

      expect(await run(session, [{ name: 'database.setLock', args: { id: 'db', locked: false } }], approve)).toMatchObject({ ok: true });
      await settle(editor);
      await nextTask();
      expect(await run(session, [{ name: 'block.insert', args: { id: 'a', type: 'paragraph', position: 'end', data: { text: 'A' } } }])).toMatchObject({ ok: true });
      await settle(editor);
      await nextTask();
      // The person presses Cmd+Z twice: the agent's own history marks never see it.
      editor.YjsManager.beginGesture('discrete');
      editor.YjsManager.undo();
      await settle(editor);
      editor.YjsManager.undo();
      await settle(editor);
      expect(isLocked(editor)).toBe(true);

      const redone = await run(session, [{ name: 'history.redo', args: {} }]);

      await settle(editor);
      expect(isLocked(editor)).toBe(true);
      expect(redone).toMatchObject({ ok: false, error: { code: 'APPROVAL_REQUIRED' } });
    }, 60_000);
  });
});
