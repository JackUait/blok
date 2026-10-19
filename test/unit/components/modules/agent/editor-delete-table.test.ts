import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../../src/components/core';
import { createEditorAgentSession } from '../../../../../src/components/modules/agent/editor-session';
import { Listeners } from '../../../../../src/components/utils/listeners';
import { destroy as destroyTooltip } from '../../../../../src/components/utils/tooltip';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Table } from '../../../../../src/tools/table';

import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { AgentSession } from '../../../../../types/agent';
import type { OutputData } from '../../../../../types';

let holder: HTMLDivElement | undefined;
let core: Core | undefined;
let session: AgentSession | undefined;

const hasDestroy = (value: unknown): value is { destroy(): void | Promise<void> } =>
  typeof value === 'object' && value !== null &&
  'destroy' in value && typeof value.destroy === 'function';

const settle = async (editor: BlokModules): Promise<void> => {
  await vi.waitFor(() => {
    expect(editor.BlockManager.isSyncingFromYjs).toBe(false);
  });
  editor.YjsManager.flushPendingBlockWrites();
  await new Promise<void>(resolve => setTimeout(resolve, 0));
};

// Typed as unknown: `listeners` is protected on Module, so tsc rejects reading it off a module type.
const removeModuleListeners = (owner: unknown): void => {
  if (typeof owner === 'object' && owner !== null &&
      'listeners' in owner && owner.listeners instanceof Listeners) {
    owner.listeners.removeAll();
  }
};

const destroyCore = async (instance: Core): Promise<void> => {
  const modules = Object.values<BlokModules[keyof BlokModules]>({ ...instance.moduleInstances });

  modules.forEach(module => module.markDestroyed());
  for (const module of modules) {
    if (hasDestroy(module)) {
      await module.destroy();
    }
    removeModuleListeners(module);
  }
  destroyTooltip();
};

const cell = (id: string, text: string): OutputData['blocks'][number] =>
  ({ id, type: 'paragraph', data: { text: [{ text }] }, parent: 'tbl' });

const boot = async (): Promise<BlokModules> => {
  if (holder === undefined) {
    throw new Error('The test holder is missing.');
  }
  core = new Core({
    holder,
    tabSync: false,
    i18n: { locale: 'en' },
    user: { id: 'human-1', name: 'Human' },
    tools: { paragraph: { class: Paragraph }, table: { class: Table } },
    data: { blocks: [
      { id: 'before', type: 'paragraph', data: { text: [{ text: 'Before' }] } },
      { id: 'tbl', type: 'table', content: ['a', 'b', 'c', 'd'], data: {
        withHeadings: false, withHeadingColumn: false, stretched: false, initialColWidth: 0,
        content: [[{ blocks: ['a'] }, { blocks: ['b'] }], [{ blocks: ['c'] }, { blocks: ['d'] }]],
      } },
      cell('a', ''), cell('b', ''), cell('c', ''), cell('d', ''),
      { id: 'after', type: 'paragraph', data: { text: [{ text: 'After' }] } },
    ] },
  });
  await core.isReady;
  await settle(core.moduleInstances);

  return core.moduleInstances;
};

describe('block.delete on a table in a live editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    session?.close();
    session = undefined;
    if (core !== undefined) {
      await destroyCore(core);
    }
    core = undefined;
    holder?.remove();
    holder = undefined;
    vi.restoreAllMocks();
  });

  it('removes the table with its cell blocks and undoes it in one step', async () => {
    const editor = await boot();

    session = createEditorAgentSession(editor, { id: 'agent-1', name: 'Agent', kind: 'agent' });

    const result = await session.execute({ commands: [{ name: 'block.delete', args: { id: 'tbl' } }] });

    await settle(editor);

    expect(result).toMatchObject({ ok: true, results: [{ removedIds: ['tbl', 'a', 'b', 'c', 'd'], liftedIds: [] }] });
    expect(editor.BlockManager.blocks.map(block => block.id)).toEqual(['before', 'after']);
    expect(editor.YjsManager.toJSON().map(block => block.id)).toEqual(['before', 'after']);

    editor.YjsManager.undo();
    await settle(editor);

    expect(editor.YjsManager.toJSON().map(block => block.id)).toEqual(['before', 'tbl', 'a', 'b', 'c', 'd', 'after']);
  }, 60_000);
});
