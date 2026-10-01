/**
 * A real editor: undo and redo must bring the block back with the SAME minted
 * id. A new id would point at no page; an empty one is dropped on save.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { PageTool } from '../../../../src/tools/page';
import { Bold, Link } from '../../../../src/tools';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { API, OutputData } from '../../../../types';

interface Runtime {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  history: { undo: () => void; redo: () => void; canUndo: () => boolean };
  blocks: API['blocks'];
  module: { yjsManager: { stopCapturing: () => void } };
}

let editor: Runtime | undefined;
let holder: HTMLDivElement | undefined;

const settle = (ms = 0): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, ms);
});

const settleFrame = async (): Promise<void> => {
  await settle();
  await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
  await settle();
};

const pageIds = async (instance: Runtime): Promise<string[]> => {
  const output = await instance.save();

  return output.blocks.filter(block => block.type === 'page').map(block => String(block.data.pageId));
};

describe('a page inserted by the user', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    editor?.destroy();
    await settle();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // No data is the toolbox's path. An explicit empty id is a host's: core's
  // post-insert normalise skips a key the record already has, so only the
  // tool's own write saves the minted id there.
  it.each([
    ['no data', undefined],
    ['an empty pageId', { pageId: '' }],
  ])('inserted with %s keeps its minted pageId through undo and redo', async (_name, data) => {
    const create = vi.fn().mockResolvedValue(undefined);
    const open = vi.fn();
    const instance = new Blok({
      holder,
      tools: { paragraph: Paragraph, page: { class: PageTool, config: { create, open } } },
      data: { blocks: [{ id: 'a', type: 'paragraph', data: { text: 'parent' } }] },
    }) as unknown as Runtime;

    editor = instance;
    await instance.isReady;
    await settleFrame();
    instance.module.yjsManager.stopCapturing();

    instance.blocks.insert('page', data, {}, 1, false, false, undefined, undefined, 'user');
    await settleFrame();
    instance.module.yjsManager.stopCapturing();

    const [minted] = await pageIds(instance);

    expect(minted).toMatch(/^[A-Za-z0-9_-]{10}$/);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ pageId: minted });
    expect(open).toHaveBeenCalledTimes(1);

    instance.history.undo();
    await settleFrame();

    expect(await pageIds(instance)).toEqual([]);

    instance.history.redo();
    await settleFrame();

    expect(await pageIds(instance)).toEqual([minted]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
  }, 30_000);
});

describe('a saved page block', () => {
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

  it('keeps its cached text byte-identical through load and save with inline tools on', async () => {
    const text = 'if (a<b) { } 5 < 6 && x </div> y <b>bold</b>';
    const data = { pageId: 'p1', cache: { title: text, icon: { type: 'image', url: 'https://ex.com/a.png?b=1&c=2' } } };
    const instance = new Blok({
      holder,
      tools: { bold: Bold, link: Link, paragraph: Paragraph, page: PageTool },
      data: { blocks: [{ id: 'x', type: 'page', data }] },
    }) as unknown as Runtime;

    editor = instance;
    await instance.isReady;
    await settleFrame();

    const output = await instance.save();

    expect(output.blocks.find(block => block.id === 'x')?.data).toEqual(data);
  }, 30_000);
});

describe('a page block in a real editor', () => {
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

  it('booted read-only shows a fresh title from resolve and never saves it, even after editing turns on', async () => {
    const resolve = vi.fn().mockResolvedValue({ title: 'New' });
    const data = { pageId: 'p1', cache: { title: 'Old' } };
    const instance = new Blok({
      holder,
      readOnly: true,
      tools: { paragraph: Paragraph, page: { class: PageTool, config: { resolve } } },
      data: { blocks: [{ id: 'x', type: 'page', data }] },
    }) as unknown as Runtime & { readOnly: { toggle: (state?: boolean) => Promise<boolean> } };

    editor = instance;
    await instance.isReady;
    await settleFrame();

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(holder?.querySelector('[data-blok-testid="page-title"]')?.textContent).toBe('New');

    await instance.readOnly.toggle(false);
    await settleFrame();

    expect((await instance.save()).blocks.find(block => block.id === 'x')?.data).toEqual(data);
    expect(resolve).toHaveBeenCalledTimes(1);
  }, 30_000);

  it('turns into a paragraph that shows the title as literal text', async () => {
    const title = '<i>x</i> & y';
    const instance = new Blok({
      holder,
      tools: { paragraph: Paragraph, page: PageTool },
      data: { blocks: [{ id: 'x', type: 'page', data: { pageId: 'p1', cache: { title } } }] },
    }) as unknown as Runtime;

    editor = instance;
    await instance.isReady;
    await settleFrame();

    const converted = await instance.blocks.convert('x', 'paragraph');

    await settleFrame();

    expect(converted.holder.textContent).toBe(title);
    expect(converted.holder.querySelector('i')).toBeNull();
    expect((await instance.save()).blocks).toMatchObject([{ type: 'paragraph', data: { text: '&lt;i&gt;x&lt;/i&gt; &amp; y' } }]);
  }, 30_000);
});
