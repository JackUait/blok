import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { TabsTool } from '../../../../src/tools/tabs';
import { TabTool } from '../../../../src/tools/tab';
import type { API, OutputBlockData, OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  history: { undo: () => void; redo: () => void };
  readOnly: { toggle: (state?: boolean) => Promise<boolean> };
  module: {
    yjsManager: { stopCapturing: () => void };
    blockManager: { getBlockById: (id: string) => { getToolbarAnchorElement: () => HTMLElement | undefined } | undefined };
  };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => {
      setTimeout(resolve, 0);
    });
    await new Promise(resolve => {
      requestAnimationFrame(() => resolve(undefined));
    });
  }
};

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const boot = async (blocks: OutputBlockData[], readOnly = false): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    readOnly,
    tools: {
      paragraph: Paragraph,
      tabs: TabsTool,
      tab: TabTool,
    },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await settle();
  instance.module.yjsManager.stopCapturing();

  return instance;
};

const doc = (): OutputBlockData[] => [
  { id: 'tabs', type: 'tabs', data: {}, content: ['t1', 't2'] },
  { id: 't1', type: 'tab', data: { title: 'Do' }, parent: 'tabs', content: ['p1'] },
  { id: 'p1', type: 'paragraph', data: { text: 'one' }, parent: 't1' },
  { id: 't2', type: 'tab', data: { title: 'Don’t', icon: '🚫' }, parent: 'tabs', content: ['p2'] },
  { id: 'p2', type: 'paragraph', data: { text: 'two' }, parent: 't2' },
];

const pills = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'));

const holderOf = (id: string): HTMLElement => {
  const element = document.querySelector<HTMLElement>(`[data-blok-id="${id}"]`);

  if (element === null) {
    throw new Error(`no holder for ${id}`);
  }

  return element;
};

const byType = (data: OutputData, type: string): OutputBlockData[] => data.blocks.filter(block => block.type === type);

beforeEach(() => {
  vi.clearAllMocks();
  holder = document.createElement('div');
  document.body.appendChild(holder);
});

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  holder?.remove();
  holder = undefined;
  vi.restoreAllMocks();
});

describe('tabs block', () => {
  it('seeds three empty tabs named Tab 1-3 when a user inserts it', async () => {
    const instance = await boot([{ id: 'p0', type: 'paragraph', data: { text: '' } }]);

    instance.blocks.insert('tabs');
    await settle();

    const saved = await instance.save();
    const tabs = byType(saved, 'tab');

    expect(byType(saved, 'tabs')).toHaveLength(1);
    expect(tabs.map(tab => tab.data.title)).toEqual(['Tab 1', 'Tab 2', 'Tab 3']);
    expect(tabs.every(tab => (tab.content ?? []).length === 0)).toBe(true);
    expect(pills().map(pill => pill.textContent)).toEqual(['Tab 1', 'Tab 2', 'Tab 3']);
  });

  it('does not seed tabs when loading a saved document', async () => {
    const instance = await boot(doc());
    const saved = await instance.save();

    expect(byType(saved, 'tab').map(tab => tab.data)).toEqual([{ title: 'Do' }, { title: 'Don’t', icon: '🚫' }]);
    expect(pills()).toHaveLength(2);
  });

  it('shows only the first tab on load and does not save which tab is open', async () => {
    const instance = await boot(doc());

    expect(holderOf('t1').classList.contains('hidden')).toBe(false);
    expect(holderOf('t2').classList.contains('hidden')).toBe(true);
    expect(pills()[0].getAttribute('aria-selected')).toBe('true');

    const saved = await instance.save();

    expect(byType(saved, 'tabs')[0].data).toEqual({});
  });

  it('switches the visible panel when a tab is clicked', async () => {
    await boot(doc());

    pills()[1].click();
    await settle();

    expect(holderOf('t1').classList.contains('hidden')).toBe(true);
    expect(holderOf('t2').classList.contains('hidden')).toBe(false);
    expect(pills()[1].getAttribute('aria-selected')).toBe('true');
    expect(pills()[0].getAttribute('aria-selected')).toBe('false');
  });

  it('lets a dragged block drop onto a tab pill, into the end of that tab', async () => {
    await boot(doc());

    expect(pills().map(pill => pill.getAttribute('data-blok-drop-into'))).toEqual(['t1', 't2']);
  });

  it('labels each tab with its icon and title', async () => {
    await boot(doc());

    expect(pills()[1].textContent).toBe('🚫Don’t');
    expect(pills()[1].getAttribute('aria-controls')).toBe(holderOf('t2').querySelector('[role="tabpanel"]')?.id);
  });

  it('adds a tab named after its position and opens it', async () => {
    const instance = await boot(doc());
    const add = document.querySelector<HTMLElement>('[data-blok-tabs-add]');

    add?.click();
    await settle();

    const saved = await instance.save();

    expect(byType(saved, 'tab').map(tab => tab.data.title)).toEqual(['Do', 'Don’t', 'Tab 3']);
    expect(pills()[2].getAttribute('aria-selected')).toBe('true');
  });

  it('opens a new tab with its title in edit mode, all selected', async () => {
    const instance = await boot(doc());

    document.querySelector<HTMLElement>('[data-blok-tabs-add]')?.click();
    await settle();

    const input = pills()[2].querySelector<HTMLInputElement>('[data-blok-tabs-rename-input]');

    expect(input).not.toBeNull();
    expect(input).toHaveFocus();
    expect(input?.value).toBe('Tab 3');
    expect([input?.selectionStart, input?.selectionEnd]).toEqual([0, 'Tab 3'.length]);

    if (input !== null && input !== undefined) {
      input.value = 'Notes';
    }
    input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();

    const saved = await instance.save();

    expect(byType(saved, 'tab').map(tab => tab.data.title)).toEqual(['Do', 'Don’t', 'Notes']);
  });

  it('renames a tab and saves the new title', async () => {
    const instance = await boot(doc());

    instance.blocks.getById('tabs')?.call('renameTab', { id: 't1', title: '  Rules  ' });
    await settle();

    const saved = await instance.save();

    expect(byType(saved, 'tab')[0].data.title).toBe('Rules');
    expect(pills()[0].textContent).toBe('Rules');
  });

  it('deletes a tab together with its content and opens a neighbour', async () => {
    const instance = await boot(doc());

    instance.blocks.getById('tabs')?.call('deleteTab', { id: 't1' });
    await settle();

    const saved = await instance.save();

    expect(saved.blocks.map(block => block.id)).toEqual(['tabs', 't2', 'p2']);
    expect(pills()).toHaveLength(1);
    expect(holderOf('t2').classList.contains('hidden')).toBe(false);
  });

  it('never deletes the last tab', async () => {
    const instance = await boot(doc());
    const tabs = instance.blocks.getById('tabs');

    tabs?.call('deleteTab', { id: 't1' });
    await settle();
    tabs?.call('deleteTab', { id: 't2' });
    await settle();

    const saved = await instance.save();

    expect(byType(saved, 'tab').map(tab => tab.id)).toEqual(['t2']);
  });

  it('shows a placeholder in an empty tab and adds a block when it is clicked', async () => {
    const instance = await boot([
      { id: 'tabs', type: 'tabs', data: {}, content: ['t1'] },
      { id: 't1', type: 'tab', data: { title: 'Tab 1' }, parent: 'tabs' },
    ]);
    const placeholder = holderOf('t1').querySelector<HTMLElement>('[data-blok-tab-empty]');

    expect(placeholder?.classList.contains('hidden')).toBe(false);
    // Core's drag treats this zone as "drop as first child of the tab".
    expect(placeholder?.hasAttribute('data-blok-drop-into')).toBe(true);

    placeholder?.click();
    await settle();

    const saved = await instance.save();
    const paragraph = byType(saved, 'paragraph')[0];

    expect(paragraph?.parent).toBe('t1');
    expect(placeholder?.classList.contains('hidden')).toBe(true);
  });

  it('removes the whole new block with one undo', async () => {
    const instance = await boot([{ id: 'p0', type: 'paragraph', data: { text: 'keep' } }]);

    instance.blocks.insert('tabs');
    await settle();
    instance.module.yjsManager.stopCapturing();
    instance.history.undo();
    await settle();

    const saved = await instance.save();

    expect(saved.blocks.map(block => block.type)).toEqual(['paragraph']);
  });

  it('renders only tab children as tabs', async () => {
    await boot([
      { id: 'tabs', type: 'tabs', data: {}, content: ['t1', 'rogue'] },
      { id: 't1', type: 'tab', data: { title: 'Real' }, parent: 'tabs' },
      { id: 'rogue', type: 'paragraph', data: { text: 'stray' }, parent: 'tabs' },
    ]);

    expect(pills().map(pill => pill.textContent)).toEqual(['Real']);
  });

  it('lets a reader switch tabs but not add or edit them', async () => {
    await boot(doc(), true);

    expect(document.querySelector('[data-blok-tabs-add]')).toBeNull();

    pills()[1].click();
    await settle();

    expect(holderOf('t2').classList.contains('hidden')).toBe(false);
  });

  it('reorders tabs and keeps each tab with its content', async () => {
    const instance = await boot(doc());

    instance.blocks.getById('tabs')?.call('moveTab', { id: 't2', before: 't1' });
    await settle();

    const saved = await instance.save();

    expect(saved.blocks.map(block => block.id)).toEqual(['tabs', 't2', 'p2', 't1', 'p1']);
    expect(pills().map(pill => pill.dataset.tabId)).toEqual(['t2', 't1']);
    expect(holderOf('t1').classList.contains('hidden')).toBe(false);
  });

  it('anchors the block toolbar on the tab strip, not on content in a hidden tab', async () => {
    const instance = await boot(doc());
    const anchor = instance.module.blockManager.getBlockById('tabs')?.getToolbarAnchorElement();

    expect(anchor?.closest('[data-blok-tabs-strip]') instanceof HTMLElement).toBe(true);
  });

  it('marks the empty-tab hint as a stand-in for the first block', async () => {
    await boot([
      { id: 'tabs', type: 'tabs', data: {}, content: ['t1'] },
      { id: 't1', type: 'tab', data: { title: 'Empty' }, parent: 'tabs', content: [] },
    ]);

    expect(document.querySelector('[data-blok-tab-empty]')?.hasAttribute('data-blok-child-stand-in')).toBe(true);
  });

  it('opens a labelled tab menu from the context menu', async () => {
    await boot(doc());

    expect(pills()[0].getAttribute('aria-haspopup')).toBe('menu');
    pills()[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await settle();

    const menu = document.querySelector('[role="menu"][aria-label="Tab options"]');


    expect(menu?.textContent).toContain('Rename');
    expect(menu?.textContent).toContain('Delete');
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
  });

  it.each([0, 1])('opens the tab menu, not a rename, on a double-click of tab %i', async (index) => {
    await boot(doc());

    const pill = pills()[index];

    pill.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    pill.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 2 }));
    pill.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2 }));
    await settle();

    expect(document.querySelector('[data-blok-tabs-rename-input]')).toBeNull();
    expect(document.querySelectorAll('[role="menu"][aria-label="Tab options"]')).toHaveLength(1);
    expect(pills()[index].getAttribute('aria-expanded')).toBe('true');
  });

  it('puts the strip back in order when a reorder is undone', async () => {
    const instance = await boot(doc());

    instance.blocks.getById('tabs')?.call('moveTab', { id: 't2', before: 't1' });
    await settle();
    instance.module.yjsManager.stopCapturing();
    instance.history.undo();
    await settle();

    const saved = await instance.save();

    expect(byType(saved, 'tab').map(tab => tab.id)).toEqual(['t1', 't2']);
    expect(pills().map(pill => pill.getAttribute('data-tab-id'))).toEqual(['t1', 't2']);
  });

  it.each(['Enter', 'Escape'])('keeps focus on the tab after a keyboard rename ends with %s', async (key) => {
    await boot(doc());

    pills()[0].focus();
    pills()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }));
    await settle();

    const input = document.querySelector<HTMLInputElement>('[data-blok-tabs-rename-input]');

    expect(input).not.toBeNull();
    input?.focus();
    if (input !== null) {
      input.value = 'Rules';
    }
    input?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    await settle();

    expect(document.activeElement?.getAttribute('data-tab-id')).toBe('t1');
  });

  it('reopens the tab that was open when deleting the whole block is undone', async () => {
    const instance = await boot(doc());

    pills()[1].click();
    await settle();
    instance.module.yjsManager.stopCapturing();

    const index = instance.blocks.getBlockIndex('tabs');

    await instance.blocks.delete(index);
    await settle();
    instance.module.yjsManager.stopCapturing();
    instance.history.undo();
    await settle();

    expect(pills().map(pill => pill.getAttribute('aria-selected'))).toEqual(['false', 'true']);
  });

  it('follows a remote rename of a tab', async () => {
    const instance = await boot(doc());

    await instance.blocks.update('t2', { title: 'Avoid' });
    await settle();

    expect(pills()[1].textContent).toBe('🚫Avoid');
  });
});

describe('tabs block: strip overflow', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // A block that mounts hidden (a closed toggle, another tab) measures a
  // zero-width strip; only a later resize can tell it the tabs overflow.
  it('re-measures the edge fade when the strip changes size', async () => {
    const callbacks: ResizeObserverCallback[] = [];

    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback);
      }

      public observe(): void {}

      public disconnect(): void {}

      public unobserve(): void {}
    });

    await boot(doc());

    const scroller = document.querySelector<HTMLElement>('[data-blok-tabs-scroller]');

    if (scroller === null) {
      throw new Error('no scroller');
    }

    expect(scroller.hasAttribute('data-overflow-end')).toBe(false);

    Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: 600 });
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 300 });
    callbacks.forEach(callback => callback([], {} as ResizeObserver));

    expect(scroller.hasAttribute('data-overflow-end')).toBe(true);
  });

  // A web font that lands after mount widens the pills, not the strip.
  it('refits the open tab backdrop when its pill changes size', async () => {
    const observers: Array<{ callback: ResizeObserverCallback; targets: Set<Element> }> = [];

    vi.stubGlobal('ResizeObserver', class {
      private readonly entry: { callback: ResizeObserverCallback; targets: Set<Element> };

      constructor(callback: ResizeObserverCallback) {
        this.entry = { callback, targets: new Set() };
        observers.push(this.entry);
      }

      public observe(target: Element): void {
        this.entry.targets.add(target);
      }

      public disconnect(): void {
        this.entry.targets.clear();
      }

      public unobserve(target: Element): void {
        this.entry.targets.delete(target);
      }
    });

    await boot(doc());

    const pill = pills()[0];
    const indicator = document.querySelector<HTMLElement>('[data-blok-tabs-indicator]');

    if (indicator === null) {
      throw new Error('no indicator');
    }

    Object.defineProperty(pill, 'offsetWidth', { configurable: true, value: 84 });
    observers
      .filter(observer => observer.targets.has(pill))
      .forEach(observer => observer.callback([], {} as ResizeObserver));

    expect(indicator.style.width).toBe('84px');
    expect(indicator.hasAttribute('data-placed')).toBe(true);
  });
});
