/**
 * A real editor and its toolbox: a host whose backend issues page ids returns
 * one from `create`, and the block is inserted only once that answer is in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { PageTool } from '../../../../src/tools/page';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { PageConfig } from '../../../../src/tools/page/types';
import type { API, OutputData } from '../../../../types';

interface Runtime {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  blocks: API['blocks'];
  caret: API['caret'];
  module: {
    toolbar: {
      toolbox: { open: () => void; close: () => void; opened: boolean | undefined };
      moveAndOpen: (block?: unknown) => void;
    };
    blockManager: { getBlockByIndex: (index: number) => unknown };
  };
}

let editor: Runtime | undefined;
let holder: HTMLDivElement | undefined;

const settle = (ms = 0): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, ms);
});

const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } => {
  const handlers: { resolve: (value: T) => void; reject: (error: unknown) => void } = {
    resolve: () => undefined,
    reject: () => undefined,
  };
  const promise = new Promise<T>((resolve, reject) => {
    handlers.resolve = resolve;
    handlers.reject = reject;
  });

  return { promise, ...handlers };
};

const boot = async (config: PageConfig, text = ''): Promise<Runtime> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, page: { class: PageTool, config } },
    data: { blocks: [{ id: 'a', type: 'paragraph', data: { text } }] },
  }) as unknown as Runtime;

  editor = instance;
  await instance.isReady;
  await settle();

  return instance;
};

const pageItem = (): HTMLElement => {
  // A destroyed editor can leave its menu in the body, so take the newest.
  const item = [...document.querySelectorAll<HTMLElement>('[data-blok-item-name="page"]')].at(-1);

  if (item === undefined) {
    throw new Error('no Page item in the toolbox');
  }

  return item;
};

const pickPage = async (instance: Runtime): Promise<HTMLElement> => {
  instance.caret.setToBlock(0);
  instance.module.toolbar.toolbox.open();
  await settle();

  const item = pageItem();

  item.click();

  return item;
};

const types = async (instance: Runtime): Promise<Array<{ type: string; data: Record<string, unknown> }>> => {
  const output = await instance.save();

  return output.blocks.map(block => ({ type: block.type, data: block.data }));
};

describe('a page whose id comes from the host', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    editor?.destroy();
    await settle();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    vi.restoreAllMocks();
  });

  it('is inserted only after create answers, with the id create returned', async () => {
    const answer = deferred<{ pageId: string }>();
    const create = vi.fn(() => answer.promise);
    const open = vi.fn();
    const instance = await boot({ create, open });

    const item = await pickPage(instance);
    await settle();

    expect((await types(instance)).map(block => block.type)).not.toContain('page');
    expect(create).toHaveBeenCalledTimes(1);
    expect(item.getAttribute('aria-busy')).toBe('true');

    answer.resolve({ pageId: 'server-42' });
    await settle();
    await settle();

    expect(await types(instance)).toEqual([{ type: 'page', data: { pageId: 'server-42' } }]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('server-42', {});
  }, 30_000);

  it('keeps Blok\'s id when create returns nothing', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const instance = await boot({ create });

    await pickPage(instance);
    await settle();
    await settle();

    const [block] = await types(instance);

    expect(block?.type).toBe('page');
    expect(create).toHaveBeenCalledWith({ pageId: block?.data.pageId });
  }, 30_000);

  it('inserts nothing and leaves the paragraph when create fails', async () => {
    const answer = deferred<{ pageId: string }>();
    const instance = await boot({ create: () => answer.promise });

    const item = await pickPage(instance);

    answer.reject(new Error('backend down'));
    await settle();
    await settle();

    expect(instance.blocks.getBlocksCount()).toBe(1);
    expect(instance.blocks.getBlockByIndex(0)?.name).toBe('paragraph');
    expect(item.hasAttribute('aria-busy')).toBe(false);
  }, 30_000);

  it('calls create once when the item is picked again while waiting', async () => {
    const answer = deferred<{ pageId: string }>();
    const create = vi.fn(() => answer.promise);
    const instance = await boot({ create });

    const item = await pickPage(instance);

    item.click();
    await settle();
    answer.resolve({ pageId: 'server-1' });
    await settle();
    await settle();

    expect(create).toHaveBeenCalledTimes(1);
    expect((await types(instance)).filter(block => block.type === 'page')).toHaveLength(1);
  }, 30_000);

  it('still inserts the page when the menu was closed while waiting', async () => {
    const answer = deferred<{ pageId: string }>();
    const instance = await boot({ create: () => answer.promise });

    await pickPage(instance);
    instance.module.toolbar.toolbox.close();
    await settle();
    answer.resolve({ pageId: 'server-7' });
    await settle();
    await settle();

    expect(await types(instance)).toEqual([{ type: 'page', data: { pageId: 'server-7' } }]);
  }, 30_000);

  it('inserts nothing when the block it was picked on is gone', async () => {
    const answer = deferred<{ pageId: string }>();
    const instance = await boot({ create: () => answer.promise });

    await pickPage(instance);
    instance.blocks.insert('paragraph', { text: 'kept' }, {}, 1);
    await instance.blocks.delete(0);
    answer.resolve({ pageId: 'server-8' });
    await settle();
    await settle();

    expect(await types(instance)).toEqual([{ type: 'paragraph', data: { text: 'kept' } }]);
  }, 30_000);

  it('still inserts the page when the plus-button menu was closed while waiting', async () => {
    const answer = deferred<{ pageId: string }>();
    const instance = await boot({ create: () => answer.promise }, 'above');

    instance.caret.setToBlock(0, 'end');
    instance.module.toolbar.moveAndOpen(instance.module.blockManager.getBlockByIndex(0));
    const plus = [...document.querySelectorAll<HTMLElement>('[data-blok-testid="plus-button"]')].at(-1);

    // jsdom has no elementFromPoint; the rectangle selection reads it on mousedown.
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
    try {
      plus?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    } finally {
      Reflect.deleteProperty(document, 'elementFromPoint');
    }
    await settle();
    pageItem().click();
    instance.module.toolbar.toolbox.close();
    await settle();
    answer.resolve({ pageId: 'server-9' });
    await settle();
    await settle();

    expect(await types(instance)).toEqual([
      { type: 'paragraph', data: { text: 'above' } },
      { type: 'page', data: { pageId: 'server-9' } },
    ]);
  }, 30_000);
});
