import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import { Header, type HeaderConfig, type HeaderData } from '../../../../src/tools/header';
import { TOGGLE_ATTR } from '../../../../src/tools/toggle/constants';
import { createViewStateStore, type ViewStateStore } from '../../../../src/components/utils/view-state-store';

const BLOCK_ID = 'heading-1';

describe('Toggle heading personal open state', () => {
  let store: ViewStateStore;
  let isCreatedHere: ReturnType<typeof vi.fn<(id: string) => boolean>>;
  let dispatchChange: ReturnType<typeof vi.fn>;

  const createApi = (): API => ({
    styles: { block: 'blok-block' },
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

  const createHeading = (
    data: Partial<HeaderData> & Record<string, unknown> = {},
    readOnly = false
  ): Header => {
    const options: BlockToolConstructorOptions<HeaderData, HeaderConfig> = {
      data: { text: 'x', level: 2, isToggleable: true, ...data },
      config: {},
      api: createApi(),
      readOnly,
      block: { id: BLOCK_ID, dispatchChange } as never,
    };

    return new Header(options);
  };

  const openAttr = (root: HTMLElement): string | null | undefined => {
    const selector = `[${TOGGLE_ATTR.toggleOpen}]`;
    const host = root.matches(selector) ? root : root.querySelector(selector);

    return host?.getAttribute(TOGGLE_ATTR.toggleOpen);
  };

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
    const tool = createHeading({ isOpen: true });
    const element = tool.render();

    tool.rendered();

    expect(openAttr(element)).toBe('false');
  });

  it('never writes isOpen into saved data', () => {
    const tool = createHeading();
    const element = tool.render();

    tool.expand();

    const saved = tool.save(element);

    expect(saved).not.toHaveProperty('isOpen');
    expect(saved.isToggleable).toBe(true);
  });

  it('stores the open state personally and does not dispatch a document change', () => {
    const tool = createHeading();

    tool.render();
    tool.expand();

    expect(store.get(BLOCK_ID, 'open')).toBe(true);
    expect(dispatchChange).not.toHaveBeenCalled();

    tool.collapse();

    expect(store.get(BLOCK_ID, 'open')).toBe(false);
    expect(dispatchChange).not.toHaveBeenCalled();
  });

  it('opens from the stored personal state', () => {
    store.set(BLOCK_ID, 'open', true);

    const element = createHeading().render();

    expect(openAttr(element)).toBe('true');
  });

  it('starts open for the tab that created it, and remembers that', () => {
    isCreatedHere.mockReturnValue(true);

    const tool = createHeading({ text: '' });
    const element = tool.render();

    tool.rendered();

    expect(openAttr(element)).toBe('true');
    expect(store.get(BLOCK_ID, 'open')).toBe(true);
  });

  it('keeps a stored collapsed state even when created here', () => {
    isCreatedHere.mockReturnValue(true);
    store.set(BLOCK_ID, 'open', false);

    const tool = createHeading({ text: '' });
    const element = tool.render();

    tool.rendered();

    expect(openAttr(element)).toBe('false');
  });

  it('does not store an open state for a plain heading created here', () => {
    isCreatedHere.mockReturnValue(true);

    const tool = createHeading({ isToggleable: false });

    tool.render();
    tool.rendered();

    expect(store.get(BLOCK_ID, 'open')).toBeUndefined();
  });

  it('follows another tab collapsing it', () => {
    const tool = createHeading();
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
    const tool = createHeading();

    tool.render();
    tool.expand();

    expect(setSpy).toHaveBeenCalledTimes(1);
  });

  it('stops following the store once removed', () => {
    const tool = createHeading();
    const element = tool.render();

    tool.removed();
    store.set(BLOCK_ID, 'open', true);

    expect(openAttr(element)).toBe('false');
  });

  it('stops following the store once destroyed', () => {
    const tool = createHeading();
    const element = tool.render();

    tool.destroy();
    store.set(BLOCK_ID, 'open', true);

    expect(openAttr(element)).toBe('false');
  });

  it('stores the open state in read-only mode too', () => {
    const tool = createHeading({}, true);

    tool.render();
    tool.expand();

    expect(store.get(BLOCK_ID, 'open')).toBe(true);
  });

  it('keeps the personal state across setData', () => {
    store.set(BLOCK_ID, 'open', true);

    const tool = createHeading();
    const element = tool.render();

    tool.setData({ text: 'y', level: 2, isToggleable: true, isOpen: false });

    expect(openAttr(element)).toBe('true');
  });
});
