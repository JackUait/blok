/**
 * Saved `width`/`height` come from collab peers, imports, the API and agents.
 * They must not size the frame past sane bounds: a saved ratio of 1 to 1e9
 * pushed the rest of the document millions of pixels down.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Embed, type EmbedData } from '../../../../src/tools/link/embed';
import { EMBED_SERVICES } from '../../../../src/tools/link/registry';
import { embedFrameSize } from '../../../../src/tools/link/embed/frame-size';
import { MAX_HEIGHT_PX, MIN_HEIGHT_PX } from '../../../../src/tools/image/resizer';
import type { API, BlockToolConstructorOptions } from '../../../../types';

const makeTool = (data: Partial<EmbedData>, dispatchChange = vi.fn()): Embed => new Embed({
  api: {
    i18n: { t: (key: string) => key, has: () => false, getLocale: () => 'en' },
    blocks: { delete: (): void => undefined, getBlockIndex: (): number => 0 },
    config: { linkPaste: { allowGenericEmbed: true, genericEmbedClickToLoad: false } },
    events: { on: (): void => undefined, off: (): void => undefined },
    tools: { getBlockTools: () => [] },
  } as unknown as API,
  block: { id: 'embed-block', dispatchChange } as never,
  config: {},
  readOnly: false,
  data,
} as unknown as BlockToolConstructorOptions<EmbedData>);

const SITE = 'https://site.example.test/page';
const DOCS = 'https://docs.google.com/document/d/1A2b3C4d5E6f7G8h9I0jKLMNOPqrstuv/edit';

const aspectOf = (root: HTMLElement): HTMLElement => {
  const aspect = root.querySelector<HTMLElement>('[data-role="embed-aspect"]');

  if (aspect === null) {
    throw new Error('aspect box missing');
  }

  return aspect;
};

/** Height over width of an `aspect-ratio: w / h` value. */
const heightPerWidth = (aspectRatio: string): number => {
  const [w, h] = aspectRatio.split('/').map((part) => Number(part.trim()));

  return h / w;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('embed frame size from saved data', () => {
  it('a saved 1 x 320 frame is at most four times as tall as it is wide', () => {
    const root = makeTool({ service: '', source: SITE, width: 1, height: 320 }).render();

    expect(heightPerWidth(aspectOf(root).style.aspectRatio)).toBeLessThanOrEqual(4);
  });

  it('a saved 1 x 1e9 frame is at most four times as tall as it is wide', () => {
    const root = makeTool({ service: '', source: SITE, width: 1, height: 1e9 }).render();

    expect(heightPerWidth(aspectOf(root).style.aspectRatio)).toBeLessThanOrEqual(4);
  });

  it('a saved 1e9 x 1 frame is at least a tenth as tall as it is wide', () => {
    const root = makeTool({ service: '', source: SITE, width: 1e9, height: 1 }).render();

    expect(heightPerWidth(aspectOf(root).style.aspectRatio)).toBeGreaterThanOrEqual(0.1);
  });

  it.each([
    ['Infinity', Infinity, Infinity],
    ['NaN', NaN, NaN],
    ['zero', 0, 0],
    ['negative', -580, -320],
    ['strings', '580', '1e9'],
  ])('%s width and height fall back to the default 580 x 320', (_label, width, height) => {
    const root = makeTool({ service: '', source: SITE, width: width as number, height: height as number }).render();

    expect(aspectOf(root).style.aspectRatio).toBe('580 / 320');
  });

  it('a document embed with a saved 1e9 px height stays within the height handle range', () => {
    const tall = makeTool({ service: 'googledocs', source: DOCS, height: 1e9 }).render();
    const short = makeTool({ service: 'googledocs', source: DOCS, height: 1 }).render();

    expect(aspectOf(tall).style.height).toBe(`${MAX_HEIGHT_PX}px`);
    expect(aspectOf(short).style.height).toBe(`${MIN_HEIGHT_PX}px`);
  });

  it('a normal saved size renders as saved', () => {
    const root = makeTool({ service: '', source: SITE, width: 580, height: 900 }).render();

    expect(aspectOf(root).style.aspectRatio).toBe('580 / 900');
  });

  it('keeps every registry provider default size', () => {
    for (const [name, service] of Object.entries(EMBED_SERVICES)) {
      const width = service.width ?? 580;
      // Script widgets list height 0; they draw no ratio box and get the default.
      const height = service.height !== undefined && service.height > 0 ? service.height : 320;

      expect(embedFrameSize(width, height, service.resizableHeight === true), name).toEqual({ width, height });
    }
  });

  it('dragging a narrow generic frame very tall saves a height reload shows the same', () => {
    const dispatchChange = vi.fn();
    const tool = makeTool({ service: '', source: SITE, width: 580, height: 320, widthPercent: 10 }, dispatchChange);
    const root = tool.render();
    const aspect = aspectOf(root);
    const handle = root.querySelector<HTMLElement>('[data-role="resize-handle"][data-edge="bottom"]');

    if (handle === null) {
      throw new Error('bottom handle missing');
    }

    // Shown 100 px wide; the handle allows up to 2000 px tall.
    Object.defineProperty(aspect, 'getBoundingClientRect', {
      value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 55, width: 100, height: 55, toJSON: () => ({}) }),
    });
    Object.assign(handle, { setPointerCapture: (): void => undefined, releasePointerCapture: (): void => undefined });
    handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientY: 0, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientY: 5000, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientY: 5000, bubbles: true }));

    const saved = tool.save();

    expect((saved.height ?? Number.NaN) / (saved.width ?? Number.NaN)).toBeLessThanOrEqual(4);
    expect(aspect.style.aspectRatio).toBe(`${saved.width} / ${saved.height}`);
    expect(dispatchChange).toHaveBeenCalled();
  });
});
