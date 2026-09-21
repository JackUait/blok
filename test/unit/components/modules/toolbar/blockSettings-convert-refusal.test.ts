/**
 * The "Turn into" submenu in block settings when the conversion is REFUSED
 * (a peer is editing the block, so `BlockManager.convert()` rejects).
 *
 * The popover invokes `onActivate` inside a SYNCHRONOUS try/catch, which
 * cannot catch an async rejection — so the rejection escaped and the
 * `Toolbar.close()` after the await never ran, leaving the menu open over a
 * conversion that did not happen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BlockSettings } from '../../../../../src/components/modules/toolbar/blockSettings';
import { BlockToolAdapter } from '../../../../../src/components/tools/block';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import { Header } from '../../../../../src/tools/header';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { Block } from '../../../../../src/components/block';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { API, BlockToolConstructable } from '../../../../../types';
import en from '../../../../../src/components/i18n/locales/en.json';

const messages: Record<string, string> = en;
const settingsInstances: BlockSettings[] = [];

const buildSettings = () => {
  const i18n = {
    t: (key: string) => messages[key] ?? key,
    has: (key: string) => key in messages,
    getLocale: () => 'en',
    getEnglishTranslation: (key: string) => messages[key] ?? key,
  };
  const notifier = vi.fn();
  const api = {
    styles: { block: 'blok-block' },
    i18n,
    notifier: { show: notifier },
    events: { on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn() },
    blocks: { getChildren: () => [] },
  } as unknown as API;

  const holder = document.createElement('div');
  const paragraph = new Paragraph({
    api,
    block: { id: 'p', dispatchChange: vi.fn() } as never,
    config: {},
    readOnly: false,
    data: { text: 'alpha' },
  });

  holder.append(paragraph.render());
  document.body.append(holder);

  const block = {
    id: 'p',
    name: 'paragraph',
    holder,
    parentId: null,
    get pluginsContent() {
      return holder.firstElementChild;
    },
    createdAt: 0,
    lastEditedAt: 0,
    getTunes: () => ({ commonTunes: [],
      toolTunes: [] }),
    getActiveToolboxEntry: async () => ({ title: 'Text' }),
    save: async () => ({ data: { text: 'alpha' } }),
    exportDataAsString: async () => 'alpha',
  } as unknown as Block;

  const tools = new Map([
    ['paragraph', new BlockToolAdapter({ name: 'paragraph',
      // Paragraph's own sanitize type is wider than the published
      // BlockToolConstructable; the adapter only reads it.
      constructable: Paragraph as unknown as BlockToolConstructable,
      config: {},
      api,
      isDefault: true,
      isInternal: true })],
    ['header', new BlockToolAdapter({ name: 'header',
      constructable: Header,
      config: {},
      api,
      isDefault: false,
      isInternal: true })],
  ]);

  const convert = vi.fn(async () => {
    throw new Error('Could not convert Block «p»: it is being edited by someone else. Nothing was changed.');
  });
  const closeToolbar = vi.fn();
  const settings = new BlockSettings({ config: {},
    eventsDispatcher: new EventsDispatcher<BlokEventMap>() });

  settings.state = {
    ReadOnly: { isEnabled: false,
      isControlsHidden: false },
    BlockSelection: { selectedBlocks: [],
      selectBlock: vi.fn(),
      clearCache: vi.fn(),
      unselectBlock: vi.fn() },
    BlockManager: { currentBlock: block,
      convert },
    CrossBlockSelection: { isCrossBlockSelectionStarted: false },
    Tools: { blockTools: tools },
    API: { methods: api },
    Toolbar: { close: closeToolbar,
      isPositionedRight: false },
    Caret: { setToBlock: vi.fn(),
      positions: { DEFAULT: 'default',
        END: 'end' } },
    I18n: i18n,
  } as unknown as BlokModules;
  settings.make();
  settingsInstances.push(settings);

  return { settings,
    block,
    convert,
    closeToolbar,
    notifier };
};

/** Open block settings, walk into "Turn into" and click the Heading entry. */
const clickHeadingConversion = async (settings: BlockSettings, block: Block): Promise<void> => {
  await settings.open(block);

  const convertTo = document.querySelector<HTMLElement>('[data-blok-item-name="convert-to"]');

  if (convertTo === null) {
    throw new Error('Missing the "Turn into" item');
  }

  convertTo.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const items = Array.from(document.querySelectorAll<HTMLElement>('[data-blok-convert-item="true"]'));
  const heading = items.find((item) => item.getAttribute('data-blok-item-name')?.startsWith('header'));

  if (heading === undefined) {
    throw new Error(`Missing the Heading conversion entry (saw ${items.length} convert items)`);
  }

  heading.click();
};

describe('block settings "Turn into" when the conversion is refused', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    settingsInstances.splice(0).forEach((settings) => {
      settings.close();
      settings.destroy();
    });
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('raises no unhandled rejection', async () => {
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      seen.push(reason);
    };

    process.on('unhandledRejection', onUnhandled);

    try {
      const { settings, block, convert } = buildSettings();

      await clickHeadingConversion(settings, block);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(seen).toEqual([]);
      expect(convert).toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('closes the toolbar instead of leaving the menu open', async () => {
    const { settings, block, closeToolbar, convert } = buildSettings();

    await clickHeadingConversion(settings, block);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(closeToolbar).toHaveBeenCalled();
    // The "already this type" branch also closes the toolbar, so without this
    // the assertion above would hold for a click that converted nothing.
    expect(convert).toHaveBeenCalled();
  });

  it('tells the user the block was not changed', async () => {
    const { settings, block, notifier } = buildSettings();


    await clickHeadingConversion(settings, block);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(notifier).toHaveBeenCalledWith(
      expect.objectContaining({ message: messages['blockSettings.convertFailed'] })
    );
  });
});
