import type { Locator, Page } from '@playwright/test';
import type { Blok, OutputBlockData, OutputData } from '@/types';
import { expect } from '../helpers/shared-page';

declare global {
  interface Window {
    blokInstance?: Blok;
    __uploads?: string[];
  }
}

export const HOLDER_ID = 'blok';
export const IMG = 'http://127.0.0.1:4444/test/playwright/fixtures/image/shot.png';
export const IMG2 = 'http://127.0.0.1:4444/test/playwright/fixtures/image/photo.jpg';
export const VIDEO = 'http://localhost:4444/public/samples/big-buck-bunny.mp4';
export const AUDIO = 'http://localhost:4444/public/samples/soundhelix-song-1.mp3';
export const AUDIO_COVER = 'http://localhost:4444/public/samples/soundhelix-song-1-cover.png';

export type Clip = Record<string, string>;
export type Variant = 'full' | 'html-only' | 'plain-only';

export const createEditor = async (
  page: Page,
  blocks: OutputBlockData[],
  options: { pageLink?: boolean } = {}
): Promise<void> => {
  await page.evaluate(async ({ holder, initialBlocks, pageLink }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);

    const uploads: string[] = [];

    window.__uploads = uploads;

    const record = (kind: string) => (arg: unknown): Promise<{ url: string; fileName?: string }> => {
      const label = typeof arg === 'string' ? arg : (arg as { name?: string }).name ?? 'file';

      uploads.push(`${kind}:${label}`);

      return Promise.resolve({ url: typeof arg === 'string' ? arg : `http://127.0.0.1:4444/uploaded/${label}`, fileName: label });
    };
    const uploader = (tool: string): Record<string, unknown> => ({
      uploadByUrl: record(`${tool}.uploadByUrl`),
      uploadByFile: record(`${tool}.uploadByFile`),
    });
    const defaults = (window as unknown as { defaultBlockTools: Record<string, { class: unknown; config?: Record<string, unknown> }> }).defaultBlockTools;
    const tools: Record<string, unknown> = {
      image: { class: defaults.image.class, config: { uploader: uploader('image') } },
      video: { class: defaults.video.class, config: { uploader: uploader('video') } },
      audio: { class: defaults.audio.class, config: { uploader: uploader('audio') } },
      file: { class: defaults.file.class, config: { uploader: uploader('file') } },
    };

    if (pageLink) {
      const toolsUrl = '/dist/tools.mjs?_v=1';
      const { PageLink } = await import(toolsUrl) as { PageLink: unknown };
      const config = {
        resolve: (pageId: string) => ({ title: `Title ${pageId}`, path: [] }),
        search: () => Promise.resolve([]),
        href: (pageId: string) => `/pages/${pageId}`,
      };

      tools.page = { class: defaults.page.class, config };
      tools['page-link'] = { class: PageLink, config };
    }

    const blok = new window.Blok({ holder, data: { blocks: initialBlocks }, tools });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initialBlocks: blocks, pageLink: options.pageLink === true });
};

export const save = async (page: Page): Promise<OutputData> =>
  await page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('no editor');
    }

    return await window.blokInstance.save();
  });

export const uploads = async (page: Page): Promise<string[]> =>
  await page.evaluate(() => [...(window.__uploads ?? [])]);

/** Waits until two saves in a row agree, so normalisation and loads settle. */
export const settledSave = async (page: Page): Promise<OutputData> => {
  let last = '';

  for (let i = 0; i < 20; i++) {
    // eslint-disable-next-line playwright/no-wait-for-timeout -- paste and save settle with no event to wait on
    await page.waitForTimeout(150);
    const saved = await save(page);
    const json = JSON.stringify(saved.blocks);

    if (json === last) {
      return saved;
    }
    last = json;
  }

  return await save(page);
};

export const holder = (page: Page, id: string): Locator => page.locator(`[data-blok-id="${id}"]`);

export const selectedIds = async (page: Page): Promise<string[]> =>
  await page.evaluate(() => Array.from(document.querySelectorAll('[data-blok-selected="true"]'))
    .map((el) => el.getAttribute('data-blok-id') ?? '')
    .filter((id) => id !== ''));

/**
 * Select blocks the keyboard way: Escape on the anchor paragraph, ArrowDown to
 * the first target, Shift+ArrowDown to extend.
 */
export const selectByKeyboard = async (page: Page, anchorId: string, down: number, extend = 0): Promise<void> => {
  const editable = holder(page, anchorId).locator('[contenteditable="true"]').first();

  await editable.click();
  await page.keyboard.press('Escape');
  await expect(holder(page, anchorId)).toHaveAttribute('data-blok-selected', 'true');
  for (let i = 0; i < down; i++) {
    await page.keyboard.press('ArrowDown');
  }
  if (extend > 0) {
    await page.keyboard.down('Shift');
    for (let i = 0; i < extend; i++) {
      await page.keyboard.press('ArrowDown');
    }
    await page.keyboard.up('Shift');
  }
};

/** Cmd/Ctrl+A three times from a paragraph: text, block, every block. */
export const selectAll = async (page: Page, anchorId: string): Promise<void> => {
  const editable = holder(page, anchorId).locator('[contenteditable="true"]').first();

  await editable.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+A');
};

/** Fires copy/cut on the focused element (the listener sits on document) and returns every flavour written. */
export const clip = async (page: Page, type: 'copy' | 'cut'): Promise<Clip> =>
  await page.evaluate(async (eventType) => {
    const written: Record<string, string> = {};
    const dataTransfer = new DataTransfer();
    const setData = dataTransfer.setData.bind(dataTransfer);

    dataTransfer.setData = (format: string, data: string): void => {
      written[format] = data;
      setData(format, data);
    };

    const event = new ClipboardEvent(eventType, { bubbles: true, cancelable: true, clipboardData: dataTransfer });

    if (event.clipboardData !== dataTransfer) {
      Object.defineProperty(event, 'clipboardData', { value: dataTransfer });
    }
    (document.activeElement ?? document.body).dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 50));

    return written;
  }, type);

export const degrade = (data: Clip, variant: Variant): Clip => {
  if (variant === 'full') {
    return data;
  }
  if (variant === 'html-only') {
    return Object.fromEntries(Object.entries(data).filter(([key]) => key === 'text/html' || key === 'text/plain'));
  }

  return { 'text/plain': data['text/plain'] ?? '' };
};

/** Fires a paste with a real DataTransfer on the focused element. */
export const pasteFocused = async (page: Page, data: Clip): Promise<void> => {
  await page.evaluate((flavours) => {
    const dataTransfer = new DataTransfer();

    Object.entries(flavours).forEach(([type, value]) => dataTransfer.setData(type, value));

    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dataTransfer });

    if (event.clipboardData !== dataTransfer) {
      Object.defineProperty(event, 'clipboardData', { value: dataTransfer });
    }
    (document.activeElement ?? document.body).dispatchEvent(event);
  }, data);
};

/** Click into a block's editable (optionally at a text offset) and paste. */
export const pasteInto = async (page: Page, targetId: string, data: Clip, offset?: number): Promise<void> => {
  const editable = holder(page, targetId).locator('[contenteditable="true"]').first();

  await editable.click();
  if (offset !== undefined) {
    await editable.evaluate((el, at) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const node = walker.nextNode();
      const range = document.createRange();

      if (node === null) {
        range.setStart(el, 0);
      } else {
        range.setStart(node, Math.min(at, node.textContent?.length ?? 0));
      }
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }, offset);
  }
  await pasteFocused(page, data);
};

export type Node = { type: string; data: Record<string, unknown>; tunes?: unknown; children: Node[] };

/** Rebuilds the subtree of each root, ids dropped, children via content order. */
export const forest = (blocks: OutputBlockData[], rootIds: string[]): Node[] => {
  const byId = new Map(blocks.map((block) => [block.id ?? '', block]));
  const build = (id: string): Node => {
    const block = byId.get(id);

    if (block === undefined) {
      return { type: 'MISSING', data: { id }, children: [] };
    }

    const tunes = block.tunes !== undefined && Object.keys(block.tunes).length > 0 ? block.tunes : undefined;

    return {
      type: block.type,
      data: block.data,
      ...(tunes !== undefined && { tunes }),
      children: (block.content ?? []).map(build),
    };
  };

  return rootIds.map(build);
};

/** Ids that exist in `after` but not in `before`, roots of the new set first-level only. */
export const newRoots = (before: OutputData, after: OutputData): string[] => {
  const old = new Set(before.blocks.map((block) => block.id));
  const fresh = after.blocks.filter((block) => !old.has(block.id));
  const freshIds = new Set(fresh.map((block) => block.id));

  return fresh.filter((block) => block.parent === undefined || !freshIds.has(block.parent)).map((block) => block.id ?? '');
};

export const waitForChange = async (page: Page, before: OutputData): Promise<OutputData> => {
  const beforeJson = JSON.stringify(before.blocks);

  for (let i = 0; i < 40; i++) {
    // eslint-disable-next-line playwright/no-wait-for-timeout -- paste and save settle with no event to wait on
    await page.waitForTimeout(100);
    const now = await save(page);

    if (JSON.stringify(now.blocks) !== beforeJson) {
      return await settledSave(page);
    }
  }

  return await settledSave(page);
};


export const blokPayload = (data: Clip): Array<{ tool: string; data: Record<string, unknown>; parentId?: string | null }> =>
  JSON.parse(data['application/x-blok'] ?? '[]') as Array<{ tool: string; data: Record<string, unknown>; parentId?: string | null }>;

/** Click an arbitrary editable and paste there. */
export const pasteAtLocator = async (page: Page, editable: Locator, data: Clip): Promise<void> => {
  await editable.click();
  await pasteFocused(page, data);
};
