import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConvertInlineTool } from '../../../../src/components/inline-tools/inline-tool-convert';
import { BlockToolAdapter } from '../../../../src/components/tools/block';
import { PopoverDesktop, PopoverItemType } from '../../../../src/components/utils/popover';
import { Header } from '../../../../src/tools/header';
import { IconH2, IconToggleH2 } from '../../../../src/components/icons';
import type { API, BlockAPI, ToolboxConfigEntry } from '../../../../types';
import type { MenuConfigItem } from '../../../../types/tools';
import en from '../../../../src/components/i18n/locales/en.json';

const translations: Record<string, string> = en;
const t = (key: string): string => translations[key] ?? key;
const popovers: PopoverDesktop[] = [];

const createPicker = (data: Record<string, unknown> = { text: 'Section' }, name = 'paragraph') => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-element-content', '');
  holder.textContent = 'Section';
  document.body.append(holder);
  const range = document.createRange();

  range.selectNodeContents(holder);
  range.collapse(true);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);

  const currentBlock = {
    id: 'current', name, save: async () => ({ data }),
    getActiveToolboxEntry: async () => ({ title: 'Text' }),
  } as unknown as BlockAPI;
  const convert = vi.fn(async () => currentBlock);
  const caret = vi.fn();
  const selection = { save: vi.fn(), restore: vi.fn(), setFakeBackground: vi.fn(), removeFakeBackground: vi.fn() };
  const api = {
    blocks: { getBlockByElement: () => currentBlock, convert },
    caret: { setToBlock: caret },
    selection,
    i18n: { t, getEnglishTranslation: t },
    tools: { getBlockTools: () => tools },
  } as unknown as API;
  const heading = new BlockToolAdapter({
    name: 'section', constructable: Header, config: { config: { levels: [1, 2, 4] } },
    api, isDefault: false, isInternal: false,
  });
  const custom = (toolName: string, toolbox: ToolboxConfigEntry[]): BlockToolAdapter => ({
    name: toolName, toolbox, conversionConfig: { import: 'text', export: 'text' },
  } as unknown as BlockToolAdapter);
  const tools = [
    custom('callout-custom', [{ title: 'Aside', icon: '<svg></svg>', data: { tone: 'quiet' }, searchTerms: ['notice'] }]),
    heading,
    custom('quote-custom', [{ title: 'Citation', icon: '<svg></svg>', data: { style: 'quote' } }]),
  ];

  return { tool: new ConvertInlineTool({ api }), api, currentBlock, holder, convert, caret, selection };
};

const childrenOf = async (tool: ConvertInlineTool) => {
  const config = await tool.render();

  if (Array.isArray(config) || !('children' in config)) {
    throw new Error('Expected conversion submenu');
  }

  return config.children;
};

const names = (items: MenuConfigItem[]): string[] => items
  .filter(item => 'onActivate' in item)
  .map(item => 'name' in item ? item.name ?? '' : '');

describe('Inline conversion picker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    popovers.splice(0).forEach(popover => popover.destroy());
    window.getSelection()?.removeAllRanges();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('leads with heading variants and keeps custom registration order below them', async () => {
    const { tool, convert } = createPicker();
    const children = await childrenOf(tool);
    const items = children.items ?? [];

    expect(children.searchable).toBe(true);
    const tablists = items.filter(item => item.type === PopoverItemType.Html).map(item => item.element);

    expect(tablists).toHaveLength(1);
    expect(tablists[0].getAttribute('role')).toBe('tablist');
    expect(Array.from(tablists[0].querySelectorAll('[role="tab"]'), tab => tab.textContent)).toEqual(['Heading', 'Toggle heading']);
    expect(names(items)).toEqual(['header-1', 'header-2', 'header-4', 'toggle-header-1', 'toggle-header-2', 'toggle-header-4', 'callout-custom', 'quote-custom']);
    const quote = items.find(item => 'name' in item && item.name === 'quote-custom');

    if (!quote || !('onActivate' in quote) || !quote.onActivate) {
      throw new Error('Missing custom conversion');
    }
    await quote.onActivate(quote);
    expect(convert).toHaveBeenCalledWith('current', 'quote-custom', { style: 'quote' });
  });

  it('searches aliases and activates the real filtered item with its original conversion payload', async () => {
    const { tool, convert, caret } = createPicker();
    const children = await childrenOf(tool);
    const popover = new PopoverDesktop({ items: children.items ?? [], searchable: children.searchable });

    popovers.push(popover);
    popover.show();
    const input = popover.getElement().querySelector('input');

    expect(input).not.toBeNull();
    if (!input) {
      throw new Error('Missing picker search');
    }
    input.value = 'notice';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const result = popover.getElement().querySelector<HTMLElement>('[data-blok-item-name="callout-custom"]');

    expect(result?.getAttribute('data-blok-hidden')).not.toBe('true');
    result?.click();
    await Promise.resolve();
    expect(convert).toHaveBeenCalledWith('current', 'callout-custom', { tone: 'quiet' });
    expect(caret).toHaveBeenCalledWith(expect.objectContaining({ id: 'current' }), 'default', 0);
  });

  it.each([
    { isToggleable: false, title: 'Heading 2', icon: IconH2 },
    { isToggleable: true, title: 'Toggle heading 2', icon: IconToggleH2 },
  ])('uses the exact current heading for the trigger with toggle state $isToggleable', async ({ isToggleable, title, icon }) => {
    const { tool, api, currentBlock } = createPicker({
      text: 'Section', level: 2,
      ...(isToggleable ? { isToggleable: true } : {}),
    }, 'section');

    vi.spyOn(currentBlock, 'getActiveToolboxEntry').mockResolvedValue({
      title: 'Heading 2', icon: IconH2,
    });
    vi.spyOn(api.i18n, 't').mockImplementation(key => key === 'toolNames.section' ? 'Section' : t(key));

    expect(await tool.render()).toMatchObject({ title, icon });
  });

  it.each([false, true])('retains the current heading as a no-op with toggle state %s', async (isToggleable) => {
    const { tool, currentBlock, holder, convert, caret } = createPicker({
      text: 'Section', level: 2, anchor: 'section', textColor: 'red',
      ...(isToggleable ? { isToggleable: true, isOpen: false } : {}),
    }, 'section');
    const saved = await currentBlock.save();
    const originalContent = holder.firstChild;
    const children = await childrenOf(tool);
    const items = children.items ?? [];
    const currentName = isToggleable ? 'toggle-header-2' : 'header-2';
    const current = items.find(item => 'name' in item && item.name === currentName);

    expect(names(items)).toContain('header-2');
    expect(names(items)).toContain('toggle-header-2');
    expect(current).toMatchObject({ isActive: true });
    if (!current || !('onActivate' in current) || !current.onActivate) {
      throw new Error('Missing current heading');
    }
    await current.onActivate(current);

    expect(convert).not.toHaveBeenCalled();
    expect(caret).not.toHaveBeenCalled();
    expect(await currentBlock.save()).toEqual(saved);
    expect(holder.firstChild).toBe(originalContent);
    expect(holder.isConnected).toBe(true);
  });
});
