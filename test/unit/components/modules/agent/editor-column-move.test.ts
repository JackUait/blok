// Imports target test/unit/components/modules/agent when installed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../../src/components/core';
import { createEditorAgentSession } from '../../../../../src/components/modules/agent/editor-session';
import { editorSnapshot } from '../../../../../src/components/modules/agent/editor-snapshot';
import { Listeners } from '../../../../../src/components/utils/listeners';
import { destroy as destroyTooltip } from '../../../../../src/components/utils/tooltip';
import { Column, ColumnList, Paragraph } from '../../../../../src/tools';
import type { AgentSession, MoveToTarget, OutputData } from '../../../../../types';

type EditorModules = Core['moduleInstances'];

const columnDocument = (nested = false): OutputData => ({
  blocks: [
    { id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] } },
    ...(nested ? [
      { id: 'outer-list', type: 'column_list', data: {}, content: ['outer-c1', 'outer-c2'] },
      { id: 'outer-c1', type: 'column', data: {}, parent: 'outer-list', content: ['left', 'cl', 'right'] },
      { id: 'left', type: 'paragraph', data: { text: [{ text: 'Left' }] }, parent: 'outer-c1' },
    ] : []),
    { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2'], ...(nested ? { parent: 'outer-c1' } : {}) },
    { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['x'] },
    { id: 'x', type: 'paragraph', data: { text: [{ text: 'X', marks: { bold: true } }] }, parent: 'c1' },
    { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['y', 'z'] },
    { id: 'y', type: 'paragraph', data: { text: [{ text: 'Y' }] }, parent: 'c2' },
    { id: 'z', type: 'paragraph', data: { text: [{ text: 'Z' }] }, parent: 'c2' },
    ...(nested ? [
      { id: 'right', type: 'paragraph', data: { text: [{ text: 'Right' }] }, parent: 'outer-c1' },
      { id: 'outer-c2', type: 'column', data: {}, parent: 'outer-list', content: ['outer-other'] },
      { id: 'outer-other', type: 'paragraph', data: { text: [{ text: 'Other' }] }, parent: 'outer-c2' },
    ] : []),
    { id: 'q', type: 'paragraph', data: { text: [{ text: 'Q' }] } },
  ],
});

const layouts = [
  { name: 'root', nested: false },
  { name: 'nested column', nested: true },
];

let holder: HTMLDivElement | undefined;
let core: Core | undefined;
const sessions: AgentSession[] = [];
const unsubscribers = new Set<() => void>();

const hasDestroy = (value: unknown): value is { destroy(): void | Promise<void> } =>
  typeof value === 'object' && value !== null &&
  'destroy' in value && typeof value.destroy === 'function';

const removeModuleListeners = (owner: unknown): void => {
  if (typeof owner === 'object' && owner !== null &&
    'listeners' in owner && owner.listeners instanceof Listeners) {
    owner.listeners.removeAll();
  }
};

const destroyModule = async (owner: unknown, failures: unknown[]): Promise<void> => {
  try {
    if (hasDestroy(owner)) {
      await owner.destroy();
    }
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      removeModuleListeners(owner);
    } catch (error) {
      failures.push(error);
    }
  }
};

const destroyCore = async (instance: Core): Promise<void> => {
  const modules = Object.values<EditorModules[keyof EditorModules]>({ ...instance.moduleInstances });
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

const settle = async (editor: EditorModules): Promise<void> => {
  await vi.waitFor(() => {
    expect(editor.BlockManager.isSyncingFromYjs).toBe(false);
  });

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
    });
  } finally {
    unsubscribe();
    unsubscribers.delete(unsubscribe);
  }
};

const boot = async (data: OutputData): Promise<EditorModules> => {
  if (holder === undefined || core !== undefined) {
    throw new Error('The editor fixture is not ready to boot.');
  }

  const instance = new Core({
    holder,
    tabSync: false,
    i18n: { locale: 'en' },
    user: { id: 'human-1', name: 'Human' },
    tools: {
      paragraph: { class: Paragraph },
      column_list: { class: ColumnList },
      column: { class: Column },
    },
    data,
  });

  core = instance;
  await instance.isReady;
  await settle(instance.moduleInstances);

  return instance.moduleInstances;
};

const openSession = (editor: EditorModules): AgentSession => {
  const session = createEditorAgentSession(editor, { id: 'agent-1', name: 'Agent', kind: 'agent' });

  sessions.push(session);

  return session;
};

const publicMoves: Array<{ name: string; id: string; target: MoveToTarget }> = [
  { name: 'into a column', id: 'p', target: { parentId: 'c1', position: 'end' } },
  { name: 'out of a column', id: 'x', target: { parentId: null, position: 'end' } },
];

const closeSessionsAndUnsubscribe = (failures: unknown[]): void => {
  for (const session of sessions.splice(0)) {
    try {
      session.close();
    } catch (error) {
      failures.push(error);
    }
  }
  for (const unsubscribe of unsubscribers) {
    try {
      unsubscribe();
    } catch (error) {
      failures.push(error);
    }
  }
  unsubscribers.clear();
};

const teardownCore = async (instance: Core, failures: unknown[]): Promise<void> => {
  let readinessTimer: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      instance.isReady.catch(() => undefined),
      new Promise<never>((_resolve, reject) => {
        readinessTimer = setTimeout(() => {
          reject(new Error('Editor readiness timed out during teardown.'));
        }, 1_000);
      }),
    ]);
  } catch (error) {
    failures.push(error);
  } finally {
    if (readinessTimer !== undefined) {
      clearTimeout(readinessTimer);
    }
  }
  try {
    await destroyCore(instance);
  } catch (error) {
    failures.push(error);
  }
};

describe('block.move across existing columns through real Core modules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    const failures: unknown[] = [];

    try {
      closeSessionsAndUnsubscribe(failures);
      if (core !== undefined) {
        await teardownCore(core, failures);
      }
    } finally {
      core = undefined;
      holder?.remove();
      holder = undefined;
      document.getSelection()?.removeAllRanges();
      vi.restoreAllMocks();
    }

    if (failures.length > 0) {
      throw new AggregateError(failures, 'Editor fixture teardown failed.');
    }
  });

  it('allows an agent to move an existing root block into a column', async () => {
    const editor = await boot(columnDocument());
    const session = openSession(editor);
    const result = await session.execute({ commands: [
      { name: 'block.move', args: { id: 'p', parentId: 'c1', position: 'end' } },
    ] });

    await settle(editor);
    const saved = editorSnapshot(editor);

    expect(saved.childrenOf('c1')).toEqual(['x', 'p']);
    expect(saved.parentOf('p')).toBe('c1');
    expect(saved.childrenOf(null)).toEqual(['cl', 'q']);
    expect(saved.childrenOf('cl')).toEqual(['c1', 'c2']);
    expect(saved.childrenOf('c2')).toEqual(['y', 'z']);
    expect(saved.get('p')?.data).toEqual({ text: [{ text: 'P' }] });
    expect(result).toMatchObject({ ok: true });
  }, 60_000);

  it.each(layouts)('moves the last child out and unwraps survivors at the list slot in the $name', async ({ nested }) => {
    const editor = await boot(columnDocument(nested));
    const session = openSession(editor);
    const result = await session.execute({ commands: [
      { name: 'block.move', args: { id: 'x', parentId: null, position: 'end' } },
    ] });

    expect(result).toMatchObject({ ok: true });
    const moved = editorSnapshot(editor);

    expect(moved.parentOf('x')).toBe(null);
    expect(moved.childrenOf(null).slice(-1)).toEqual(['x']);
    await settle(editor);
    await vi.waitFor(() => {
      expect(editorSnapshot(editor).has('c1')).toBe(false);
    });
    const saved = editorSnapshot(editor);

    expect(saved.has('cl')).toBe(false);
    expect(saved.has('c2')).toBe(false);
    if (nested) {
      expect(saved.childrenOf(null)).toEqual(['p', 'outer-list', 'q', 'x']);
      expect(saved.childrenOf('outer-list')).toEqual(['outer-c1', 'outer-c2']);
      expect(saved.childrenOf('outer-c1')).toEqual(['left', 'y', 'z', 'right']);
      expect(saved.childrenOf('outer-c2')).toEqual(['outer-other']);
      expect(saved.parentOf('y')).toBe('outer-c1');
      expect(saved.parentOf('z')).toBe('outer-c1');
      expect(saved.toOutput().blocks.map(block => block.id)).toEqual([
        'p', 'outer-list', 'outer-c1', 'left', 'y', 'z', 'right', 'outer-c2', 'outer-other', 'q', 'x',
      ]);
    } else {
      expect(saved.childrenOf(null)).toEqual(['p', 'y', 'z', 'q', 'x']);
      expect(saved.parentOf('y')).toBe(null);
      expect(saved.parentOf('z')).toBe(null);
      expect(saved.toOutput().blocks.map(block => block.id)).toEqual(['p', 'y', 'z', 'q', 'x']);
    }
    expect(saved.parentOf('x')).toBe(null);
    expect(saved.get('x')?.data).toEqual({ text: [{ text: 'X', marks: { bold: true } }] });
    expect(saved.get('y')?.data).toEqual({ text: [{ text: 'Y' }] });
    expect(saved.get('z')?.data).toEqual({ text: [{ text: 'Z' }] });
  }, 60_000);

  it.each(publicMoves)('keeps public blocks.moveTo refusing moves $name', async ({ id, target }) => {
    const editor = await boot(columnDocument());
    const before = editorSnapshot(editor).toOutput();
    const blocks = editor.API.methods.blocks;

    expect(() => blocks.moveTo(id, target)).toThrow(/column/);
    await settle(editor);
    expect(editorSnapshot(editor).toOutput()).toEqual(before);
  }, 60_000);
});
