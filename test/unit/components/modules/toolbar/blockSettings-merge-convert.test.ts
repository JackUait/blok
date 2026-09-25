/**
 * "Turn into" with several blocks selected, into a tool whose import makes
 * one item per line. Each block's text must go through the same translation
 * and sanitizer a single-block convert uses before the lines are joined.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BlockSettings } from '../../../../../src/components/modules/toolbar/blockSettings';
import { BlockToolAdapter } from '../../../../../src/components/tools/block';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import { CodeTool } from '../../../../../src/tools/code';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { Block } from '../../../../../src/components/block';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { API, BlockToolConstructable, BlockToolData } from '../../../../../types';
import en from '../../../../../src/components/i18n/locales/en.json';

const messages: Record<string, string> = en;
const settingsInstances: BlockSettings[] = [];

const SOURCE = 'if (a < b && c) {\n  x = "<b>";\n}';
const ESCAPED = 'if (a &lt; b &amp;&amp; c) {<br>  x = "&lt;b&gt;";<br>}';

/** A custom tool that holds one item per imported line. */
class ItemsTool {
  public static get toolbox(): { title: string; icon: string } {
    return { title: 'Items',
      icon: '<svg></svg>' };
  }

  public static get conversionConfig(): { export: (data: { items: string[] }) => string; import: (content: string) => { items: string[] } } {
    return {
      export: (data) => data.items.join('\n'),
      import: (content) => ({ items: content.split('\n') }),
    };
  }

  public static get sanitize(): Record<string, Record<string, boolean>> {
    return { items: { br: true,
      b: true } };
  }

  public render(): HTMLElement {
    return document.createElement('div');
  }

  public save(): Record<string, never> {
    return {};
  }
}

type Source = { name: string; exported: string };

const buildSettings = (sources: Source[]) => {
  const i18n = {
    t: (key: string) => messages[key] ?? key,
    has: (key: string) => key in messages,
    getLocale: () => 'en',
    getEnglishTranslation: (key: string) => messages[key] ?? key,
  };
  const api = {
    styles: { block: 'blok-block' },
    i18n,
    notifier: { show: vi.fn() },
    events: { on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn() },
    // No live index: keeps the "Turn into columns" entry out of the menu.
    blocks: { getChildren: () => [],
      getBlockIndex: () => undefined },
  } as unknown as API;

  const adapter = (name: string, constructable: unknown, isDefault = false): BlockToolAdapter =>
    new BlockToolAdapter({ name,
      constructable: constructable as BlockToolConstructable,
      config: {},
      api,
      isDefault,
      isInternal: true });

  const tools = new Map([
    ['paragraph', adapter('paragraph', Paragraph, true)],
    ['code', adapter('code', CodeTool)],
    ['items', adapter('items', ItemsTool)],
  ]);

  const blocks = sources.map((source, index) => {
    const holder = document.createElement('div');

    holder.append(document.createElement('div'));
    document.body.append(holder);

    return {
      id: `b${index}`,
      name: source.name,
      tool: tools.get(source.name),
      holder,
      parentId: null,
      get pluginsContent() {
        return holder.firstElementChild;
      },
      createdAt: 0,
      lastEditedAt: 0,
      getTunes: () => ({ commonTunes: [],
        toolTunes: [] }),
      getActiveToolboxEntry: async () => undefined,
      save: async () => ({ data: {} }),
      exportDataAsString: async () => source.exported,
    } as unknown as Block;
  });

  const replace = vi.fn((block: Block, _tool: string, _data: BlockToolData) => block);
  const settings = new BlockSettings({ config: {},
    eventsDispatcher: new EventsDispatcher<BlokEventMap>() });

  settings.state = {
    ReadOnly: { isEnabled: false,
      isControlsHidden: false },
    BlockSelection: { selectedBlocks: blocks,
      selectBlock: vi.fn(),
      clearCache: vi.fn(),
      clearSelection: vi.fn(),
      unselectBlock: vi.fn() },
    BlockManager: { currentBlock: blocks[0],
      replace,
      removeBlock: vi.fn(async () => undefined) },
    CrossBlockSelection: { isCrossBlockSelectionStarted: false },
    Tools: { blockTools: tools },
    API: { methods: api },
    Toolbar: { close: vi.fn(),
      isPositionedRight: false },
    Caret: { setToBlock: vi.fn(),
      positions: { DEFAULT: 'default',
        END: 'end' } },
    I18n: i18n,
  } as unknown as BlokModules;
  settings.make();
  settingsInstances.push(settings);

  return { settings,
    first: blocks[0],
    replace };
};

/** Open block settings, walk into "Turn into" and click the Items entry. */
const turnIntoItems = async (settings: BlockSettings, block: Block): Promise<void> => {
  await settings.open(block);

  const convertTo = document.querySelector<HTMLElement>('[data-blok-item-name="convert-to"]');

  if (convertTo === null) {
    throw new Error('Missing the "Turn into" item');
  }

  convertTo.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const items = Array.from(document.querySelectorAll<HTMLElement>('[data-blok-convert-item="true"]'));
  const target = items.find((item) => item.getAttribute('data-blok-item-name')?.startsWith('items'));

  if (target === undefined) {
    throw new Error(`Missing the Items conversion entry (saw ${items.length} convert items)`);
  }

  target.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
};

const importedItems = (replace: ReturnType<typeof buildSettings>['replace']): unknown => {
  expect(replace).toHaveBeenCalledTimes(1);

  return replace.mock.calls[0][2].items;
};

describe('block settings "Turn into" a multi-item tool with several blocks selected', () => {
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

  it('keeps each code block as one escaped item', async () => {
    const { settings, first, replace } = buildSettings([
      { name: 'code', exported: SOURCE },
      { name: 'code', exported: 'a < b' },
    ]);

    await turnIntoItems(settings, first);

    expect(importedItems(replace)).toEqual([ESCAPED, 'a &lt; b']);
  });

  it('sanitizes rich text and keeps its <br> inside one item', async () => {
    const { settings, first, replace } = buildSettings([
      { name: 'paragraph', exported: 'One<br><b>two</b><img src=x onerror="alert(1)">' },
      { name: 'paragraph', exported: 'Three' },
    ]);

    await turnIntoItems(settings, first);

    expect(importedItems(replace)).toEqual(['One<br><b>two</b>', 'Three']);
  });
});
