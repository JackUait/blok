import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockSettings } from '../../../../../src/components/modules/toolbar/blockSettings';
import type { Block } from '../../../../../src/components/block';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { MenuConfigItem } from '../../../../../types/tools';
import en from '../../../../../src/components/i18n/locales/en.json';

const translations: Record<string, string> = en;
const settingsInstances: BlockSettings[] = [];

const createSettings = (commonTunes: MenuConfigItem[], toolTunes: MenuConfigItem[] = []) => {
  const holder = document.createElement('div');
  const content = document.createElement('p');

  holder.append(content);
  document.body.append(holder);
  const block = {
    id: 'section', name: 'custom-heading', holder, pluginsContent: content,
    createdAt: 0, lastEditedAt: 0,
    getTunes: () => ({ commonTunes, toolTunes }),
    getActiveToolboxEntry: async () => ({ title: 'Custom title', icon: '<svg></svg>' }),
    save: async () => ({ data: { text: 'Section' } }),
  } as unknown as Block;
  const settings = new BlockSettings({ config: {}, eventsDispatcher: new EventsDispatcher<BlokEventMap>() });
  const duplicate = vi.fn();
  const modules = {
    ReadOnly: { isEnabled: false, isControlsHidden: false },
    BlockSelection: { selectedBlocks: [], selectBlock: vi.fn(), clearCache: vi.fn(), unselectBlock: vi.fn() },
    BlockManager: { currentBlock: block },
    CrossBlockSelection: { isCrossBlockSelectionStarted: false },
    Tools: { blockTools: new Map() },
    API: { methods: {} },
    Toolbar: { close: vi.fn(), isPositionedRight: false },
    DragManager: { duplicateBlocksInPlace: duplicate },
    I18n: { t: (key: string) => translations[key] ?? key, has: (key: string) => key in translations, getLocale: () => 'en' },
  } as unknown as BlokModules;

  settings.state = modules;
  settings.make();
  settingsInstances.push(settings);

  return { settings, block, duplicate };
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

  it('identifies the target block with its registered title and icon', async () => {
    const { settings, block } = createSettings([]);

    await settings.open(block);
    const identity = document.querySelector('[data-blok-item-name="block-identity"]');

    expect(identity?.textContent).toBe('Custom title');
    expect(identity?.querySelector('svg')).not.toBeNull();
    expect(identity?.querySelector('button')).toBeNull();
  });

  it('shows the identity icon as a bare glyph, with no chip behind it', async () => {
    const { settings, block } = createSettings([]);

    await settings.open(block);
    const svg = document.querySelector('[data-blok-item-name="block-identity"] svg');
    const icon = svg?.parentElement;

    expect(icon?.className).toContain('size-7');
    expect(icon?.className).not.toContain('bg-popover-icon-bg');
    expect(icon?.className).not.toContain('rounded-md');
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
