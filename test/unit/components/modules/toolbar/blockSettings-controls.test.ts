import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockSettings } from '../../../../../src/components/modules/toolbar/blockSettings';
import { BlockToolAdapter } from '../../../../../src/components/tools/block';
import { Header } from '../../../../../src/tools/header';
import type { API } from '../../../../../types';
import type { Block } from '../../../../../src/components/block';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { MenuConfigItem } from '../../../../../types/tools';
import { PopoverItemType } from '../../../../../src/components/utils/popover';
import en from '../../../../../src/components/i18n/locales/en.json';

const translations: Record<string, string> = en;
const settingsInstances: BlockSettings[] = [];

const createSettings = (commonTunes: MenuConfigItem[], toolTunes: MenuConfigItem[] = []) => {
  const holder = document.createElement('div');
  const content = document.createElement('p');

  holder.append(content);
  document.body.append(holder);
  const block = {
    id: 'section', name: 'custom-heading', parentId: null, holder, pluginsContent: content,
    createdAt: 0, lastEditedAt: 0,
    getTunes: () => ({ commonTunes, toolTunes }),
    getActiveToolboxEntry: async () => ({ title: 'Custom title', icon: '<svg></svg>' }),
    save: async () => ({ data: { text: 'Section' } }),
  } as unknown as Block;
  const settings = new BlockSettings({ config: {}, eventsDispatcher: new EventsDispatcher<BlokEventMap>() });
  const duplicate = vi.fn();
  const modules = {
    ReadOnly: { isEnabled: false, isControlsHidden: false },
    BlockSelection: { selectedBlocks: [] as Block[], selectBlock: vi.fn(), clearCache: vi.fn(), unselectBlock: vi.fn() },
    BlockManager: { currentBlock: block },
    CrossBlockSelection: { isCrossBlockSelectionStarted: false },
    Tools: { blockTools: new Map<string, BlockToolAdapter>() },
    API: { methods: {} },
    Toolbar: { close: vi.fn(), isPositionedRight: false },
    DragManager: { duplicateBlocksInPlace: duplicate },
    I18n: {
      t: (key: string) => translations[key] ?? key,
      has: (key: string) => key in translations,
      getLocale: () => 'en',
      getEnglishTranslation: (key: string) => translations[key] ?? key,
    },
  };

  settings.state = modules as unknown as BlokModules;
  settings.make();
  settingsInstances.push(settings);

  return { settings, block, duplicate, modules };
};

describe('Block settings control groups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    settingsInstances.splice(0).forEach(settings => {
      settings.close();
      settings.destroy();
    });
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it.each(['heading', 'color'])('starts with %s controls instead of a current-block label', async (firstControl) => {
    const { settings, block } = createSettings([], [
      { name: firstControl, title: firstControl === 'heading' ? 'Heading' : 'Color', onActivate: vi.fn() },
    ]);

    await settings.open(block);
    const menu = document.querySelector('[data-blok-testid="block-tunes-popover"]');
    const items = menu?.querySelector('[data-blok-popover-items]');

    expect(items?.firstElementChild?.getAttribute('data-blok-item-name')).toBe(firstControl);
    expect(menu?.textContent).not.toContain('Custom title');
    expect(menu?.querySelector('[data-blok-item-name="block-identity"]')).toBeNull();
  });

  it.each([false, true])('keeps tool tunes and conversion in one formatting group (selected: %s)', async (selected) => {
    const { settings, block, modules } = createSettings([
      { name: 'first-custom', title: 'First custom', onActivate: vi.fn() },
      { name: 'delete', title: 'Delete', onActivate: vi.fn() },
      { name: 'last-custom', title: 'Last custom', onActivate: vi.fn() },
    ], [
      { name: 'heading', title: 'Heading', onActivate: vi.fn() },
      { name: 'color', title: 'Color', onActivate: vi.fn() },
    ]);

    modules.Tools.blockTools.set('header', new BlockToolAdapter({
      name: 'header', constructable: Header, config: {}, api: modules.API.methods as API,
      isDefault: false, isInternal: false,
    }));
    modules.BlockSelection.selectedBlocks = selected ? [block] : [];

    await settings.open(block);
    const menu = document.querySelector('[data-blok-testid="block-tunes-popover"]');
    const convert = menu?.querySelector('[data-blok-item-name="convert-to"]');

    expect(convert?.previousElementSibling?.getAttribute('data-blok-item-name')).toBe('color');
    expect(convert?.nextElementSibling?.getAttribute('role')).toBe('separator');
    const items = Array.from(menu?.querySelectorAll('[role="menuitem"], [role="separator"]') ?? []);

    expect(items.map(item => item.getAttribute('data-blok-item-name') ?? item.getAttribute('role'))).toEqual([
      'heading', 'color', 'convert-to', 'separator',
      'first-custom', 'last-custom', 'duplicate', 'separator', 'delete', 'separator',
    ]);
  });

  it('separates tool controls from actions when the block converts to nothing', async () => {
    const { settings, block } = createSettings([
      { name: 'first-custom', title: 'First custom', onActivate: vi.fn() },
      { name: 'delete', title: 'Delete', onActivate: vi.fn() },
    ], [{ name: 'text-size', title: 'Text size', onActivate: vi.fn() }]);

    await settings.open(block);
    const menu = document.querySelector('[data-blok-testid="block-tunes-popover"]');
    const items = Array.from(menu?.querySelectorAll('[role="menuitem"], [role="separator"]') ?? []);

    expect(items.map(item => item.getAttribute('data-blok-item-name') ?? item.getAttribute('role'))).toEqual([
      'text-size', 'separator', 'first-custom', 'duplicate', 'separator', 'delete', 'separator',
    ]);
  });

  it('keeps read-only menus limited to copy link', async () => {
    const { settings, block, modules } = createSettings([
      { name: 'delete', title: 'Delete', onActivate: vi.fn() },
      { name: 'copy-link', title: 'Copy link', onActivate: vi.fn() },
    ], [{ name: 'color', title: 'Color', onActivate: vi.fn() }]);

    modules.Tools.blockTools.set('header', new BlockToolAdapter({
      name: 'header', constructable: Header, config: {}, api: modules.API.methods as API,
      isDefault: false, isInternal: false,
    }));
    modules.ReadOnly.isEnabled = true;

    await settings.open(block);
    const menu = document.querySelector('[data-blok-testid="block-tunes-popover"]');
    const actions = Array.from(menu?.querySelectorAll('[role="menuitem"]') ?? []);

    expect(actions.map(item => item.getAttribute('data-blok-item-name'))).toEqual(['copy-link']);
  });

  it('keeps multi-selection formatting separate from duplicate and delete', async () => {
    const { settings, block, modules } = createSettings([
      { name: 'custom-action', title: 'Custom action', onActivate: vi.fn() },
      { name: 'delete', title: 'Delete', onActivate: vi.fn() },
    ], [{ name: 'color', title: 'Color', onActivate: vi.fn() }]);

    modules.BlockSelection.selectedBlocks = [block, { ...block, id: 'second' } as Block];

    await settings.open(block);
    const menu = document.querySelector('[data-blok-testid="block-tunes-popover"]');
    const items = Array.from(menu?.querySelectorAll('[role="menuitem"], [role="separator"]') ?? []);

    expect(items.map(item => item.getAttribute('data-blok-item-name') ?? item.getAttribute('role'))).toEqual([
      'convert-to', 'separator', 'duplicate', 'separator', 'delete', 'separator',
    ]);
  });

  it.each(['root', 'nested'] as const)('keeps Delete editing the %s search without deleting the block', async (level) => {
    const { settings, block } = createSettings([
      { name: 'delete', title: 'Delete', onActivate: () => block.holder.remove() },
    ], [{
      name: 'search-submenu',
      title: 'More actions',
      children: {
        searchable: true,
        items: [{ name: 'nested-action', title: 'Nested action', onActivate: vi.fn() }],
      },
    }]);

    await settings.open(block);
    const menu = document.querySelector('[data-blok-testid="block-tunes-popover"]');

    if (!(menu instanceof HTMLElement)) {
      throw new Error('Block settings did not open');
    }
    if (level === 'nested') {
      const trigger = menu.querySelector('[data-blok-item-name="search-submenu"]');

      if (!(trigger instanceof HTMLElement)) {
        throw new Error('Nested menu trigger is missing');
      }
      trigger.click();
    }

    const inputs = menu.querySelectorAll('input[type="search"]');

    expect(inputs).toHaveLength(level === 'root' ? 1 : 2);
    const input = inputs.item(inputs.length - 1);

    if (!(input instanceof HTMLInputElement)) {
      throw new Error('Search input is missing');
    }
    input.focus();
    input.value = 'Heading';
    const event = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });

    input.dispatchEvent(event);

    expect(block.holder.isConnected).toBe(true);
    expect(settings.opened).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });

  it.each(['textarea', 'contenteditable', 'plaintext-only'] as const)(
    'keeps Delete editing a custom %s control without deleting the block',
    async (kind) => {
      const input = document.createElement(kind === 'textarea' ? 'textarea' : 'div');

      if (kind !== 'textarea') {
        input.contentEditable = kind === 'plaintext-only' ? 'plaintext-only' : 'true';
      }
      const { settings, block } = createSettings([
        { name: 'delete', title: 'Delete', onActivate: () => block.holder.remove() },
      ], [{ type: PopoverItemType.Html, element: input }]);

      await settings.open(block);
      expect(settings.contains(input)).toBe(true);
      const event = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });

      input.dispatchEvent(event);

      expect(block.holder.isConnected).toBe(true);
      expect(settings.opened).toBe(true);
      expect(event.defaultPrevented).toBe(false);
    }
  );

  it('keeps Delete removing the block from a noneditable menu action', async () => {
    const { settings, block } = createSettings([
      { name: 'delete', title: 'Delete', onActivate: () => block.holder.remove() },
    ]);

    await settings.open(block);
    const action = document.querySelector('[data-blok-testid="block-tunes-popover"] [data-blok-item-name="duplicate"]');

    if (!(action instanceof HTMLElement)) {
      throw new Error('Noneditable menu action is missing');
    }
    const event = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });

    action.dispatchEvent(event);

    expect(block.holder.isConnected).toBe(false);
    expect(settings.opened).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it('keeps custom action order and duplicate behavior while separating delete last', async () => {
    const first = vi.fn();
    const last = vi.fn();
    const remove = vi.fn();
    const { settings, block, duplicate } = createSettings([
      { name: 'first-custom', title: 'First custom', onActivate: first },
      { name: 'delete', title: 'Delete', onActivate: remove },
      { name: 'last-custom', title: 'Last custom', onActivate: last },
    ]);

    await settings.open(block);
    const menu = document.querySelector('[data-blok-testid="block-tunes-popover"]');
    const actions = Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

    expect(actions.map(item => item.getAttribute('data-blok-item-name'))).toEqual(['first-custom', 'last-custom', 'duplicate', 'delete']);
    const deleteElement = actions.at(-1);

    expect(deleteElement?.previousElementSibling?.getAttribute('role')).toBe('separator');
    actions[1].click();
    expect(last).toHaveBeenCalledTimes(1);
    actions[2].click();
    expect(duplicate).toHaveBeenCalledWith(block);
    expect(remove).not.toHaveBeenCalled();
  });
});
