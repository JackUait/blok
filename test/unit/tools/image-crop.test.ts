import { describe, it, expect, vi } from 'vitest';
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
    expect(img!.style.marginLeft).toBe('-20%');
    expect(img!.style.marginTop).toBe('-50%');
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
  it('enterCrop swaps overlay for CropEditor; applyCrop writes data', () => {
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

    expect(root.querySelector('.blok-image-crop-editor')).not.toBeNull();
    expect(root.querySelector('[data-role="image-overlay"]')).toBeNull();

    const done = root.querySelector<HTMLButtonElement>('[data-action="done"]');
    expect(done).not.toBeNull();
    done!.click();

    expect(tool.save().crop).toBeUndefined();
    expect(root.querySelector('.blok-image-crop-editor')).toBeNull();
    expect(root.querySelector('[data-role="image-overlay"]')).not.toBeNull();
  });

  it('cancelCrop restores without data change', () => {
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
    const cancel = root.querySelector<HTMLButtonElement>('[data-action="cancel"]');
    cancel!.click();
    expect(tool.save().crop).toEqual({ x: 5, y: 5, w: 90, h: 90 });
  });
});
