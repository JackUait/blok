import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../src/components/core';
import { snapshotFromTools } from '../../../src/components/tools/registry-snapshot';
import { destroy as destroyTooltip } from '../../../src/components/utils/tooltip';
import { buildBuiltInSnapshot } from '../../../src/shared/built-in-snapshot';
import { BLOCK_CLASSES, INLINE_CLASSES, builtInEditorTools } from './tool-descriptions/built-in-tools';

const hasMarkDestroyed = (value: unknown): value is { markDestroyed(): void } =>
  typeof value === 'object' && value !== null &&
  'markDestroyed' in value && typeof value.markDestroyed === 'function';

const hasDestroy = (value: unknown): value is { destroy(): void | Promise<void> } =>
  typeof value === 'object' && value !== null &&
  'destroy' in value && typeof value.destroy === 'function';

const hasListeners = (value: unknown): value is { listeners: { removeAll(): void } } =>
  typeof value === 'object' && value !== null && 'listeners' in value &&
  typeof value.listeners === 'object' && value.listeners !== null &&
  'removeAll' in value.listeners && typeof value.listeners.removeAll === 'function';

const destroyCore = async (core: Core): Promise<void> => {
  const modules: unknown[] = Object.values(core.moduleInstances);
  const pending: Array<void | Promise<void>> = [];

  // Mark every module before any destroy hook runs.
  modules.filter(hasMarkDestroyed).forEach(instance => instance.markDestroyed());

  for (const instance of modules) {
    if (hasDestroy(instance)) {
      pending.push(instance.destroy());
    }
    if (hasListeners(instance)) {
      instance.listeners.removeAll();
    }
  }

  destroyTooltip();
  await Promise.all(pending);
};

describe('buildBuiltInSnapshot', () => {
  let holder: HTMLDivElement | undefined;
  let core: Core | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    try {
      if (core !== undefined) {
        await destroyCore(core);
      }
    } finally {
      core = undefined;
      holder?.remove();
      holder = undefined;
      vi.restoreAllMocks();
    }
  });

  it('matches the full default English registry in registration order', async () => {
    if (holder === undefined) {
      throw new Error('The test holder is missing.');
    }

    const instance = new Core({
      holder,
      tabSync: false,
      i18n: { locale: 'en' },
      tools: builtInEditorTools(),
    });

    core = instance;
    await instance.isReady;

    const live = snapshotFromTools(instance.moduleInstances.Tools, {
      blokVersion: 'task-27-version',
      readOnly: false,
      defaultBlock: 'paragraph',
      services: [],
      i18n: instance.moduleInstances.I18n,
    });
    const built = buildBuiltInSnapshot({ blokVersion: 'task-27-version' });
    const blockNames = Object.keys(BLOCK_CLASSES);
    const inlineNames = ['convertTo', ...Object.keys(INLINE_CLASSES)];
    const tuneNames = ['delete', 'copyLink'];

    expect(blockNames).toHaveLength(25);
    expect(inlineNames).toHaveLength(11);
    expect(Object.keys(builtInEditorTools())).toEqual([
      ...blockNames,
      ...Object.keys(INLINE_CLASSES),
    ]);
    expect(live.blocks.map(block => block.name)).toEqual(blockNames);
    expect(live.inlineTools.map(tool => tool.name)).toEqual(inlineNames);
    expect(live.tunes.map(tune => tune.name)).toEqual(tuneNames);

    for (const block of live.blocks) {
      const adapter = instance.moduleInstances.Tools.blockTools.get(block.name);

      if (adapter === undefined) {
        throw new Error(`The default registry is missing adapter "${block.name}".`);
      }

      expect(block.inlineTools, block.name).toEqual([...adapter.inlineTools.keys()]);
      expect(block.tunes, block.name).toEqual([...adapter.tunes.keys()]);
      expect(block.description, block.name).not.toBeNull();
    }

    expect(built).toEqual(live);

    const code = built.blocks.find(block => block.name === 'code');

    if (code === undefined) {
      throw new Error('The built-in snapshot is missing code.');
    }

    expect(code.inlineTools).toEqual([]);
  }, 60_000);
});
