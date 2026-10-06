import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import type { ToggleItemData, ToggleItemConfig } from '../../../../src/tools/toggle/types';
import { ToggleItem } from '../../../../src/tools/toggle';
import { TOGGLE_ATTR } from '../../../../src/tools/toggle/constants';
import { createViewStateStore, type ViewStateStore } from '../../../../src/components/utils/view-state-store';

const BLOCK_ID = 'toggle-1';

describe('Toggle personal open state', () => {
  let store: ViewStateStore;
  let isCreatedHere: ReturnType<typeof vi.fn<(id: string) => boolean>>;
  let dispatchChange: ReturnType<typeof vi.fn>;

  const createApi = (): API => ({
    i18n: { t: (key: string) => key, has: () => false },
    events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
    blocks: {
      getChildren: vi.fn().mockReturnValue([]),
      getBlockIndex: vi.fn().mockReturnValue(0),
    },
    viewState: {
      get: (id: string, key: string) => store.get(id, key),
      set: (id: string, key: string, value: unknown) => store.set(id, key, value),
      onChange: (id: string, key: string, listener: (value: unknown) => void) => store.subscribe(id, key, listener),
      isCreatedHere: (id: string) => isCreatedHere(id),
    },
  } as unknown as API);

  const createToggle = (
    data: ToggleItemData,
    readOnly = false
  ): ToggleItem => {
    const options: BlockToolConstructorOptions<ToggleItemData, ToggleItemConfig> = {
      data,
      config: {},
      api: createApi(),
      readOnly,
      block: { id: BLOCK_ID, dispatchChange } as never,
    };

    return new ToggleItem(options);
  };

  const openAttr = (element: HTMLElement): string | null => element.getAttribute(TOGGLE_ATTR.toggleOpen);

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    store = createViewStateStore({ scope: 'd' });
    isCreatedHere = vi.fn(() => false);
    dispatchChange = vi.fn();
  });

  afterEach(() => {
    store.destroy();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('is collapsed when nothing is stored, even if data says isOpen', () => {
    const tool = createToggle({ text: 'x', isOpen: true });
    const element = tool.render();

    tool.rendered();

    expect(openAttr(element)).toBe('false');
  });

  it('ignores the legacy isExpanded flag', () => {
    const tool = createToggle({ title: 'x', isExpanded: true } as unknown as ToggleItemData);
    const element = tool.render();

    expect(openAttr(element)).toBe('false');
    expect(tool.save()).not.toHaveProperty('isOpen');
  });

  it('never writes isOpen into saved data', () => {
    const tool = createToggle({ text: 'x' });

    tool.render();
    tool.expand();

    expect(tool.save()).not.toHaveProperty('isOpen');
  });

  it('stores the open state personally and does not dispatch a document change', () => {
    const tool = createToggle({ text: 'x' });

    tool.render();
    tool.expand();

    expect(store.get(BLOCK_ID, 'open')).toBe(true);
    expect(dispatchChange).not.toHaveBeenCalled();
  });

  it('opens from the stored personal state', () => {
    store.set(BLOCK_ID, 'open', true);

    const element = createToggle({ text: 'x' }).render();

    expect(openAttr(element)).toBe('true');
  });

  it('starts open for the tab that created it, and remembers that', () => {
    isCreatedHere.mockReturnValue(true);

    const tool = createToggle({ text: '' });
    const element = tool.render();

    tool.rendered();

    expect(openAttr(element)).toBe('true');
    expect(store.get(BLOCK_ID, 'open')).toBe(true);
  });

  it('keeps a stored collapsed state even when created here', () => {
    isCreatedHere.mockReturnValue(true);
    store.set(BLOCK_ID, 'open', false);

    const tool = createToggle({ text: '' });
    const element = tool.render();

    tool.rendered();

    expect(openAttr(element)).toBe('false');
  });

  it('follows another tab collapsing it', () => {
    const tool = createToggle({ text: 'x' });
    const element = tool.render();

    tool.expand();
    window.dispatchEvent(new StorageEvent('storage', {
      key: `blok:view:d:${BLOCK_ID}:open`,
      newValue: JSON.stringify({ v: false, t: 1 }),
      storageArea: localStorage,
    }));

    expect(openAttr(element)).toBe('false');
  });

  it('writes the store once per user toggle, despite its own change echo', () => {
    const setSpy = vi.spyOn(store, 'set');
    const tool = createToggle({ text: 'x' });

    tool.render();
    tool.expand();

    expect(setSpy).toHaveBeenCalledTimes(1);
  });

  it('stops following the store once removed', () => {
    const tool = createToggle({ text: 'x' });
    const element = tool.render();

    tool.removed();
    store.set(BLOCK_ID, 'open', true);

    expect(openAttr(element)).toBe('false');
  });

  it('stores the open state in read-only mode too', () => {
    const tool = createToggle({ text: 'x' }, true);

    tool.render();
    tool.expand();

    expect(store.get(BLOCK_ID, 'open')).toBe(true);
  });

  it('keeps the personal state across setData', () => {
    store.set(BLOCK_ID, 'open', true);

    const tool = createToggle({ text: 'x' });
    const element = tool.render();

    tool.setData({ text: 'y', isOpen: false });

    expect(openAttr(element)).toBe('true');
  });
});
