import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageTool } from '../../../../src/tools/image';
import { PLAINTEXT } from '../../../../src/components/utils/sanitizer';
import type { ImageConfig, ImageData, ImageMarkup } from '../../../../types/tools/image';
import type { API, BlockAPI, BlockToolConstructorOptions } from '../../../../types';
import type { DarkroomResult } from '../../../../src/tools/image/darkroom';

vi.mock('../../../../src/tools/image/darkroom', () => ({ openDarkroom: vi.fn() }));

import { openDarkroom } from '../../../../src/tools/image/darkroom';

const mockDarkroom = vi.mocked(openDarkroom);

const MARKUP: ImageMarkup[] = [
  { id: 'a', type: 'text', color: '#ffffff', x: 0.5, y: 0.5, text: 'Hi', size: 0.06, style: 'outline' },
  { id: 'b', type: 'rect', color: '#ff3b30', x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.4, size: 0.012, fill: true },
];

const createOptions = (data: Partial<ImageData>): BlockToolConstructorOptions<ImageData, ImageConfig> => ({
  data: { url: 'https://x/y.png', ...data },
  config: {},
  api: {
    styles: { block: 'blok-block' },
    media: { reportFailure: vi.fn(), clearFailure: vi.fn(), confirmLeave: vi.fn() },
    i18n: { t: (k: string) => k, has: () => false },
  } as unknown as API,
  block: { id: 'b-self', name: 'image', holder: document.createElement('div'), dispatchChange: vi.fn() } as unknown as BlockAPI,
  readOnly: false,
});

const openEditor = (tool: ImageTool): Parameters<typeof openDarkroom>[0] => {
  const items = tool.renderSettings() as unknown as Array<{ name?: string; onActivate?: () => void }>;

  items.find((i) => i.name === 'image-crop')?.onActivate?.();
  const call = mockDarkroom.mock.calls.at(-1);

  if (!call) throw new Error('darkroom was never opened');

  return call[0];
};

const result = (over: Partial<DarkroomResult> = {}): DarkroomResult => ({
  crop: null,
  geometry: { rotation: 0, flipX: false, straighten: 0 },
  filter: 'none',
  adjust: { brightness: 0, contrast: 0, saturation: 0 },
  markup: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockDarkroom.mockReturnValue(vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('ImageTool markup', () => {
  it('saves valid marks and leaves the field out when there are none', () => {
    expect(new ImageTool(createOptions({ markup: MARKUP })).save().markup).toStrictEqual(MARKUP);
    expect('markup' in new ImageTool(createOptions({})).save()).toBe(false);
    expect('markup' in new ImageTool(createOptions({ markup: [] })).save()).toBe(false);
  });

  it('drops invalid marks on save', () => {
    const bad = { id: 'z', type: 'pen', color: 'red', points: [0, 0, 0.5], size: 0.01 };
    const tool = new ImageTool(createOptions({ markup: [...MARKUP, bad as unknown as ImageMarkup] }));

    expect(tool.save().markup).toStrictEqual(MARKUP);
  });

  it('gives a mark without an id the same id on every save', () => {
    const { id: _id, ...noId } = MARKUP[1];
    const tool = new ImageTool(createOptions({ markup: [noId as unknown as ImageMarkup] }));
    const first = tool.save().markup;

    expect(first?.[0]?.id).toEqual(expect.any(String));
    expect(tool.save().markup).toStrictEqual(first);
  });

  it('declares the marks plain text for the sanitizer', () => {
    expect(ImageTool.sanitize).toMatchObject({ markup: PLAINTEXT });
  });

  it('draws the marks in the rendered block', () => {
    const root = new ImageTool(createOptions({ markup: MARKUP })).render();

    expect(root.querySelector('[data-role="image-crop"] [data-role="image-plane"] svg[data-role="image-markup"]')).not.toBeNull();
  });

  it('opens the darkroom on the saved marks', () => {
    const tool = new ImageTool(createOptions({ markup: MARKUP }));

    tool.render();

    expect(openEditor(tool)).toMatchObject({ initialMarkup: MARKUP });
  });

  it('Done writes the marks it returns and clears them when it returns none', () => {
    const tool = new ImageTool(createOptions({}));

    tool.render();
    openEditor(tool).onApply(result({ markup: MARKUP }));
    expect(tool.save().markup).toStrictEqual(MARKUP);

    openEditor(tool).onApply(result({ markup: [] }));
    expect('markup' in tool.save()).toBe(false);
  });
});
