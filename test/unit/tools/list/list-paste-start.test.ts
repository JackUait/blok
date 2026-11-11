import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ListItem } from '../../../../src/tools/list';
import { SanitizerConfigBuilder } from '../../../../src/components/modules/paste/sanitizer-config';
import { clean } from '../../../../src/components/utils/sanitizer';
import type { BlockToolAdapter } from '../../../../src/components/tools/block';
import type { ToolsCollection } from '../../../../src/components/tools/collection';
import type { ListItemData } from '../../../../src/tools/list/types';

const buildListTool = (): ListItem => {
  const api = {
    blocks: {
      getById: (): null => null,
      getBlockIndex: (): number | undefined => 0,
      getCurrentBlockIndex: (): number => 0,
      getBlockByIndex: (): undefined => undefined,
      getBlocksCount: (): number => 1,
      update: vi.fn().mockResolvedValue(undefined),
    },
    i18n: { t: (key: string): string => key },
    events: { on: vi.fn(), off: vi.fn() },
  } as never;

  const data: ListItemData = { text: '', style: 'unordered', checked: false };

  return new ListItem({ data, config: {}, api, readOnly: false, block: { id: 'pasted-list' } as never });
};

const pasteLi = (tool: ListItem, html: string): void => {
  const holder = document.createElement('div');

  holder.innerHTML = html;

  const li = holder.firstElementChild;

  if (!(li instanceof HTMLElement)) {
    throw new Error('no pasted element');
  }

  tool.onPaste(new CustomEvent('tag', { detail: { data: li } }));
};

const builder = (): SanitizerConfigBuilder => new SanitizerConfigBuilder({} as unknown as ToolsCollection<BlockToolAdapter>, {});

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('pasting an ordered list that does not start at 1', () => {
  it('keeps the start stamp through the list tool sanitizer', () => {
    const config = builder().buildToolConfig({ pasteConfig: ListItem.pasteConfig } as unknown as BlockToolAdapter);

    expect(clean('<li data-list-style="ordered" data-list-start="5">Five</li>', config)).toBe('<li data-list-style="ordered" data-list-start="5">Five</li>');
  });

  it('keeps the start stamp through the structural sanitizer', () => {
    const holder = document.createElement('div');

    holder.innerHTML = '<ul><li data-list-start="5">Five</li></ul>';

    const config = builder().getStructuralTagsConfig(holder);

    expect(clean(holder.innerHTML, config)).toBe('<ul><li data-list-start="5">Five</li></ul>');
  });

  it('reads the start stamp into the saved data', () => {
    const tool = buildListTool();

    document.body.appendChild(tool.render());
    pasteLi(tool, '<li data-list-style="ordered" data-list-start="5">Five</li>');

    expect(tool.save()).toMatchObject({ text: 'Five', style: 'ordered', start: 5 });
  });

  it('saves no start for an item without a stamp', () => {
    const tool = buildListTool();

    document.body.appendChild(tool.render());
    pasteLi(tool, '<li data-list-style="ordered">Six</li>');

    expect(tool.save()).not.toHaveProperty('start');
  });
});
