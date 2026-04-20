import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { renderImage } from '../../../src/tools/image/ui';

describe('renderImage with crop', () => {
  it('flat structure when crop absent', () => {
    const figure = renderImage({ url: 'x.png' });
    const img = figure.querySelector('img');
    expect(img?.parentElement).toBe(figure);
    expect(figure.querySelector('.blok-image-crop')).toBeNull();
  });

  it('wraps img in .blok-image-crop when crop present', () => {
    const figure = renderImage({
      url: 'x.png',
      crop: { x: 10, y: 20, w: 50, h: 40 },
    });
    const wrapper = figure.querySelector<HTMLElement>('.blok-image-crop');
    expect(wrapper).not.toBeNull();
    const img = wrapper!.querySelector<HTMLImageElement>('img');
    expect(img).not.toBeNull();
    expect(wrapper!.style.aspectRatio).toBe('50 / 40');
    expect(img!.style.width).toBe('200%');
    expect(img!.style.height).toBe('250%');
    expect(img!.style.maxWidth).toBe('none');
    expect(img!.style.transform).toBe('translate(-10%, -20%)');
  });
});

import { ImageTool } from '../../../src/tools/image';
import type { API, BlockAPI, BlockToolConstructorOptions } from '../../../types';
import type { ImageConfig, ImageData } from '../../../types/tools/image';

const mockApi = {} as unknown as API;
const mockBlock = { id: 'b1', dispatchChange: () => {} } as unknown as BlockAPI;

const createTool = (data: Partial<ImageData>): ImageTool => new ImageTool({
  api: mockApi,
  block: mockBlock,
  config: {} as ImageConfig,
  data: { url: 'x.png', ...data } as ImageData,
  readOnly: false,
} as BlockToolConstructorOptions<ImageData, ImageConfig>);

describe('ImageTool.save crop', () => {
  it('omits crop when absent', () => {
    const t = createTool({});
    expect(t.save().crop).toBeUndefined();
  });
  it('emits crop when set', () => {
    const t = createTool({ crop: { x: 10, y: 10, w: 80, h: 80 } });
    expect(t.save().crop).toEqual({ x: 10, y: 10, w: 80, h: 80 });
  });
  it('normalizes full rect to undefined', () => {
    const t = createTool({ crop: { x: 0, y: 0, w: 100, h: 100 } });
    expect(t.save().crop).toBeUndefined();
  });
  it('emits shape=circle even when rect is full', () => {
    const t = createTool({ crop: { x: 0, y: 0, w: 100, h: 100, shape: 'circle' } });
    expect(t.save().crop).toEqual({ x: 0, y: 0, w: 100, h: 100, shape: 'circle' });
  });
  it('emits shape=ellipse with custom rect', () => {
    const t = createTool({ crop: { x: 10, y: 10, w: 80, h: 60, shape: 'ellipse' } });
    expect(t.save().crop).toEqual({ x: 10, y: 10, w: 80, h: 60, shape: 'ellipse' });
  });
  it('does not emit shape=rect', () => {
    const t = createTool({ crop: { x: 10, y: 10, w: 80, h: 80, shape: 'rect' } });
    expect(t.save().crop).toEqual({ x: 10, y: 10, w: 80, h: 80 });
  });
});

import { renderOverlay } from '../../../src/tools/image/ui';

describe('renderOverlay crop button', () => {
  it('renders crop button that invokes onCrop', () => {
    const onCrop = vi.fn();
    const overlay = renderOverlay({
      state: { alignment: 'center', captionVisible: true, size: 'md' },
      onAlign: vi.fn(),
      onSize: vi.fn(),
      onReplace: vi.fn(),
      onDelete: vi.fn(),
      onDownload: vi.fn(),
      onFullscreen: vi.fn(),
      onCopyUrl: vi.fn(),
      onToggleCaption: vi.fn(),
      onCrop,
    });
    const btn = overlay.querySelector<HTMLButtonElement>('[data-action="crop"]')!;
    expect(btn).not.toBeNull();
    btn.click();
    expect(onCrop).toHaveBeenCalled();
  });
});

describe('ImageTool crop lifecycle', () => {
  beforeEach(() => {
    if (!('popover' in HTMLElement.prototype)) {
      Object.defineProperty(HTMLElement.prototype, 'popover', {
        configurable: true,
        get(this: HTMLElement) { return this.getAttribute('popover'); },
        set(this: HTMLElement, v: string) { this.setAttribute('popover', v); },
      });
    }
    if (typeof (HTMLElement.prototype as unknown as { showPopover?: () => void }).showPopover !== 'function') {
      (HTMLElement.prototype as unknown as { showPopover: () => void }).showPopover = function() {};
      (HTMLElement.prototype as unknown as { hidePopover: () => void }).hidePopover = function() {};
    }
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('enterCrop opens crop modal in document.body; block image stays rendered', () => {
    const dispatch = vi.fn();
    const block = { id: 'b1', dispatchChange: dispatch } as unknown as BlockAPI;
    const tool = new ImageTool({
      api: mockApi, block, config: {} as ImageConfig,
      data: { url: 'x.png' } as ImageData, readOnly: false,
    } as BlockToolConstructorOptions<ImageData, ImageConfig>);
    const root = tool.render();
    document.body.appendChild(root);

    const cropBtn = root.querySelector<HTMLButtonElement>('[data-action="crop"]');
    expect(cropBtn).not.toBeNull();
    cropBtn!.click();

    // Modal lives in document.body, NOT inside the block root
    expect(root.querySelector('.blok-image-crop-editor')).toBeNull();
    const dialog = document.body.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Crop image"]'
    );
    expect(dialog).not.toBeNull();
    expect(dialog!.querySelector('.blok-image-crop-editor')).not.toBeNull();

    // Block still renders image + overlay while modal is open
    expect(root.querySelector('.blok-image-inner img')).not.toBeNull();
    expect(root.querySelector('[data-role="image-overlay"]')).not.toBeNull();

    const done = dialog!.querySelector<HTMLButtonElement>('[data-action="done"]');
    expect(done).not.toBeNull();
    done!.click();

    expect(tool.save().crop).toBeUndefined();
    expect(document.body.querySelector('[role="dialog"][aria-label="Crop image"]')).toBeNull();
    expect(root.querySelector('[data-role="image-overlay"]')).not.toBeNull();
  });

  it('cancel button in modal restores without data change', () => {
    const block = { id: 'b1', dispatchChange: vi.fn() } as unknown as BlockAPI;
    const tool = new ImageTool({
      api: mockApi, block, config: {} as ImageConfig,
      data: { url: 'x.png', crop: { x: 5, y: 5, w: 90, h: 90 } } as ImageData,
      readOnly: false,
    } as BlockToolConstructorOptions<ImageData, ImageConfig>);
    const root = tool.render();
    document.body.appendChild(root);
    const crop = root.querySelector<HTMLButtonElement>('[data-action="crop"]');
    crop!.click();
    const cancel = document.body.querySelector<HTMLButtonElement>(
      '[role="dialog"] [data-action="cancel"]'
    );
    expect(cancel).not.toBeNull();
    cancel!.click();
    expect(tool.save().crop).toEqual({ x: 5, y: 5, w: 90, h: 90 });
    expect(document.body.querySelector('[role="dialog"][aria-label="Crop image"]')).toBeNull();
  });

  it('removed() while modal open tears down modal', () => {
    const block = { id: 'b1', dispatchChange: vi.fn() } as unknown as BlockAPI;
    const tool = new ImageTool({
      api: mockApi, block, config: {} as ImageConfig,
      data: { url: 'x.png' } as ImageData, readOnly: false,
    } as BlockToolConstructorOptions<ImageData, ImageConfig>);
    const root = tool.render();
    document.body.appendChild(root);
    root.querySelector<HTMLButtonElement>('[data-action="crop"]')!.click();
    expect(document.body.querySelector('[role="dialog"][aria-label="Crop image"]')).not.toBeNull();
    tool.removed();
    expect(document.body.querySelector('[role="dialog"][aria-label="Crop image"]')).toBeNull();
  });
});
