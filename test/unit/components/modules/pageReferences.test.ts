import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import type { Block } from '../../../../src/components/block';
import { DocumentStore } from '../../../../src/components/modules/yjs/document-store';
import { LinkInlineTool } from '../../../../src/components/inline-tools/inline-tool-link';
import { YBlockSerializer } from '../../../../src/components/modules/yjs/serializer';
import { PageTool, type PageConfig } from '../../../../src/tools/page';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Table } from '../../../../src/tools/table';
import { ToggleItem } from '../../../../src/tools/toggle';
import type { OutputBlockData, OutputData } from '../../../../types';

const PAGE_ID_ATTR = 'data-blok-page-id';
const neutralText = '<a data-blok-page-id="p1">Page</a> + <a data-blok-page-id="p1">Page</a>';

interface YjsSide {
  getStateVector: () => Uint8Array;
  encodeStateAsUpdate: (stateVector?: Uint8Array) => Uint8Array;
  onDocUpdate: (callback: (update: Uint8Array, origin: unknown) => void) => () => void;
  toJSON: () => OutputBlockData[];
}

interface Runtime {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  blocks: { delete: (index: number, setCaret?: boolean) => Promise<void> };
  history: { clear: () => void; canUndo: () => boolean };
  module: {
    blockManager: { getBlockById: (id: string) => Block | undefined };
    blockSelection: { enableNavigationMode: () => void; navigationModeEnabled: boolean };
    dragManager: { duplicateBlocksInPlace: (block: Block) => Promise<Block[]> };
    yjsManager: YjsSide;
  };
}

let editor: Runtime | undefined;
let nestedEditor: Runtime | undefined;
let holder: HTMLDivElement | undefined;
let peer: DocumentStore | undefined;

const settle = (ms = 0): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, ms);
});

const settleFrame = async (): Promise<void> => {
  await settle();
  await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
  await settle();
};

const anchors = (): HTMLAnchorElement[] =>
  Array.from(holder?.querySelectorAll<HTMLAnchorElement>(`a[${PAGE_ID_ATTR}="p1"]`) ?? []);

const createEditor = (page: PageConfig & Record<string, unknown>, text = neutralText): Runtime => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, page: { class: PageTool, config: page } },
    data: { blocks: [{ id: 'paragraph-1', type: 'paragraph', data: { text } }] },
  }) as unknown as Runtime;

  editor = instance;

  return instance;
};

describe('live inline page references', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    nestedEditor?.destroy();
    editor?.destroy();
    peer?.destroy();
    await settle();
    holder?.remove();
    window.getSelection()?.removeAllRanges();
    editor = undefined;
    nestedEditor = undefined;
    peer = undefined;
    holder = undefined;
    vi.restoreAllMocks();
  });

  it('uses the editor locale while an inline page is unresolved', async () => {
    const instance = new Blok({
      holder,
      i18n: { locale: 'ru' },
      tools: { paragraph: Paragraph, page: { class: PageTool, config: { resolve: () => undefined } } },
      data: { blocks: [{ id: 'paragraph-1', type: 'paragraph', data: { text: neutralText } }] },
    }) as unknown as Runtime;

    editor = instance;
    await instance.isReady;
    await settleFrame();

    expect(anchors().map(anchor => anchor.textContent)).toEqual(['Страница', 'Страница']);
  });

  it('calls a host resolve method with its receiver', async () => {
    const page = {
      title: 'Bound page',
      resolve(pageId: string) {
        return pageId === 'p1' ? { title: this.title } : null;
      },
    };
    const instance = createEditor(page);

    await instance.isReady;
    await settleFrame();

    expect(anchors().map(anchor => anchor.textContent)).toEqual(['Bound page', 'Bound page']);
  });

  it('repaints two references on same-tab notify without an undo step or Yjs update', async () => {
    let notify: (() => void) | undefined;
    const resolve = vi.fn(() => ({ title: 'Before' }));
    const instance = createEditor({
      resolve,
      subscribe: (_id, onChange) => { notify = onChange; },
    });

    await instance.isReady;
    await settleFrame();
    expect(anchors().map(anchor => anchor.textContent)).toEqual(['Before', 'Before']);

    const receiver = instance.module.yjsManager;
    const other = new DocumentStore(new YBlockSerializer());

    peer = other;
    other.applyRemoteUpdate(receiver.encodeStateAsUpdate(other.getStateVector()));
    const before = other.toJSON();
    const outbound = vi.fn();
    const unsubscribe = receiver.onDocUpdate(outbound);

    instance.history.clear();
    resolve.mockReturnValue({ title: 'After' });
    notify?.();
    await settleFrame();

    expect(anchors().map(anchor => anchor.textContent)).toEqual(['After', 'After']);
    expect(anchors().every(anchor =>
      anchor.getAttribute('data-blok-mutation-free') === 'true' &&
      anchor.getAttribute('contenteditable') === 'false'
    )).toBe(true);
    expect(instance.history.canUndo()).toBe(false);
    expect(outbound).not.toHaveBeenCalled();
    expect(receiver.toJSON()).toEqual(before);
    expect((await instance.save()).blocks[0]?.data).toEqual({ text: neutralText });
    unsubscribe();
  }, 30_000);

  it('keeps a painted page reference neutral in the shared document after duplication', async () => {
    const instance = createEditor({
      resolve: () => ({ title: 'Secret Roadmap' }),
      href: () => 'https://example.test/private-roadmap',
    }, '<a data-blok-page-id="p1">Page</a>');

    await instance.isReady;
    await settleFrame();
    const source = instance.module.blockManager.getBlockById('paragraph-1');

    if (source === undefined) {
      throw new Error('source paragraph is missing');
    }
    const [copy] = await instance.module.dragManager.duplicateBlocksInPlace(source);

    if (copy === undefined) {
      throw new Error('duplicate paragraph is missing');
    }
    await settleFrame();
    const copiedData = instance.module.yjsManager.toJSON().find(({ id }) => id === copy.id)?.data;

    expect(copiedData).toEqual({ text: '<a data-blok-page-id="p1">Page</a>' });
    expect(anchors()[0]?.textContent).toBe('Secret Roadmap');
    expect((await instance.save()).blocks.find(({ id }) => id === copy.id)?.data).toEqual(copiedData);
  }, 30_000);

  it('keeps page references neutral in shared cell data after duplicating a table', async () => {
    let notify: (() => void) | undefined;
    let access: 'allowed' | 'none' = 'allowed';
    const cellText = '<a data-blok-page-id="p1">Page</a> and <a href="https://example.test/ordinary">Ordinary</a>';
    const instance = new Blok({
      holder,
      tools: {
        paragraph: Paragraph,
        table: Table,
        page: {
          class: PageTool,
          config: {
            resolve: () => access === 'none' ? { access: 'none' as const } : { title: 'Secret Roadmap' },
            href: () => 'https://example.test/private-roadmap',
            subscribe: (_id: string, onChange: () => void) => { notify = onChange; },
          },
        },
      },
      data: {
        blocks: [
          {
            id: 'tbl',
            type: 'table',
            data: { withHeadings: false, content: [[{ blocks: ['c1'] }, { blocks: ['c2'] }], [{ blocks: ['c3'] }, { blocks: ['c4'] }]] },
            content: ['c1', 'c2', 'c3', 'c4'],
          },
          { id: 'c1', type: 'paragraph', data: { text: cellText }, parent: 'tbl' },
          { id: 'c2', type: 'paragraph', data: { text: 'c2' }, parent: 'tbl' },
          { id: 'c3', type: 'paragraph', data: { text: 'c3' }, parent: 'tbl' },
          { id: 'c4', type: 'paragraph', data: { text: 'c4' }, parent: 'tbl' },
          { id: 'after', type: 'paragraph', data: { text: 'after' } },
        ],
      },
    }) as unknown as Runtime;

    editor = instance;
    await instance.isReady;
    await settleFrame();
    const sourceAnchor = instance.module.blockManager.getBlockById('c1')?.holder.querySelector<HTMLAnchorElement>(`a[${PAGE_ID_ATTR}="p1"]`);
    const paintedTitle = sourceAnchor?.textContent;
    const paintedHref = sourceAnchor?.getAttribute('href');

    await instance.save();
    const sourceTable = instance.module.blockManager.getBlockById('tbl');

    if (sourceTable === undefined) {
      throw new Error('source table is missing');
    }
    const [copy] = await instance.module.dragManager.duplicateBlocksInPlace(sourceTable);

    if (copy === undefined) {
      throw new Error('duplicate table is missing');
    }
    const copiedCell = instance.module.yjsManager.toJSON()
      .find(({ parent, data }) => parent === copy.id && typeof data.text === 'string' && data.text.includes(PAGE_ID_ATTR));

    expect(copiedCell?.data).toEqual({ text: cellText });
    expect(paintedTitle).toBe('Secret Roadmap');
    expect(paintedHref).toBe('https://example.test/private-roadmap');

    access = 'none';
    notify?.();
    await settleFrame();
    expect(instance.module.yjsManager.toJSON().find(({ id }) => id === copiedCell?.id)?.data).toEqual({ text: cellText });
    expect(sourceAnchor?.textContent).toBe('No access');
    expect(sourceAnchor?.hasAttribute('href')).toBe(false);
  }, 30_000);

  it('keeps nested page references neutral in shared cell data after duplicating a table', async () => {
    const cellText = '<a data-blok-page-id="p1">Page</a>';
    const instance = new Blok({
      holder,
      tools: {
        paragraph: Paragraph,
        table: Table,
        toggle: ToggleItem,
        page: {
          class: PageTool,
          config: {
            resolve: () => ({ title: 'Secret Roadmap' }),
            href: () => 'https://example.test/private-roadmap',
          },
        },
      },
      data: {
        blocks: [
          {
            id: 'tbl',
            type: 'table',
            data: { withHeadings: false, content: [[{ blocks: ['tg'] }, { blocks: ['b'] }]] },
            content: ['tg', 'b'],
          },
          { id: 'tg', type: 'toggle', data: { text: 'Toggle', isOpen: true }, parent: 'tbl', content: ['k'] },
          { id: 'k', type: 'paragraph', data: { text: cellText }, parent: 'tg' },
          { id: 'b', type: 'paragraph', data: { text: 'B' }, parent: 'tbl' },
          { id: 'after', type: 'paragraph', data: { text: 'after' } },
        ],
      },
    }) as unknown as Runtime;

    editor = instance;
    await instance.isReady;
    await settleFrame();
    const sourceAnchor = instance.module.blockManager.getBlockById('k')?.holder.querySelector<HTMLAnchorElement>(`a[${PAGE_ID_ATTR}="p1"]`);
    const paintedTitle = sourceAnchor?.textContent;
    const paintedHref = sourceAnchor?.getAttribute('href');

    await instance.save();
    const sourceTable = instance.module.blockManager.getBlockById('tbl');

    if (sourceTable === undefined) {
      throw new Error('source table is missing');
    }
    const [copy] = await instance.module.dragManager.duplicateBlocksInPlace(sourceTable);

    if (copy === undefined) {
      throw new Error('duplicate table is missing');
    }
    const shared = instance.module.yjsManager.toJSON();
    const copiedToggle = shared.find(({ parent, type }) => parent === copy.id && type === 'toggle');
    const copiedChild = shared.find(({ parent, data }) =>
      parent === copiedToggle?.id && typeof data.text === 'string' && data.text.includes(PAGE_ID_ATTR));

    expect(copiedChild?.data).toEqual({ text: cellText });
    expect(paintedTitle).toBe('Secret Roadmap');
    expect(paintedHref).toBe('https://example.test/private-roadmap');
  }, 30_000);

  it('does not show an older allowed result after a newer denial', async () => {
    let notify: (() => void) | undefined;
    let finishOlder: ((value: { title: string }) => void) | undefined;
    const older = new Promise<{ title: string }>(resolve => { finishOlder = resolve; });
    const resolve = vi.fn()
      .mockReturnValueOnce(older)
      .mockResolvedValueOnce({ access: 'none', title: 'Restricted title' });
    const instance = createEditor({
      resolve,
      subscribe: (_id, onChange) => { notify = onChange; },
    });

    await instance.isReady;
    await settleFrame();
    notify?.();
    await settleFrame();
    finishOlder?.({ title: 'Old allowed title' });
    await settleFrame();

    expect(holder?.textContent).not.toContain('Restricted title');
    expect(holder?.textContent).not.toContain('Old allowed title');
    expect(anchors().map(anchor => anchor.textContent)).toEqual(['No access', 'No access']);
    expect(anchors().every(anchor => !anchor.hasAttribute('href'))).toBe(true);
  });

  it('releases a page subscription after its anchors are removed and on destroy', async () => {
    const stop = vi.fn();
    const subscribe = vi.fn(() => stop);
    const instance = createEditor({ resolve: () => ({ title: 'Visible' }), subscribe });

    await instance.isReady;
    await settleFrame();
    expect(subscribe).toHaveBeenCalledTimes(1);

    await instance.blocks.delete(0, false);
    await settleFrame();
    expect(stop).toHaveBeenCalledTimes(1);

    instance.destroy();
    editor = undefined;
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('leaves a nested editor page reference to its own editor', async () => {
    const outer = new Blok({
      holder,
      tools: { paragraph: Paragraph },
      data: { blocks: [{ id: 'outer', type: 'paragraph', data: { text: 'Outer' } }] },
    }) as unknown as Runtime;

    editor = outer;
    await outer.isReady;
    const wrapper = holder?.querySelector('[data-blok-editor]');

    if (wrapper === null || wrapper === undefined) {
      throw new Error('Outer editor wrapper is missing');
    }
    const nestedHolder = document.createElement('div');

    wrapper.appendChild(nestedHolder);
    const open = vi.fn();
    const inner = new Blok({
      holder: nestedHolder,
      tools: { paragraph: Paragraph, page: { class: PageTool, config: { resolve: () => ({ title: 'Inner page' }), open } } },
      data: { blocks: [{ id: 'inner', type: 'paragraph', data: { text: '<a data-blok-page-id="p1">Page</a>' } }] },
    }) as unknown as Runtime;

    nestedEditor = inner;
    await inner.isReady;
    await settleFrame();
    const anchor = nestedHolder.querySelector<HTMLAnchorElement>(`a[${PAGE_ID_ATTR}="p1"]`);

    anchor?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await settleFrame();

    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('p1', { event: expect.any(MouseEvent) });
  });

  it('opens an allowed reference without href, then refuses click after access revocation', async () => {
    let notify: (() => void) | undefined;
    let access: 'allowed' | 'none' = 'allowed';
    const open = vi.fn();
    const instance = createEditor({
      resolve: () => access === 'none' ? { access: 'none', title: 'Restricted title' } : { title: 'Readable' },
      subscribe: (_id, onChange) => { notify = onChange; },
      open,
    }, '<a data-blok-page-id="p1">Page</a>');

    await instance.isReady;
    await settleFrame();
    const anchor = anchors()[0];

    expect(anchor?.hasAttribute('href')).toBe(false);
    anchor?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await settleFrame();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('p1', { event: expect.any(MouseEvent) });

    access = 'none';
    notify?.();
    await settleFrame();
    const deniedClick = new MouseEvent('click', { bubbles: true, cancelable: true });

    anchor?.dispatchEvent(deniedClick);
    await settleFrame();
    expect(holder?.textContent).not.toContain('Restricted title');
    expect(deniedClick.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('leaves a modified click on an allowed reference to the browser', async () => {
    const open = vi.fn();
    const instance = createEditor({
      resolve: () => ({ title: 'Readable' }),
      href: () => 'https://example.test/page/p1',
      open,
    }, '<a data-blok-page-id="p1">Page</a>');

    await instance.isReady;
    await settleFrame();
    const anchor = anchors()[0];
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    let browserCanHandleClick = false;

    anchor?.addEventListener('click', (event) => {
      browserCanHandleClick = !event.defaultPrevented;
      event.preventDefault();
    });
    anchor?.dispatchEvent(click);
    expect(browserCanHandleClick).toBe(true);
    await settleFrame();
    expect(open).not.toHaveBeenCalled();
  });

  it('does not call open for a modified click without a browser link', async () => {
    const open = vi.fn();
    const instance = createEditor({ resolve: () => ({ title: 'Readable' }), open });

    await instance.isReady;
    await settleFrame();
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });

    anchors()[0]?.dispatchEvent(click);
    await settleFrame();
    expect(open).not.toHaveBeenCalled();
    expect(click.defaultPrevented).toBe(true);
  });

  it('opens with navigation-mode Enter without href, then refuses it after revocation', async () => {
    let notify: (() => void) | undefined;
    let access: 'allowed' | 'none' = 'allowed';
    const open = vi.fn();
    const instance = createEditor({
      resolve: () => access === 'none' ? { access: 'none', title: 'Restricted title' } : { title: 'Readable' },
      subscribe: (_id, onChange) => { notify = onChange; },
      open,
    }, '<a data-blok-page-id="p1">Page</a>');

    await instance.isReady;
    await settleFrame();
    const anchor = anchors()[0];

    expect(anchor?.tabIndex).toBe(0);
    instance.module.blockSelection.enableNavigationMode();
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });

    anchor?.dispatchEvent(enter);
    await settleFrame();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('p1', { event: expect.any(KeyboardEvent) });

    access = 'none';
    notify?.();
    await settleFrame();
    instance.module.blockSelection.enableNavigationMode();
    const deniedEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });

    anchor?.dispatchEvent(deniedEnter);
    await settleFrame();
    expect(holder?.textContent).not.toContain('Restricted title');
    expect(deniedEnter.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('keeps a URL edit of a selected page reference after save', async () => {
    const instance = new Blok({
      holder,
      tools: {
        paragraph: Paragraph,
        page: { class: PageTool, config: { resolve: () => ({ title: 'Readable' }) } },
        link: LinkInlineTool,
      },
      data: {
        blocks: [{
          id: 'paragraph-1',
          type: 'paragraph',
          data: { text: '<a data-blok-page-id="p1">Page</a>' },
        }],
      },
    }) as unknown as Runtime;

    editor = instance;
    await instance.isReady;
    await settleFrame();

    const anchor = anchors()[0];

    if (anchor === undefined) {
      throw new Error('Page reference was not rendered');
    }

    const range = document.createRange();

    range.selectNodeContents(anchor);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    anchor.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'k',
      code: 'KeyK',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }));
    await settleFrame();

    const input = document.querySelector<HTMLInputElement>('[data-blok-testid="inline-tool-input"]');

    if (input === null) {
      throw new Error('Link editor did not open for the selected page reference');
    }

    input.value = 'https://outside.example/page';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }));
    await settleFrame();

    const savedText = (await instance.save()).blocks[0]?.data.text;

    expect(savedText).toContain('href="https://outside.example/page"');
    expect(savedText).not.toContain(PAGE_ID_ATTR);
  });

  it('keeps ordinary selected-block Enter in the block navigation path', async () => {
    const open = vi.fn();
    const instance = createEditor({ resolve: () => ({ title: 'Readable' }), open });

    await instance.isReady;
    await settleFrame();
    instance.module.blockSelection.enableNavigationMode();
    const selectedBlock = holder?.querySelector('[data-blok-navigation-focused]');
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });

    selectedBlock?.dispatchEvent(enter);
    expect(open).not.toHaveBeenCalled();
    expect(enter.defaultPrevented).toBe(true);
    expect(instance.module.blockSelection.navigationModeEnabled).toBe(false);
  });

  it('stops listening when the editor is destroyed and ignores late resolutions', async () => {
    let finish: ((value: { title: string }) => void) | undefined;
    const pending = new Promise<{ title: string }>(resolve => { finish = resolve; });
    const stop = vi.fn();
    const instance = createEditor({
      resolve: () => pending,
      subscribe: () => stop,
    });

    await instance.isReady;
    await settleFrame();
    const anchor = anchors()[0];

    instance.destroy();
    editor = undefined;
    finish?.({ title: 'Late title' });
    await settleFrame();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(anchor?.textContent).toBe('Page');
  });
});
