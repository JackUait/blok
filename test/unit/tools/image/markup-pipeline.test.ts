import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { ImageTool } from '../../../../src/tools/image';
import { sanitizeBlocks, stripUnsafeUrlsDeep } from '../../../../src/components/utils/sanitizer';
import { YBlockSerializer } from '../../../../src/components/modules/yjs/serializer';
import { createMarkupLayer } from '../../../../src/tools/image/markup/render';
import { readMarkup } from '../../../../src/tools/image/markup/model';
import type { ImageMarkup } from '../../../../types/tools/image';

const HOSTILE = 'a < b & c <img src=x onerror=alert(1)>\n<script>x</script> &amp; javascript:alert(1)';

/** Ids out of order, so a read-back that sorts by key cannot pass by accident. */
const MARKUP: ImageMarkup[] = [
  { id: 'z', type: 'text', color: '#ffffff', x: 0.5, y: 0.25, text: HOSTILE, size: 0.06, style: 'background', rotation: -12.5 },
  { id: 'a', type: 'pen', color: '#ff3b30', points: [0.1, 0.1, 0.5, 0.2, 0.3, 0.75, 0.4, 0.5, 1], size: 0.012 },
  { id: 'm', type: 'ellipse', color: '#0a84ff', x1: 0.2, y1: 0.3, x2: 0.6, y2: 0.7, size: 0.024, fill: true },
  { id: 'c', type: 'arrow', color: '#111111', x1: 0.9, y1: 0.9, x2: 0.1, y2: 0.5, size: 0.006 },
];

const data = (): Record<string, unknown> => ({ url: 'https://x/y.png', caption: 'Cap', markup: structuredClone(MARKUP) });

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('image markup through the sanitizer', () => {
  /** The save, paste and blockManager paths run sanitizeBlocks; the renderer adds stripUnsafeUrlsDeep after it. */
  it('keeps every mark byte for byte, even under a host-wide sanitizer', () => {
    const config = ImageTool.sanitize;
    const [cleaned] = sanitizeBlocks([{ tool: 'image', data: data() }], () => config, { b: true });
    const rendered = stripUnsafeUrlsDeep(cleaned.data, config);

    expect(cleaned.data.markup).toStrictEqual(MARKUP);
    expect(rendered.markup).toStrictEqual(MARKUP);
  });

  it('draws the hostile text as text, never as elements', () => {
    const [cleaned] = sanitizeBlocks([{ tool: 'image', data: data() }], () => ImageTool.sanitize);
    const svg = createMarkupLayer(readMarkup(cleaned.data.markup), { w: 800, h: 600 });
    const text = svg.querySelector('[data-markup-id="z"]');

    expect(svg.querySelector('img, script, foreignObject')).toBeNull();
    expect(text?.textContent).toBe(HOSTILE.replace('\n', ''));
    expect(Array.from(text?.querySelectorAll('tspan') ?? [], (t) => t.textContent)).toEqual(HOSTILE.split('\n'));
  });
});

describe('image markup through the Yjs serializer', () => {
  it('round-trips deep-equal with the order kept', () => {
    const serializer = new YBlockSerializer();
    const ydoc = new Y.Doc();
    const yblocks = ydoc.getArray('blocks');
    const block = { id: 'img1', type: 'image', data: data() };

    yblocks.push([serializer.outputDataToYBlock(block)]);
    const back = serializer.yBlockToOutputData(yblocks.get(0) as Y.Map<unknown>);

    expect(back?.data.markup).toStrictEqual(MARKUP);
    expect(back).toStrictEqual(block);
  });
});
