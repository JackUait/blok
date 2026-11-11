/**
 * The block menu's "Turn into" says what the block became, like Notion.
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
import { announce } from '../../../../../src/components/utils/announcer';

vi.mock('../../../../../src/components/utils/announcer', () => ({ announce: vi.fn() }));

const messages: Record<string, string> = en;
const settingsInstances: BlockSettings[] = [];

const buildSettings = (options: { refuse?: boolean; selectTwo?: boolean; refuseSecond?: boolean } = {}) => {
  const i18n = {
    t: (key: string, vars?: Record<string, string | number>) => {
      const count = vars?.count;
      const form = typeof count === 'number' && `${key}_other` in messages ? `${key}_${count === 1 ? 'one' : 'other'}` : key;

      return (messages[form] ?? form).replace(/\{(\w+)\}/g, (_m, name: string) => String(vars?.[name] ?? ''));
    },
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
    blocks: { getChildren: () => [], getBlockIndex: () => undefined, getById: () => null },
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

  const second = { ...block, id: 'q' } as unknown as Block;
  const selectedBlocks = options.selectTwo === true ? [block, second] : [];
  const convert = vi.fn(async (target: Block) => {
    if (options.refuse === true || (options.refuseSecond === true && target.id === 'q')) {
      throw new Error('Could not convert Block «p»: it is being edited by someone else. Nothing was changed.');
    }

    return target;
  });
  const closeToolbar = vi.fn();
  const settings = new BlockSettings({ config: {},
    eventsDispatcher: new EventsDispatcher<BlokEventMap>() });

  settings.state = {
    ReadOnly: { isEnabled: false,
      isControlsHidden: false },
    BlockSelection: { selectedBlocks,
      selectBlock: vi.fn(),
      clearSelection: vi.fn(),
      clearCache: vi.fn(),
      unselectBlock: vi.fn() },
    BlockManager: { currentBlock: block,
      convert },
    CrossBlockSelection: { isCrossBlockSelectionStarted: false },
    Tools: { blockTools: tools },
    // BlockAPI.save() hands its data to the API module for host output.
    API: { methods: api, blockDataForHost: (_tool: unknown, data: unknown) => data },
    Toolbar: { close: closeToolbar,
      isDockedPhysicallyRight: false },
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

/** Open block settings, walk into "Turn into" and click the entry whose name starts with `prefix`. */
const clickConversion = async (settings: BlockSettings, block: Block, prefix = 'header'): Promise<void> => {
  await settings.open(block);

  const convertTo = document.querySelector<HTMLElement>('[data-blok-item-name="convert-to"]');

  if (convertTo === null) {
    throw new Error(`Missing the "Turn into" item: ${Array.from(document.querySelectorAll('[data-blok-item-name]')).map((el) => el.getAttribute('data-blok-item-name')).join(',')}`);
  }

  convertTo.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const items = Array.from(document.querySelectorAll<HTMLElement>('[data-blok-convert-item="true"]'));
  const heading = items.find((item) => item.getAttribute('data-blok-item-name')?.startsWith(prefix));

  if (heading === undefined) {
    throw new Error(`Missing the Heading conversion entry (saw ${items.length} convert items)`);
  }

  heading.click();
};

// Notion U084 / U123: Turn into from the block menu says what the blocks became.
describe('block settings "Turn into" announces the conversion', () => {
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

  it('names the conversion item "Turn into", like Notion', async () => {
    const { settings, block } = buildSettings();

    await settings.open(block);

    const item = document.querySelector<HTMLElement>('[data-blok-item-name="convert-to"]');

    expect(item?.textContent?.trim()).toBe('Turn into');
  });

  it('says Converted to Heading for one block', async () => {
    const { settings, block, convert } = buildSettings();

    await clickConversion(settings, block);
    await vi.waitFor(() => expect(vi.mocked(announce)).toHaveBeenCalledWith('Converted to Heading 1'));
    expect(convert).toHaveBeenCalledTimes(1);
  });

  it('counts the blocks for a multi-block Turn into', async () => {
    const { settings, block, convert } = buildSettings({ selectTwo: true });

    await clickConversion(settings, block);
    await vi.waitFor(() => expect(vi.mocked(announce)).toHaveBeenCalledWith('2 blocks converted to Heading 1'));
    expect(convert).toHaveBeenCalledTimes(2);
  });

  it('counts only the blocks that converted', async () => {
    const { settings, block, convert } = buildSettings({ selectTwo: true, refuseSecond: true });

    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await clickConversion(settings, block);
    await vi.waitFor(() => expect(convert).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(vi.mocked(announce)).toHaveBeenCalled());

    expect(vi.mocked(announce)).toHaveBeenCalledWith('Converted to Heading 1');
  });

  it('says nothing when the conversion is refused', async () => {
    const { settings, block, convert } = buildSettings({ refuse: true });

    await clickConversion(settings, block);
    await vi.waitFor(() => expect(convert).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(vi.mocked(announce)).not.toHaveBeenCalled();
  });

  it('says nothing for the entry the block already is', async () => {
    const { settings, block, convert } = buildSettings();

    await clickConversion(settings, block, 'paragraph');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(convert).not.toHaveBeenCalled();
    expect(vi.mocked(announce)).not.toHaveBeenCalled();
  });
});
