import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockTool } from '../../../../types';
import type { BlockToolConstructorOptions } from '../../../../types/tools/block-tool';
import { Core } from '../../../../src/components/core';
import { modificationsObserverBatchTimeout } from '../../../../src/components/constants';
import { RedactorDomChanged } from '../../../../src/components/events';
import { destroy as destroyTooltip } from '../../../../src/components/utils/tooltip';

interface TransientData extends Record<string, unknown> {
  text: string;
  filename: string;
}

interface TransientConfig {
  initiallyEditing: boolean;
}

class TransientRenameTool implements BlockTool {
  public static isReadOnlySupported = true;

  private readonly resident = document.createElement('div');
  private readonly filename: string;
  private readonly initiallyEditing: boolean;

  public constructor({ data, config, readOnly }: BlockToolConstructorOptions<TransientData, TransientConfig>) {
    this.resident.setAttribute('contenteditable', readOnly ? 'false' : 'true');
    this.resident.setAttribute('data-blok-testid', 'resident-text');
    this.resident.textContent = data.text;
    this.filename = data.filename;
    this.initiallyEditing = config?.initiallyEditing ?? false;
  }

  public render(): HTMLElement {
    const root = document.createElement('div');
    const chrome = document.createElement('div');
    const slot = document.createElement('div');
    const button = document.createElement('button');

    chrome.setAttribute('data-blok-mutation-free', 'true');
    chrome.setAttribute('data-blok-chrome', '');
    chrome.setAttribute('data-blok-keyboard-owner', '');
    chrome.setAttribute('contenteditable', 'false');
    slot.setAttribute('data-blok-testid', 'rename-slot');
    button.type = 'button';
    button.textContent = 'Toggle filename editing';

    const mount = (): void => {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = this.filename;
      input.setAttribute('aria-label', 'File name');
      input.setAttribute('data-blok-testid', 'transient-rename');
      slot.appendChild(input);
      if (input.isConnected) input.focus();
    };

    button.addEventListener('click', () => {
      const input = slot.querySelector('input');
      if (input === null) mount();
      else input.remove();
    });
    chrome.append(button, slot);
    root.append(chrome, this.resident);
    if (this.initiallyEditing) mount();

    return root;
  }

  public save(): TransientData {
    return { text: this.resident.textContent ?? '', filename: this.filename };
  }
}

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

  // All modules must be marked before a destroy hook can call another module.
  modules.filter(hasMarkDestroyed).forEach(instance => instance.markDestroyed());
  for (const instance of modules) {
    if (hasDestroy(instance)) pending.push(instance.destroy());
    if (hasListeners(instance)) instance.listeners.removeAll();
  }
  destroyTooltip();
  await Promise.all(pending);
};

const settle = async (): Promise<void> => {
  // Wait past the change/write batch so chrome cannot hide a delayed edit.
  await new Promise(resolve => setTimeout(resolve, modificationsObserverBatchTimeout + 50));
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
};

describe('public inputs after mutation-free rename topology changes', () => {
  let holder: HTMLDivElement | undefined;
  let core: Core | undefined;
  const unsubscribes: Array<() => void> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    try {
      unsubscribes.splice(0).forEach(unsubscribe => unsubscribe());
      if (core !== undefined) await destroyCore(core);
    } finally {
      core = undefined;
      holder?.remove();
      holder = undefined;
      vi.restoreAllMocks();
    }
  });

  it.each([
    { initiallyEditing: false, change: 'mount' },
    { initiallyEditing: true, change: 'unmount' },
  ])('$change refreshes exact raw inputs without making a document edit', async ({ initiallyEditing }) => {
    if (holder === undefined) throw new Error('Missing fixture holder.');
    const onChange = vi.fn();
    const onWrite = vi.fn();
    const instance = new Core({
      holder,
      tabSync: false,
      defaultBlock: 'transient-rename',
      i18n: { locale: 'en' },
      tools: { 'transient-rename': { class: TransientRenameTool, config: { initiallyEditing } } },
      onChange,
      data: { blocks: [{ id: 'b', type: 'transient-rename', data: { text: 'Resident text', filename: 'fixture.ts' } }] },
    });
    core = instance;
    await instance.isReady;
    const yjs = instance.moduleInstances.YjsManager;
    await new Promise<void>(resolve => {
      unsubscribes.push(yjs.onPendingBlockWritesSettled(() => resolve()));
    });
    await settle();
    const block = instance.moduleInstances.BlockManager.getBlockById('b');
    if (block === undefined) throw new Error('Missing fixture block.');
    const resident = block.holder.querySelector('[data-blok-testid="resident-text"]');
    const button = block.holder.querySelector('button');
    const initialRename = block.holder.querySelector('[data-blok-testid="transient-rename"]');
    const slot = block.holder.querySelector('[data-blok-testid="rename-slot"]');
    const toolRoot = resident?.parentElement;
    const chrome = slot?.closest('[data-blok-mutation-free="true"]');
    if (!(resident instanceof HTMLElement) || !(button instanceof HTMLButtonElement) ||
        !(slot instanceof HTMLElement) || !(toolRoot instanceof HTMLElement) || !(chrome instanceof HTMLElement)) {
      throw new Error('Missing resident field or rename chrome.');
    }
    if (initiallyEditing && !(initialRename instanceof HTMLInputElement)) {
      throw new Error('Missing initial rename input.');
    }
    const before = await block.data;
    const stateBefore = yjs.getStateVector();
    unsubscribes.push(yjs.onAnyDocUpdate(onWrite));
    onChange.mockClear();
    const primed = block.inputs;
    const events = instance.moduleInstances.EventsAPI;
    const delivered = new Promise<MutationRecord>(resolve => {
      const onDomChanged = (payload?: unknown): void => {
        if (typeof payload !== 'object' || payload === null ||
            !('mutations' in payload) || !Array.isArray(payload.mutations)) return;
        const mutations: unknown[] = payload.mutations;
        for (const mutation of mutations) {
          if (!(mutation instanceof MutationRecord) || mutation.type !== 'childList' || mutation.target !== slot) continue;
          const changedInput = initiallyEditing ? initialRename : slot.querySelector('input');
          const changedNodes = initiallyEditing ? mutation.removedNodes : mutation.addedNodes;
          if (!(changedInput instanceof HTMLInputElement) || !Array.from(changedNodes).includes(changedInput)) continue;
          if (slot.closest('[data-blok-mutation-free="true"]') !== chrome || !toolRoot.contains(chrome)) continue;
          resolve(mutation);
        }
      };
      events.on(RedactorDomChanged, onDomChanged);
      unsubscribes.push(() => events.off(RedactorDomChanged, onDomChanged));
    });

    button.click();
    const rename = block.holder.querySelector('[data-blok-testid="transient-rename"]');
    if (!initiallyEditing && !(rename instanceof HTMLInputElement)) {
      throw new Error('Rename action did not mount a native input.');
    }
    const expected = initiallyEditing ? [resident] : [rename, resident];
    const delivery = await delivered;
    await new Promise<void>(resolve => {
      unsubscribes.push(yjs.onPendingBlockWritesSettled(() => resolve()));
    });
    await settle();

    await vi.waitFor(() => {
      const current = block.inputs;
      expect(current).toHaveLength(expected.length);
      expected.forEach((input, index) => expect(current[index]).toBe(input));
    });
    const expectedBefore = initiallyEditing ? [initialRename, resident] : [resident];
    expect(primed).toHaveLength(expectedBefore.length);
    expectedBefore.forEach((input, index) => expect(primed[index]).toBe(input));
    expect(delivery.target).toBe(slot);
    expect(slot.closest('[data-blok-mutation-free="true"]')).toBe(chrome);
    expect(toolRoot.contains(chrome)).toBe(true);
    expect(rename === null).toBe(initiallyEditing);
    expect(await block.data).toEqual(before);
    expect(yjs.getStateVector()).toEqual(stateBefore);
    expect(onWrite).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
