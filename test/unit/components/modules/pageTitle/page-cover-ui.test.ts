import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../../src/blok';
import { DATA_ATTR } from '../../../../../src/components/constants/data-attributes';
import { COVER_GALLERY } from '../../../../../src/shared/page-cover';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { Blok as PublicBlok, BlokConfig, OutputData } from '../../../../../types';
import type { PageCover } from '../../../../../types/tools/page';

const create = (config: Partial<BlokConfig>): PublicBlok =>
  new Blok({ tools: { paragraph: { class: Paragraph } }, ...config }) as unknown as PublicBlok;

const DOC: OutputData = { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'hi' } }] };
const IMAGE: PageCover = { type: 'image', url: 'https://example.com/cover.png', position: 30 };

describe('page cover UI', () => {
  let holder: HTMLDivElement;
  let blok: PublicBlok | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    blok?.destroy();
    blok = null;
    holder.remove();
    document.querySelectorAll(`[${DATA_ATTR.pageCoverPicker}]`).forEach((node) => node.remove());
    vi.restoreAllMocks();
  });

  const boot = async (config: Partial<BlokConfig> = {}, data: OutputData = DOC): Promise<PublicBlok> => {
    blok = create({ holder, pageTitle: { cover: true }, data, ...config });
    await blok.isReady;

    return blok;
  };

  const strip = (): HTMLElement | null => holder.querySelector<HTMLElement>(`[${DATA_ATTR.pageCover}]`);
  const addCover = (): HTMLButtonElement | null => holder.querySelector<HTMLButtonElement>(`[${DATA_ATTR.pageAddCover}]`);
  const byTestId = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const found = document.querySelector<T>(`[data-blok-testid="${id}"]`);

    if (found === null) {
      throw new Error(`no ${id}`);
    }

    return found;
  };
  const picker = (): HTMLElement | null => document.querySelector<HTMLElement>(`[${DATA_ATTR.pageCoverPicker}]`);

  it('with the flag off, the header has no cover and no Add cover, even when the page has one', async () => {
    await boot({ pageTitle: true }, { ...DOC, cover: IMAGE });

    expect(strip()).toBeNull();
    expect(addCover()).toBeNull();
  });

  it('Add cover sits in the row over the title and puts a gallery cover above it', async () => {
    const editor = await boot();
    const button = addCover();

    expect(button?.parentElement?.hasAttribute(DATA_ATTR.pageIconRow)).toBe(true);
    expect(button?.hidden).toBe(false);
    expect(button?.querySelector('span')?.textContent).toBe('Add cover');

    button?.click();
    const cover = editor.title.cover.get();

    expect(cover?.type).toBe('gallery');
    expect(COVER_GALLERY).toContain(cover?.type === 'gallery' ? cover.id : '');
    expect(holder.querySelector(`[${DATA_ATTR.pageHeader}]`)?.firstElementChild).toBe(strip());
    expect(strip()?.querySelector(`[${DATA_ATTR.pageCoverFill}]`)?.getAttribute(DATA_ATTR.pageCoverId)).toBe(cover?.type === 'gallery' ? cover.id : null);
    expect(addCover()?.hidden).toBe(true);
  });

  it('draws an image cover at its saved position', async () => {
    await boot({}, { ...DOC, cover: IMAGE });
    const image = strip()?.querySelector('img');

    expect(image?.getAttribute('src')).toBe(IMAGE.type === 'image' ? IMAGE.url : '');
    expect(image?.style.objectPosition).toBe('center 30%');
  });

  it('never loads an unsafe image url', async () => {
    await boot({}, { ...DOC, cover: { type: 'image', url: 'javascript:alert(1)' } });

    expect(strip()?.querySelector('img')?.hasAttribute('src')).toBe(false);
  });

  it('read-only shows the cover without Add cover or its buttons', async () => {
    await boot({ readOnly: true }, { ...DOC, cover: IMAGE });

    expect(strip()).not.toBeNull();
    expect(addCover()?.hidden ?? true).toBe(true);
    expect(strip()?.querySelector(`[${DATA_ATTR.pageCoverControls}]`)).toBeNull();
  });

  it('undo takes the cover away again', async () => {
    const editor = await boot();

    addCover()?.click();
    editor.history.undo();

    expect(strip()).toBeNull();
    expect(addCover()?.hidden).toBe(false);
  });

  describe('picker', () => {
    it('Change opens Gallery, Upload and Link, and a gallery tile sets that cover', async () => {
      const editor = await boot({}, { ...DOC, cover: IMAGE });

      byTestId('page-cover-change').click();

      expect(picker()).not.toBeNull();
      expect(byTestId('page-cover-change').getAttribute('aria-expanded')).toBe('true');
      expect([...(picker()?.querySelectorAll('[role="tab"]') ?? [])].map((tab) => tab.textContent)).toEqual(['Gallery', 'Upload', 'Link']);

      byTestId('page-cover-gallery-green').click();

      expect(editor.title.cover.get()).toEqual({ type: 'gallery', id: 'green' });
      expect(picker()).toBeNull();
    });

    it('Remove takes the cover away', async () => {
      const editor = await boot({}, { ...DOC, cover: IMAGE });

      byTestId('page-cover-change').click();
      byTestId('page-cover-remove').click();

      expect(editor.title.cover.get()).toBeNull();
      expect(strip()).toBeNull();
    });

    it('Link refuses a link that is not an image and takes one that is', async () => {
      const editor = await boot({}, { ...DOC, cover: { type: 'gallery', id: 'red' } });

      byTestId('page-cover-change').click();
      byTestId('page-cover-tab-link').click();
      const input = byTestId<HTMLInputElement>('page-cover-link-input');

      expect(input.placeholder).toBe('Paste an image link…');
      input.value = 'javascript:alert(1)';
      byTestId('page-cover-link-submit').click();

      expect(picker()?.querySelector('[role="alert"]')?.textContent).not.toBe('');
      expect(editor.title.cover.get()).toEqual({ type: 'gallery', id: 'red' });

      input.value = 'https://example.com/new.png';
      byTestId('page-cover-link-submit').click();

      expect(editor.title.cover.get()).toEqual({ type: 'image', url: 'https://example.com/new.png' });
    });

    it('Upload sends the file through the image uploader', async () => {
      const uploadByFile = vi.fn().mockResolvedValue({ url: 'https://cdn.example.com/up.png' });
      const editor = await boot({ uploader: { uploadByFile } }, { ...DOC, cover: { type: 'gallery', id: 'red' } });

      byTestId('page-cover-change').click();
      byTestId('page-cover-tab-upload').click();
      const input = byTestId<HTMLInputElement>('page-cover-file');
      const file = new File(['x'], 'cover.png', { type: 'image/png' });

      Object.defineProperty(input, 'files', { value: [file] });
      input.dispatchEvent(new Event('change'));
      await vi.waitFor(() => expect(editor.title.cover.get()).toEqual({ type: 'image', url: 'https://cdn.example.com/up.png' }));

      expect(uploadByFile).toHaveBeenCalledWith(file, expect.objectContaining({ kind: 'image' }));
    });

    it('Upload with no uploader points to Link', async () => {
      await boot({}, { ...DOC, cover: { type: 'gallery', id: 'red' } });

      byTestId('page-cover-change').click();
      byTestId('page-cover-tab-upload').click();

      expect(picker()?.textContent).toContain('Paste an image link instead');
    });
  });

  describe('reposition', () => {
    const drag = (dy: number): void => {
      const target = strip();

      if (target === null) {
        throw new Error('no strip');
      }
      vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 100));
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientY: 50, pointerId: 1 }));
      target.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: 50 + dy, pointerId: 1 }));
      target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientY: 50 + dy, pointerId: 1 }));
    };

    it('only an image cover offers Reposition', async () => {
      await boot({}, { ...DOC, cover: { type: 'gallery', id: 'red' } });

      expect(document.querySelector('[data-blok-testid="page-cover-reposition"]')).toBeNull();
    });

    it('drag then Save position saves the new position', async () => {
      const editor = await boot({}, { ...DOC, cover: IMAGE });

      byTestId('page-cover-reposition').click();

      expect(strip()?.querySelector(`[${DATA_ATTR.pageCoverHint}]`)?.textContent).toBe('Drag image to reposition');
      drag(-20);
      byTestId('page-cover-save-position').click();

      expect(editor.title.cover.get()).toEqual({ ...IMAGE, position: 50 });
      expect(strip()?.querySelector(`[${DATA_ATTR.pageCoverHint}]`)).toBeNull();
    });

    it('Cancel keeps the saved position', async () => {
      const editor = await boot({}, { ...DOC, cover: IMAGE });

      byTestId('page-cover-reposition').click();
      drag(-20);
      byTestId('page-cover-cancel-position').click();

      expect(editor.title.cover.get()).toEqual(IMAGE);
      expect(strip()?.querySelector('img')?.style.objectPosition).toBe('center 30%');
    });
  });
});
