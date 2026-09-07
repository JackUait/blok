import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Header, type HeaderData } from '../../../../../src/tools/header';
import { BlockSettings } from '../../../../../src/components/modules/toolbar/blockSettings';
import { BlockToolAdapter } from '../../../../../src/components/tools/block';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import { PopoverDesktop } from '../../../../../src/components/utils/popover';
import type { Block } from '../../../../../src/components/block';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { API, BlockAPI } from '../../../../../types';
import en from '../../../../../src/components/i18n/locales/en.json';
import ru from '../../../../../src/components/i18n/locales/ru.json';

const translations: Record<string, string> = en;
const settingsInstances: BlockSettings[] = [];
const customPopovers: PopoverDesktop[] = [];

const createSettings = (data: Partial<HeaderData> = {}, locale: 'en' | 'ru' = 'en') => {
  const localizedTranslations: Record<string, string> = locale === 'ru' ? ru : en;
  const i18n = {
    t: (key: string) => localizedTranslations[key] ?? key,
    has: (key: string) => key in localizedTranslations,
    getLocale: () => locale,
    getEnglishTranslation: (key: string) => translations[key] ?? key,
  };
  const api = {
    styles: { block: 'blok-block' },
    i18n,
    events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
    blocks: { getChildren: () => [] },
  } as unknown as API;
  const header = new Header({
    api,
    block: { id: 'section', dispatchChange: vi.fn() } as unknown as BlockAPI,
    config: {},
    readOnly: false,
    data: { text: 'Section', level: 2, anchor: 'original-anchor', ...data },
  });
  const holder = document.createElement('div');

  holder.append(header.render());
  document.body.append(holder);
  const block = {
    id: 'section', name: 'header', holder, parentId: null,
    get pluginsContent() { return holder.firstElementChild; },
    createdAt: 0, lastEditedAt: 0,
    getTunes: () => ({ commonTunes: [], toolTunes: header.renderSettings() }),
    getActiveToolboxEntry: async () => ({ title: 'Heading 2' }),
    save: async () => ({ data: header.save(holder) }),
  } as unknown as Block;
  const tool = new BlockToolAdapter({
    name: 'header', constructable: Header, config: {}, api, isDefault: false, isInternal: false,
  });
  const convert = vi.fn(async () => null);
  const settings = new BlockSettings({ config: {}, eventsDispatcher: new EventsDispatcher<BlokEventMap>() });

  settings.state = {
    ReadOnly: { isEnabled: false, isControlsHidden: false },
    BlockSelection: { selectedBlocks: [], selectBlock: vi.fn(), clearCache: vi.fn(), unselectBlock: vi.fn() },
    BlockManager: { currentBlock: block, convert },
    CrossBlockSelection: { isCrossBlockSelectionStarted: false },
    Tools: { blockTools: new Map([['header', tool]]) },
    API: { methods: api },
    Toolbar: { close: vi.fn(), isPositionedRight: false },
    Caret: { setToBlock: vi.fn(), positions: { DEFAULT: 'default', END: 'end' } },
    I18n: i18n,
  } as unknown as BlokModules;
  settings.make();
  settingsInstances.push(settings);

  return { settings, block, header, holder, convert };
};

const getMenu = (): HTMLElement => {
  const menu = document.querySelector<HTMLElement>('[data-blok-testid="block-tunes-popover"]');

  if (menu === null) {
    throw new Error('Missing block settings');
  }

  return menu;
};

const search = (menu: HTMLElement, query: string): HTMLInputElement => {
  const input = menu.querySelector('input');

  if (input === null) {
    throw new Error('Missing settings search');
  }
  input.value = query;
  input.dispatchEvent(new Event('input', { bubbles: true }));

  return input;
};

describe('Heading search in real block settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    settingsInstances.splice(0).forEach(settings => {
      settings.close();
      settings.destroy();
    });
    customPopovers.splice(0).forEach(popover => popover.destroy());
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it.each([
    { locale: 'en', isToggleable: false, title: 'Heading 3' },
    { locale: 'en', isToggleable: true, title: 'Heading 3' },
    { locale: 'ru', isToggleable: false, title: 'Заголовок 3' },
    { locale: 'ru', isToggleable: true, title: 'Заголовок 3' },
  ] as const)('prefers the native level action for English search and preserves heading data ($locale, toggle: $isToggleable)', async ({ locale, isToggleable, title }) => {
    const { settings, block, header, holder, convert } = createSettings({
      ...(isToggleable ? { isToggleable: true, isOpen: false } : {}),
      textColor: 'red', backgroundColor: 'blue',
    }, locale);
    const child = document.createElement('p');

    child.textContent = 'Nested content';
    holder.querySelector('[data-blok-nested-blocks]')?.append(child);
    await settings.open(block);
    const menu = getMenu();
    const heading = holder.querySelector('h2');

    if (heading === null) {
      throw new Error('Missing rendered heading');
    }
    heading.innerHTML = '<b>Edited after opening</b>';
    search(menu, 'Heading 3');
    const level = menu.querySelector<HTMLElement>('[data-blok-item-name="header-level-3"]');

    expect(level?.getAttribute('data-blok-hidden')).not.toBe('true');
    expect(level?.textContent).toContain(title);
    const firstResult = menu.querySelector<HTMLElement>('[data-blok-popover-item]:not([data-blok-hidden])');

    expect(firstResult).toBe(level);
    if (firstResult === null) {
      throw new Error('Missing heading search result');
    }
    firstResult.click();

    expect(header.save(holder)).toEqual({
      text: '<b>Edited after opening</b>', level: 3, anchor: 'original-anchor',
      textColor: 'red', backgroundColor: 'blue',
      ...(isToggleable ? { isToggleable: true, isOpen: false } : {}),
    });
    expect(holder.querySelector('h3')?.id).toBe('original-anchor');
    expect(convert).not.toHaveBeenCalled();
    if (isToggleable) {
      expect(holder.querySelector('[data-blok-nested-blocks]')?.firstChild).toBe(child);
    }
  });

  it('keeps explicit conversion available when a native level action retains toggle state', async () => {
    const { settings, block } = createSettings({ isToggleable: true, isOpen: false });

    await settings.open(block);
    const menu = getMenu();
    const convertTo = menu.querySelector<HTMLElement>('[data-blok-item-name="convert-to"]');

    if (convertTo === null) {
      throw new Error('Missing conversion menu');
    }
    convertTo.click();

    expect(document.querySelector('[data-blok-item-name="header-3"]')?.textContent).toContain('Heading 3');
  });

  it('gives the built-in menu a 280px width for six heading targets', async () => {
    const { settings, block } = createSettings();

    await settings.open(block);

    expect(getMenu().style.getPropertyValue('--width')).toBe('280px');
  });

  it('does not change a custom popover width', () => {
    const popover = new PopoverDesktop({ items: [], width: '340px' });

    customPopovers.push(popover);
    popover.show();

    expect(popover.getElement().style.getPropertyValue('--width')).toBe('340px');
  });
});
