import { describe, it, expect } from 'vitest';
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
