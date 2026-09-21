/**
 * The inline toolbar's conversion picker when the conversion is REFUSED
 * (a peer is editing the block, so `blocks.convert()` rejects).
 *
 * The popover invokes `onActivate` inside a synchronous try/catch, so an async
 * rejection escaped as an unhandled rejection and the caret was never restored.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConvertInlineTool } from '../../../../src/components/inline-tools/inline-tool-convert';
import { BlockToolAdapter } from '../../../../src/components/tools/block';
import { Header } from '../../../../src/tools/header';
import type { API, BlockAPI } from '../../../../types';
import type { MenuConfigItem } from '../../../../types/tools';
import en from '../../../../src/components/i18n/locales/en.json';

const messages: Record<string, string> = en;
const t = (key: string): string => messages[key] ?? key;

const createPicker = () => {
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
    id: 'current',
    name: 'paragraph',
    save: async () => ({ data: { text: 'Section' } }),
    getActiveToolboxEntry: async () => ({ title: 'Text' }),
  } as unknown as BlockAPI;

  const convert = vi.fn(async () => {
    throw new Error('Could not convert Block «current»: it is being edited by someone else. Nothing was changed.');
  });
  const caret = vi.fn();
  const notifier = vi.fn();
  const api = {
    blocks: { getBlockByElement: () => currentBlock,
      convert },
    caret: { setToBlock: caret },
    notifier: { show: notifier },
    selection: { save: vi.fn(),
      restore: vi.fn(),
      setFakeBackground: vi.fn(),
      removeFakeBackground: vi.fn() },
    i18n: { t,
      getEnglishTranslation: t },
    tools: { getBlockTools: () => tools },
  } as unknown as API;

  const tools = [
    new BlockToolAdapter({
      name: 'header',
      constructable: Header,
      config: {},
      api,
      isDefault: false,
      isInternal: false,
    }),
  ];

  return { tool: new ConvertInlineTool({ api }),
    convert,
    caret,
    notifier };
};

const firstConversionItem = async (tool: ConvertInlineTool): Promise<MenuConfigItem> => {
  const config = await tool.render();

  if (Array.isArray(config) || !('children' in config)) {
    throw new Error('Expected a conversion submenu');
  }

  const items = (config.children?.items ?? []) as MenuConfigItem[];
  const item = items.find(
    (candidate) => 'onActivate' in candidate && !('isActive' in candidate && candidate.isActive === true)
  );

  if (item === undefined) {
    throw new Error('Expected a conversion entry');
  }

  return item;
};

describe('the inline conversion picker when the conversion is refused', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('raises no unhandled rejection and tells the user', async () => {
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      seen.push(reason);
    };

    process.on('unhandledRejection', onUnhandled);

    try {
      const { tool, convert, notifier } = createPicker();
      const item = await firstConversionItem(tool);

      // The popover calls onActivate synchronously and drops the promise.
      (item as { onActivate: (item: MenuConfigItem) => void }).onActivate(item);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(seen).toEqual([]);
      expect(convert).toHaveBeenCalled();
      expect(notifier).toHaveBeenCalledWith(
        expect.objectContaining({ message: messages['blockSettings.convertFailed'] })
      );
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('leaves the caret alone rather than moving it into a block that was not converted', async () => {
    const { tool, caret, convert } = createPicker();
    const item = await firstConversionItem(tool);

    (item as { onActivate: (item: MenuConfigItem) => void }).onActivate(item);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(caret).not.toHaveBeenCalled();
    // Otherwise a handler that never ran would satisfy the assertion above.
    expect(convert).toHaveBeenCalled();
  });
});
