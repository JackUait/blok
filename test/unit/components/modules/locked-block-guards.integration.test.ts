/**
 * A selected block whose tool says it is locked (BlockTool.isLocked), like a
 * locked database, ignores Backspace, Delete, Cmd+D and Cmd+Shift+D, and a
 * drag from its handle draws no drop line and does not move it
 * (notion-motion.md Round 68 §1). A cut still removes it, as in Notion.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../src/components/core';
import { destroy as destroyTooltip } from '../../../../src/components/utils/tooltip';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { OutputBlockData } from '../../../../types';

const questions: Array<(answer: boolean) => void> = [];
const lock = { on: true };

/** Asks before it goes and is locked while `lock.on`, as a locked database. */
class LockedTool {
  public static get toolbox(): { title: string; icon: string } {
    return { title: 'Locked', icon: '' };
  }

  public render(): HTMLElement {
    const element = document.createElement('div');

    element.textContent = 'locked';

    return element;
  }

  public save(): Record<string, never> {
    return {};
  }

  public isLocked(): boolean {
    return lock.on;
  }

  public contentBlockIds(): string[] {
    return ['child'];
  }

  public confirmDelete(): Promise<boolean> {
    return new Promise((resolve) => {
      questions.push(resolve);
    });
  }
}

let holder: HTMLDivElement | undefined;
let core: Core | undefined;

const quiet = async (): Promise<void> => {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  for (let frame = 0; frame < 3; frame++) {
    await new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });
  }
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
};

const blocks: OutputBlockData[] = [
  { id: 'p1', type: 'paragraph', data: { text: 'one' } },
  { id: 'lk', type: 'locked', data: {}, content: ['child'] },
  { id: 'child', type: 'paragraph', parent: 'lk', data: { text: 'row' } },
  { id: 'p2', type: 'paragraph', data: { text: 'two' } },
];

const boot = async (): Promise<Core> => {
  holder = document.createElement('div');
  document.body.appendChild(holder);
  const instance = new Core({
    holder, tabSync: false, dataModel: 'hierarchical', i18n: { locale: 'en' },
    tools: { paragraph: Paragraph, locked: LockedTool },
    data: { blocks },
  });

  core = instance;
  await instance.isReady;
  await quiet();

  return instance;
};

const block = (instance: Core, id: string): NonNullable<ReturnType<Core['moduleInstances']['BlockManager']['getBlockById']>> => {
  const found = instance.moduleInstances.BlockManager.getBlockById(id);

  if (found === undefined) throw new Error(`missing block ${id}`);

  return found;
};

const ids = (instance: Core): string[] => instance.moduleInstances.BlockManager.blocks.map((candidate) => candidate.id);
const selectedIds = (instance: Core): string[] => instance.moduleInstances.BlockManager.blocks.filter((candidate) => candidate.selected).map((candidate) => candidate.id);

const select = (instance: Core, ...selected: string[]): void => {
  instance.moduleInstances.BlockSelection.clearSelection();
  selected.forEach((id) => instance.moduleInstances.BlockSelection.selectBlock(block(instance, id)));
};

const press = (key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });

  document.body.dispatchEvent(event);

  return event;
};

/** Cmd+D on a Mac, Ctrl+D elsewhere: both modifiers, as the shortcut reads either. */
const duplicateKey = (shiftKey = false): KeyboardEvent =>
  press(shiftKey ? 'D' : 'd', { code: 'KeyD', metaKey: true, ctrlKey: true, shiftKey });

/** Drags `id` by a handle and releases on the bottom half of `targetId`; returns whether a drop line showed. */
const dragOnto = async (instance: Core, id: string, targetId: string): Promise<boolean> => {
  const { DragManager } = instance.moduleInstances;
  const target = block(instance, targetId).holder;
  const rect = { top: 100, bottom: 140, left: 0, right: 600, width: 600, height: 40, x: 0, y: 100, toJSON: () => ({}) };

  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(rect);
  const content = target.querySelector<HTMLElement>('[data-blok-element-content]');

  if (content !== null) vi.spyOn(content, 'getBoundingClientRect').mockReturnValue(rect);
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });

  const handle = document.createElement('button');
  const cleanup = DragManager.setupDragHandle(handle, block(instance, id));

  document.body.appendChild(handle);
  handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 50, clientY: 300 }));
  document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 50, clientY: 130 }));
  document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 50, clientY: 135 }));
  const lineShown = target.hasAttribute('data-drop-indicator');

  document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 50, clientY: 135 }));
  await quiet();
  cleanup();
  handle.remove();

  return lineShown;
};

const hasMarkDestroyed = (value: unknown): value is { markDestroyed(): void } =>
  typeof value === 'object' && value !== null && 'markDestroyed' in value && typeof value.markDestroyed === 'function';
const hasDestroy = (value: unknown): value is { destroy(): void | Promise<void> } =>
  typeof value === 'object' && value !== null && 'destroy' in value && typeof value.destroy === 'function';

const destroyCore = async (instance: Core): Promise<void> => {
  const modules: unknown[] = Object.values(instance.moduleInstances);

  modules.filter(hasMarkDestroyed).forEach((module) => module.markDestroyed());
  await Promise.all(modules.filter(hasDestroy).map((module) => module.destroy()));
};

describe('a selected locked block', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    questions.length = 0;
    lock.on = true;
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
  });

  afterEach(async () => {
    if (core !== undefined) await destroyCore(core);
    core = undefined;
    holder?.remove();
    holder = undefined;
    destroyTooltip();
    document.body.innerHTML = '';
    Reflect.deleteProperty(document, 'elementFromPoint');
    vi.restoreAllMocks();
  });

  it.each(['Backspace', 'Delete'])('ignores %s: no question, the block stays selected', async (key) => {
    const instance = await boot();

    select(instance, 'lk');
    press(key);
    await quiet();
    press(key);
    await quiet();

    expect(questions).toHaveLength(0);
    expect(ids(instance)).toEqual(['p1', 'lk', 'child', 'p2']);
    expect(selectedIds(instance)).toEqual(['lk']);
  });

  it('still asks before Backspace once unlocked', async () => {
    lock.on = false;
    const instance = await boot();

    select(instance, 'lk');
    press('Backspace');
    await quiet();

    expect(questions).toHaveLength(1);
  });

  it('ignores Cmd+D and Cmd+Shift+D: no copy', async () => {
    const instance = await boot();

    select(instance, 'lk');
    duplicateKey();
    await quiet();
    duplicateKey(true);
    await quiet();

    expect(instance.moduleInstances.BlockManager.blocks.filter((candidate) => candidate.name === 'locked')).toHaveLength(1);
    expect(selectedIds(instance)).toEqual(['lk']);
  });

  it('still copies with Cmd+D once unlocked', async () => {
    lock.on = false;
    const instance = await boot();

    select(instance, 'lk');
    duplicateKey();
    await quiet();

    expect(instance.moduleInstances.BlockManager.blocks.filter((candidate) => candidate.name === 'locked')).toHaveLength(2);
  });

  it('a cut still removes it, as Notion\'s cut did', async () => {
    const instance = await boot();
    const data = new Map<string, string>();
    const event = new Event('cut', { bubbles: true, cancelable: true });

    Object.defineProperty(event, 'clipboardData', {
      value: { setData: (type: string, value: string): void => { data.set(type, value); }, getData: (type: string): string => data.get(type) ?? '' },
    });
    select(instance, 'lk');
    document.dispatchEvent(event);
    await quiet();

    expect(ids(instance)).not.toContain('lk');
  });

  it('a drag from its handle shows no drop line and does not move it', async () => {
    const instance = await boot();

    select(instance, 'lk');
    const lineShown = await dragOnto(instance, 'lk', 'p2');

    expect(lineShown).toBe(false);
    expect(ids(instance)).toEqual(['p1', 'lk', 'child', 'p2']);
    expect(selectedIds(instance)).toEqual(['lk']);
  });

  it('a drag of the same block once unlocked draws the line and moves it', async () => {
    lock.on = false;
    const instance = await boot();

    select(instance, 'lk');
    const lineShown = await dragOnto(instance, 'lk', 'p2');

    expect(lineShown).toBe(true);
    expect(ids(instance).indexOf('lk')).toBeGreaterThan(ids(instance).indexOf('p2'));
  });
});
