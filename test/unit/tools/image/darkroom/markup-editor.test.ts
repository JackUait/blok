import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageMarkup, ImageMarkupShape, ImageMarkupStroke, ImageMarkupText } from '../../../../../types/tools/image';
import {
  createMarkupEditor,
  type MarkupEditor,
  type MarkupEditorOptions,
} from '../../../../../src/tools/image/darkroom/markup-editor';
import type { MarkupPanelState } from '../../../../../src/tools/image/darkroom/markup-panel';
import { MARKUP_SIZES } from '../../../../../src/tools/image/markup/model';
import type * as Freehand from '../../../../../src/tools/image/markup/freehand';
import { fakeFrameClock } from '../../../helpers/fake-frame-clock';

const outlineCalls = vi.hoisted(() => ({ sizes: [] as number[] }));

vi.mock('../../../../../src/tools/image/markup/freehand', async (importOriginal) => {
  const real = await importOriginal<typeof Freehand>();

  return {
    ...real,
    strokeOutline: (...args: Parameters<typeof real.strokeOutline>) => {
      outlineCalls.sizes.push(args[0].length / 3);

      return real.strokeOutline(...args);
    },
  };
});

// O box 1000 × 500 drawn at scale 0.5 from (100, 50): screen (x, y) is O ((x - 100) * 2, (y - 50) * 2).
const O = { w: 1000, h: 500 };
const PLANE = new DOMRect(100, 50, 500, 250);

const BASE: MarkupPanelState = { tool: 'pen', color: '#ff3b30', size: 1, textStyle: 'outline', fill: false };

const rect = (over: Partial<ImageMarkupShape> = {}): ImageMarkupShape => ({
  id: 'r1', type: 'rect', color: '#0a84ff', x1: 0.2, y1: 0.2, x2: 0.4, y2: 0.6, size: 0.012, ...over,
});

const text = (over: Partial<ImageMarkupText> = {}): ImageMarkupText => ({
  id: 't1', type: 'text', color: '#ffffff', x: 0.5, y: 0.5, text: 'Hi', size: 0.06, style: 'outline', ...over,
});

const editors: MarkupEditor[] = [];

const setup = (over: Partial<MarkupEditorOptions> = {}) => {
  const { clock, advance } = fakeFrameClock();
  const stage = document.createElement('div');
  const plane = document.createElement('div');

  stage.tabIndex = 0;
  stage.appendChild(plane);
  document.body.appendChild(stage);
  // An own property: spyOn would reuse the prototype spy and move every element.
  Object.defineProperty(plane, 'getBoundingClientRect', { value: () => PLANE });
  const onCommit = vi.fn<(next: ImageMarkup[]) => void>();
  const onSelectionChange = vi.fn();
  const onStateChange = vi.fn();
  const editor = createMarkupEditor({
    stage, plane, getSize: () => O, markup: [], state: { ...BASE }, clock,
    onCommit, onSelectionChange, onStateChange, ...over,
  });

  editors.push(editor);
  editor.setActive(true);
  const layer = stage.querySelector<HTMLElement>('[data-role="markup-layer"]');

  if (!layer) throw new Error('no layer');

  return { stage, plane, layer, editor, onCommit, onSelectionChange, onStateChange, advance };
};

type PointerInit = Partial<PointerEventInit>;

const fire = (target: Element, type: string, x: number, y: number, init: PointerInit = {}): PointerEvent => {
  const e = new PointerEvent(type, {
    bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0, pressure: 0.5, ...init,
  });

  target.dispatchEvent(e);

  return e;
};

const drag = (target: Element, from: [number, number], to: [number, number], init: PointerInit = {}): void => {
  fire(target, 'pointerdown', from[0], from[1], init);
  fire(target, 'pointermove', (from[0] + to[0]) / 2, (from[1] + to[1]) / 2, init);
  fire(target, 'pointermove', to[0], to[1], init);
  fire(target, 'pointerup', to[0], to[1], init);
};

const lastCommit = (fn: { mock: { calls: ImageMarkup[][][] } }): ImageMarkup[] => {
  const calls = fn.mock.calls;
  const last = calls[calls.length - 1];

  if (!last) throw new Error('no commit');

  return last[0];
};

const key = (target: Element, k: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });

  target.dispatchEvent(e);

  return e;
};

const textarea = (): HTMLTextAreaElement | null => document.querySelector('textarea');

const type = (value: string): void => {
  const ta = textarea();

  if (!ta) throw new Error('no editor');
  ta.value = value;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('createMarkupEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600));
  });

  afterEach(() => {
    editors.splice(0).forEach((e) => e.destroy());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('layers', () => {
    it('draws the marks into one svg layer inside the plane', () => {
      const { plane } = setup({ markup: [rect()] });

      const svgs = plane.querySelectorAll('svg[data-role="image-markup"]');

      expect(svgs).toHaveLength(1);
      expect(svgs[0].querySelector('[data-markup-id="r1"]')).not.toBeNull();
    });

    it('the interaction layer takes pointers only while active', () => {
      const { layer, editor } = setup();

      expect(layer.hidden).toBe(false);
      editor.setActive(false);
      expect(layer.hidden).toBe(true);
    });

    it('a press on the layer never reaches the stage, so crop gestures cannot start', () => {
      const { stage, layer } = setup();
      const onStage = vi.fn();

      stage.addEventListener('pointerdown', onStage);
      fire(layer, 'pointerdown', 300, 200);

      expect(onStage).not.toHaveBeenCalled();
    });

    it('set() redraws the layer from new data', () => {
      const { plane, editor } = setup({ markup: [rect()] });

      editor.set([text()]);

      expect(plane.querySelector('[data-markup-id="r1"]')).toBeNull();
      expect(plane.querySelector('[data-markup-id="t1"]')).not.toBeNull();
    });

    it('refresh() redraws the layer when the O size changes', () => {
      const size = { w: 1000, h: 500 };
      const { plane, editor } = setup({ markup: [rect()], getSize: () => size });
      const svg = plane.querySelector('svg');

      size.w = 500;
      size.h = 1000;
      editor.refresh();

      expect(svg?.getAttribute('viewBox')).toBe('0 0 500 1000');
    });
  });

  describe('pen', () => {
    it('one drag is one committed pen stroke in O fractions with the panel colour and size', () => {
      const { layer, onCommit } = setup();

      drag(layer, [350, 175], [400, 200]);

      expect(onCommit).toHaveBeenCalledTimes(1);
      const [mark] = lastCommit(onCommit);

      expect(mark.type).toBe('pen');
      expect(mark.color).toBe('#ff3b30');
      expect(mark.size).toBe(MARKUP_SIZES.pen[1]);
      const stroke = mark as ImageMarkupStroke;

      expect(stroke.points.slice(0, 2)).toStrictEqual([0.5, 0.5]);
      expect(stroke.points.slice(-3, -1)).toStrictEqual([0.6, 0.6]);
    });

    it('draws the live stroke on the next frame, before the pointer lifts', () => {
      const { layer, plane, advance } = setup();
      const livePaths = (): number => plane.querySelectorAll('[data-role="markup-live"] path').length;

      fire(layer, 'pointerdown', 350, 175);
      fire(layer, 'pointermove', 380, 190);
      expect(livePaths()).toBe(0);
      advance(16);

      expect(livePaths()).toBeGreaterThan(0);
    });

    it('a live highlighter paints the same two blend passes as the committed one', () => {
      const { layer, plane, advance } = setup({ state: { ...BASE, tool: 'highlighter', color: '#ffcc00' } });

      fire(layer, 'pointerdown', 350, 175);
      fire(layer, 'pointermove', 380, 190);
      advance(16);
      const live = Array.from(plane.querySelectorAll<SVGPathElement>('[data-role="markup-live"] path'));

      expect(live.map((p) => p.style.mixBlendMode)).toEqual(['multiply', 'screen']);
      expect(live.map((p) => p.getAttribute('opacity'))).toEqual(['0.55', '0.4']);
      expect(live[0]?.getAttribute('d')).toBe(live[1]?.getAttribute('d'));
    });

    it('a long live stroke only re-outlines its tail each frame', () => {
      const { layer, advance } = setup();

      fire(layer, 'pointerdown', 120, 60);
      outlineCalls.sizes.length = 0;
      Array.from({ length: 2000 }, (_, i) => i).forEach((i) => {
        fire(layer, 'pointermove', 120 + (i % 400), 60 + Math.floor(i / 400) * 30 + (i % 7));
        if (i % 4 === 3) advance(16);
      });

      expect(outlineCalls.sizes.length).toBeGreaterThan(0);
      expect(Math.max(...outlineCalls.sizes)).toBeLessThanOrEqual(80);
    });

    it('the live ink hands over to the committed stroke and leaves', () => {
      const { layer, plane, advance } = setup();

      drag(layer, [350, 175], [400, 200]);
      advance(1000);

      expect(plane.querySelectorAll('[data-role="markup-live"] path')).toHaveLength(0);
      expect(plane.querySelectorAll('svg[data-role="image-markup"] [data-markup-type="pen"]')).toHaveLength(1);
      expect(plane.querySelector<SVGElement>('[data-markup-type="pen"]')?.style.opacity).toBe('');
    });

    it('a mouse stroke stores its speed as pressure; a pen stroke stores its own', () => {
      const { layer, onCommit } = setup();

      drag(layer, [350, 175], [400, 200]);
      expect((lastCommit(onCommit)[0] as ImageMarkupStroke).points[2]).not.toBe(0.5);

      drag(layer, [350, 175], [400, 200], { pointerType: 'pen', pressure: 0.9, pointerId: 2 });
      expect((lastCommit(onCommit)[1] as ImageMarkupStroke).points[2]).toBe(0.9);
    });

    it('uses every coalesced sample once', () => {
      const { layer, onCommit } = setup();

      fire(layer, 'pointerdown', 350, 175);
      const move = new PointerEvent('pointermove', { bubbles: true, clientX: 450, clientY: 175, pointerId: 1, pointerType: 'mouse' });
      const samples = [
        new PointerEvent('pointermove', { clientX: 400, clientY: 225, pointerId: 1, pointerType: 'mouse' }),
        move,
      ];

      Object.defineProperty(move, 'getCoalescedEvents', { value: () => samples });
      layer.dispatchEvent(move);
      fire(layer, 'pointerup', 450, 175);

      const pts = (lastCommit(onCommit)[0] as ImageMarkupStroke).points;

      // Down, the coalesced sample off the straight line, the move itself.
      expect(pts).toHaveLength(9);
      expect(pts.slice(3, 5)).toStrictEqual([0.6, 0.7]);
    });

    it('the highlighter is three pen widths wide', () => {
      const { layer, onCommit, editor } = setup();

      editor.setState({ ...BASE, tool: 'highlighter', color: '#ffcc00' });
      drag(layer, [350, 175], [400, 200]);

      const mark = lastCommit(onCommit)[0];

      expect(mark.type).toBe('highlighter');
      expect(mark.size).toBeCloseTo(MARKUP_SIZES.pen[1] * 3, 6);
    });

    it('a second finger cancels the live stroke and leaves no mark', () => {
      const { layer, onCommit, plane, advance } = setup();

      fire(layer, 'pointerdown', 350, 175, { pointerType: 'touch' });
      fire(layer, 'pointermove', 380, 190, { pointerType: 'touch' });
      advance(16);
      fire(layer, 'pointerdown', 500, 200, { pointerType: 'touch', pointerId: 2 });
      fire(layer, 'pointerup', 380, 190, { pointerType: 'touch' });
      fire(layer, 'pointerup', 500, 200, { pointerType: 'touch', pointerId: 2 });
      advance(16);

      expect(onCommit).not.toHaveBeenCalled();
      expect(plane.querySelectorAll('[data-markup-type="pen"], [data-role="markup-live"] path')).toHaveLength(0);
    });

    it('while a pen is down a resting palm is ignored', () => {
      const { layer, onCommit } = setup();

      fire(layer, 'pointerdown', 350, 175, { pointerType: 'pen', pressure: 0.6 });
      fire(layer, 'pointerdown', 500, 250, { pointerType: 'touch', pointerId: 9 });
      fire(layer, 'pointermove', 400, 200, { pointerType: 'pen', pressure: 0.6 });
      fire(layer, 'pointerup', 400, 200, { pointerType: 'pen', pressure: 0.6 });
      fire(layer, 'pointerup', 500, 250, { pointerType: 'touch', pointerId: 9 });

      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(lastCommit(onCommit)).toHaveLength(1);
    });

    it('a right click draws nothing', () => {
      const { layer, onCommit } = setup();

      drag(layer, [350, 175], [400, 200], { button: 2 });

      expect(onCommit).not.toHaveBeenCalled();
    });
  });

  describe('shapes', () => {
    it('a rectangle runs corner to corner', () => {
      const { layer, onCommit, editor } = setup();

      editor.setState({ ...BASE, tool: 'rect' });
      drag(layer, [150, 100], [250, 150]);

      expect(lastCommit(onCommit)[0]).toMatchObject({ type: 'rect', x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4, size: MARKUP_SIZES.pen[1] });
    });

    it('Shift makes the rectangle square in pixels', () => {
      const { layer, onCommit, editor } = setup();

      editor.setState({ ...BASE, tool: 'rect' });
      drag(layer, [150, 100], [250, 130], { shiftKey: true });

      const r = lastCommit(onCommit)[0] as ImageMarkupShape;

      expect((r.x2 - r.x1) * O.w).toBeCloseTo((r.y2 - r.y1) * O.h, 3);
    });

    it('Alt draws the ellipse out from its centre', () => {
      const { layer, onCommit, editor } = setup();

      editor.setState({ ...BASE, tool: 'ellipse' });
      drag(layer, [350, 175], [400, 200], { altKey: true });

      expect(lastCommit(onCommit)[0]).toMatchObject({ x1: 0.4, y1: 0.4, x2: 0.6, y2: 0.6 });
    });

    it('Shift snaps an arrow to 15° steps', () => {
      const { layer, onCommit, editor } = setup();

      editor.setState({ ...BASE, tool: 'arrow' });
      drag(layer, [200, 100], [300, 104], { shiftKey: true });

      const a = lastCommit(onCommit)[0] as ImageMarkupShape;

      expect(a.y2).toBeCloseTo(a.y1, 4);
    });

    it('a click without a drag places a default-sized shape centred on the click', () => {
      const { layer, onCommit, editor } = setup();

      editor.setState({ ...BASE, tool: 'rect', fill: true });
      fire(layer, 'pointerdown', 350, 175);
      fire(layer, 'pointerup', 351, 175);

      const r = lastCommit(onCommit)[0] as ImageMarkupShape;

      expect((r.x1 + r.x2) / 2).toBeCloseTo(0.5, 2);
      expect((r.x2 - r.x1) * O.w).toBeCloseTo(100, 0);
      expect(r.fill).toBe(true);
    });

    it('a new shape pops in with a 2D transform that clears once it lands', () => {
      const { layer, plane, editor, advance } = setup();

      editor.setState({ ...BASE, tool: 'rect' });
      fire(layer, 'pointerdown', 350, 175);
      fire(layer, 'pointerup', 350, 175);
      const g = plane.querySelector('[data-markup-type="rect"]');

      advance(16);
      expect(g?.getAttribute('transform')).toMatch(/scale\(/);
      expect(g?.getAttribute('transform')).not.toMatch(/3d|perspective/);
      advance(1000);
      expect(g?.hasAttribute('transform')).toBe(false);
    });

    it('under reduced motion nothing pops', () => {
      vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q }));
      const { layer, plane, editor, advance } = setup();

      editor.setState({ ...BASE, tool: 'rect' });
      fire(layer, 'pointerdown', 350, 175);
      fire(layer, 'pointerup', 350, 175);
      advance(16);

      expect(plane.querySelector('[data-markup-type="rect"]')?.hasAttribute('transform')).toBe(false);
    });
  });

  describe('text', () => {
    it('a click with the text tool opens a labelled editor; typing and Escape commit one text mark', () => {
      const { layer, onCommit, editor } = setup();

      editor.setState({ ...BASE, tool: 'text', color: '#ffffff' });
      fire(layer, 'pointerdown', 350, 175);
      fire(layer, 'pointerup', 350, 175);
      const ta = textarea();

      expect(ta?.getAttribute('aria-label')).toBe('Text label');
      expect(ta?.placeholder).toBe('Type something');
      expect(ta).toHaveFocus();
      type('Hello\nthere');
      expect(editor.isEditingText()).toBe(true);
      key(document.body, 'Escape');

      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(lastCommit(onCommit)[0]).toMatchObject({
        type: 'text', text: 'Hello\nthere', x: 0.5, y: 0.5, size: MARKUP_SIZES.text[1], style: 'outline',
      });
      expect(textarea()).toBeNull();
      expect(editor.isEditingText()).toBe(false);
    });

    it('a new text left empty adds nothing and no history step', () => {
      const { layer, onCommit, editor } = setup();

      editor.setState({ ...BASE, tool: 'text' });
      fire(layer, 'pointerdown', 350, 175);
      fire(layer, 'pointerup', 350, 175);
      type('   ');
      key(document.body, 'Escape');

      expect(onCommit).not.toHaveBeenCalled();
    });

    it('a committed text stays selected and the stage gets focus back', () => {
      const { layer, stage, editor, onSelectionChange } = setup();

      editor.setState({ ...BASE, tool: 'text' });
      fire(layer, 'pointerdown', 350, 175);
      fire(layer, 'pointerup', 350, 175);
      type('Hi');
      key(document.body, 'Escape');

      expect(onSelectionChange).toHaveBeenLastCalledWith('text', expect.objectContaining({ text: 'Hi' }));
      expect(stage).toHaveFocus();
    });

    it('plain Enter types a newline and never leaves the editor', () => {
      const { layer, stage, editor } = setup();
      const onStage = vi.fn();

      stage.addEventListener('keydown', onStage);
      editor.setState({ ...BASE, tool: 'text' });
      fire(layer, 'pointerdown', 350, 175);
      fire(layer, 'pointerup', 350, 175);
      const ta = textarea();

      if (!ta) throw new Error('no editor');
      const e = key(ta, 'Enter');

      expect(e.defaultPrevented).toBe(false);
      expect(onStage).not.toHaveBeenCalled();
      expect(editor.isEditingText()).toBe(true);
    });

    it('Cmd+Enter commits', () => {
      const { layer, editor, onCommit } = setup();

      editor.setState({ ...BASE, tool: 'text' });
      fire(layer, 'pointerdown', 350, 175);
      fire(layer, 'pointerup', 350, 175);
      type('Done');
      const ta = textarea();

      if (!ta) throw new Error('no editor');
      key(ta, 'Enter', { metaKey: true });

      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(editor.isEditingText()).toBe(false);
    });

    it('a click away commits the text instead of placing another', () => {
      const { layer, editor, onCommit } = setup();

      editor.setState({ ...BASE, tool: 'text' });
      fire(layer, 'pointerdown', 350, 175);
      fire(layer, 'pointerup', 350, 175);
      type('One');
      fire(layer, 'pointerdown', 200, 100);
      fire(layer, 'pointerup', 200, 100);

      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(lastCommit(onCommit)).toHaveLength(1);
      expect(editor.isEditingText()).toBe(false);
    });

    it('flush() commits an open edit', () => {
      const { layer, editor, onCommit } = setup();

      editor.setState({ ...BASE, tool: 'text' });
      fire(layer, 'pointerdown', 350, 175);
      fire(layer, 'pointerup', 350, 175);
      type('Kept');
      editor.flush();

      expect(lastCommit(onCommit)[0]).toMatchObject({ text: 'Kept' });
    });

    it('the text tool on an existing text edits it, hiding its drawn copy meanwhile', () => {
      const { layer, plane, editor, onCommit } = setup({ markup: [text()] });

      editor.setState({ ...BASE, tool: 'text' });
      fire(layer, 'pointerdown', 350, 175);
      fire(layer, 'pointerup', 350, 175);

      expect(textarea()?.value).toBe('Hi');
      expect(plane.querySelector<SVGElement>('[data-markup-id="t1"]')?.style.visibility).toBe('hidden');
      type('Hey');
      editor.flush();

      expect(lastCommit(onCommit)).toStrictEqual([{ ...text(), text: 'Hey' }]);
      expect(plane.querySelector<SVGElement>('[data-markup-id="t1"]')?.style.visibility).toBe('');
    });

    it('editing an unselected text: one Escape commits and keeps it selected, the next deselects', () => {
      const { layer, editor, stage } = setup({ markup: [text()] });

      editor.setState({ ...BASE, tool: 'text' });
      fire(layer, 'pointerdown', 350, 175);
      fire(layer, 'pointerup', 350, 175);
      type('Hey');
      key(document.body, 'Escape');
      expect(editor.isEditingText()).toBe(false);
      expect(stage.querySelector('[data-role="markup-selection"]')).not.toBeNull();
      key(document.body, 'Escape');

      expect(stage.querySelector('[data-role="markup-selection"]')).toBeNull();
    });

    it('a double-click with a drawing tool leaves no stray marks and opens no editor', () => {
      const { layer, editor, onCommit } = setup({ markup: [text()] });

      editor.setState({ ...BASE, tool: 'eraser' });
      layer.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 350, clientY: 175 }));

      expect(textarea()).toBeNull();
      expect(onCommit).not.toHaveBeenCalled();
    });

    it('clearing an existing text removes it in one step', () => {
      const { layer, editor, onCommit } = setup({ markup: [text()] });

      editor.setState({ ...BASE, tool: 'text' });
      fire(layer, 'pointerdown', 350, 175);
      fire(layer, 'pointerup', 350, 175);
      type('');
      editor.flush();

      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(lastCommit(onCommit)).toStrictEqual([]);
    });

    it('a double-click on a text with the select tool edits it', () => {
      const { layer, editor } = setup({ markup: [text()] });

      editor.setState({ ...BASE, tool: 'select' });
      fire(layer, 'pointerdown', 350, 175);
      fire(layer, 'pointerup', 350, 175);
      layer.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 350, clientY: 175 }));

      expect(textarea()?.value).toBe('Hi');
    });

    it('the selection box steps aside while its text is edited and comes back after', () => {
      const { layer, stage, editor } = setup({ markup: [text()] });

      editor.setState({ ...BASE, tool: 'select' });
      fire(layer, 'pointerdown', 350, 175);
      fire(layer, 'pointerup', 350, 175);
      key(stage, 'Enter');
      expect(stage.querySelector<HTMLElement>('[data-role="markup-selection"]')?.hidden).toBe(true);
      key(document.body, 'Escape');

      expect(stage.querySelector<HTMLElement>('[data-role="markup-selection"]')?.hidden).toBe(false);
    });

    it('Enter on a selected text edits it and does not bubble to the dialog', () => {
      const { layer, stage, editor } = setup({ markup: [text()] });
      const onBody = vi.fn();

      document.body.addEventListener('keydown', onBody);
      editor.setState({ ...BASE, tool: 'select' });
      fire(layer, 'pointerdown', 350, 175);
      fire(layer, 'pointerup', 350, 175);
      key(stage, 'Enter');

      expect(textarea()?.value).toBe('Hi');
      expect(onBody).not.toHaveBeenCalled();
      document.body.removeEventListener('keydown', onBody);
    });

    it('the editor matches the mark: font size at stage scale, colour and centre', () => {
      const { layer, editor } = setup({ markup: [text({ color: '#ff3b30', style: undefined })] });

      editor.setState({ ...BASE, tool: 'text' });
      fire(layer, 'pointerdown', 350, 175);
      fire(layer, 'pointerup', 350, 175);
      const ta = textarea();

      // 0.06 × 500 px short side × 0.5 scale.
      expect(ta?.style.fontSize).toBe('15px');
      expect(ta?.style.color).toBe('rgb(255, 59, 48)');
      expect(ta?.style.left).toBe('350px');
      expect(ta?.style.top).toBe('175px');
    });
  });

  describe('select', () => {
    it('a click picks the top-most mark and shows its box', () => {
      const { layer, editor, onSelectionChange, stage } = setup({ markup: [rect()] });

      editor.setState({ ...BASE, tool: 'select' });
      // The rect's left edge: O x 200 → screen 200.
      fire(layer, 'pointerdown', 200, 150);
      fire(layer, 'pointerup', 200, 150);

      expect(onSelectionChange).toHaveBeenLastCalledWith('rect', expect.objectContaining({ id: 'r1' }));
      expect(stage.querySelectorAll('[data-markup-handle]')).toHaveLength(8);
    });

    it('a click on empty space deselects', () => {
      const { layer, editor, onSelectionChange, stage } = setup({ markup: [rect()] });

      editor.setState({ ...BASE, tool: 'select' });
      fire(layer, 'pointerdown', 200, 150);
      fire(layer, 'pointerup', 200, 150);
      fire(layer, 'pointerdown', 550, 280);
      fire(layer, 'pointerup', 550, 280);

      expect(onSelectionChange).toHaveBeenLastCalledWith(null, null);
      expect(stage.querySelectorAll('[data-markup-handle]')).toHaveLength(0);
    });

    it('a drag moves the mark in one step', () => {
      const { layer, editor, onCommit } = setup({ markup: [rect()] });

      editor.setState({ ...BASE, tool: 'select' });
      drag(layer, [200, 150], [250, 175]);

      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(lastCommit(onCommit)[0]).toMatchObject({ x1: 0.3, y1: 0.3, x2: 0.5, y2: 0.7 });
    });

    it('the se handle resizes the mark', () => {
      const { layer, editor, onCommit, stage } = setup({ markup: [rect({ size: 0.0001 })] });

      editor.setState({ ...BASE, tool: 'select' });
      fire(layer, 'pointerdown', 200, 150);
      fire(layer, 'pointerup', 200, 150);
      const se = stage.querySelector('[data-markup-handle="se"]');

      if (!se) throw new Error('no handle');
      // Box right/bottom: O 400, 300 → screen 300, 200.
      drag(se, [300, 200], [350, 225]);

      const r = lastCommit(onCommit)[0] as ImageMarkupShape;

      expect(r.x1).toBeCloseTo(0.2, 3);
      expect(r.x2).toBeCloseTo(0.5, 3);
      expect(r.y2).toBeCloseTo(0.7, 3);
    });

    it('Delete removes the selection in one step', () => {
      const { layer, editor, onCommit, stage } = setup({ markup: [rect(), text()] });

      editor.setState({ ...BASE, tool: 'select' });
      fire(layer, 'pointerdown', 200, 150);
      fire(layer, 'pointerup', 200, 150);
      key(stage, 'Delete');

      expect(lastCommit(onCommit)).toStrictEqual([text()]);
    });

    it('Escape deselects as one layer, and the next Escape goes on', () => {
      const { layer, editor, onSelectionChange } = setup({ markup: [rect()] });
      const below = vi.fn();

      document.addEventListener('keydown', below);
      editor.setState({ ...BASE, tool: 'select' });
      fire(layer, 'pointerdown', 200, 150);
      fire(layer, 'pointerup', 200, 150);
      key(document.body, 'Escape');
      expect(onSelectionChange).toHaveBeenLastCalledWith(null, null);
      expect(below).not.toHaveBeenCalled();
      key(document.body, 'Escape');

      expect(below).toHaveBeenCalledTimes(1);
      document.removeEventListener('keydown', below);
    });

    it('arrow keys nudge one screen pixel and commit once after a pause', () => {
      vi.useFakeTimers();
      const { layer, editor, onCommit, stage } = setup({ markup: [rect()] });

      editor.setState({ ...BASE, tool: 'select' });
      fire(layer, 'pointerdown', 200, 150);
      fire(layer, 'pointerup', 200, 150);
      key(stage, 'ArrowRight');
      key(stage, 'ArrowRight', { shiftKey: true });
      expect(onCommit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(400);

      expect(onCommit).toHaveBeenCalledTimes(1);
      // 11 screen px at scale 0.5 = 22 O px = 0.022.
      expect((lastCommit(onCommit)[0] as ImageMarkupShape).x1).toBeCloseTo(0.222, 4);
      vi.useRealTimers();
    });

    it('a panel colour change restyles the selection in one step', () => {
      const { layer, editor, onCommit } = setup({ markup: [rect()] });

      editor.setState({ ...BASE, tool: 'select', color: '#0a84ff' });
      fire(layer, 'pointerdown', 200, 150);
      fire(layer, 'pointerup', 200, 150);
      editor.setState({ ...BASE, tool: 'select', color: '#34c759' });

      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(lastCommit(onCommit)[0]).toMatchObject({ id: 'r1', color: '#34c759' });
    });

    it('deleteSelection() and deselect() act on the current selection', () => {
      const { layer, editor, onCommit } = setup({ markup: [rect()] });

      editor.setState({ ...BASE, tool: 'select' });
      expect(editor.deselect()).toBe(false);
      fire(layer, 'pointerdown', 200, 150);
      fire(layer, 'pointerup', 200, 150);
      editor.deleteSelection();

      expect(lastCommit(onCommit)).toStrictEqual([]);
    });

    it('set() drops a selection whose mark is gone', () => {
      const { layer, editor, onSelectionChange } = setup({ markup: [rect()] });

      editor.setState({ ...BASE, tool: 'select' });
      fire(layer, 'pointerdown', 200, 150);
      fire(layer, 'pointerup', 200, 150);
      editor.set([]);

      expect(onSelectionChange).toHaveBeenLastCalledWith(null, null);
    });
  });

  describe('eraser', () => {
    it('a drag over a mark removes it in one step, after a fade', () => {
      const { layer, editor, onCommit, plane, advance } = setup({ markup: [rect(), text({ x: 0.9, y: 0.9 })] });

      editor.setState({ ...BASE, tool: 'eraser' });
      fire(layer, 'pointerdown', 190, 120);
      fire(layer, 'pointermove', 210, 150);
      advance(32);
      expect(Number(plane.querySelector<SVGElement>('[data-markup-id="r1"]')?.style.opacity)).toBeLessThan(1);
      fire(layer, 'pointerup', 210, 150);

      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(lastCommit(onCommit).map((m) => m.id)).toStrictEqual(['t1']);
    });

    it('a drag over nothing commits nothing', () => {
      const { layer, editor, onCommit } = setup({ markup: [rect()] });

      editor.setState({ ...BASE, tool: 'eraser' });
      drag(layer, [500, 250], [520, 260]);

      expect(onCommit).not.toHaveBeenCalled();
    });
  });

  describe('keyboard', () => {
    it.each([
      ['v', 'select'], ['p', 'pen'], ['h', 'highlighter'], ['t', 'text'], ['r', 'rect'],
      ['o', 'ellipse'], ['a', 'arrow'], ['l', 'line'], ['e', 'eraser'],
    ])('%s on the stage picks %s', (k, tool) => {
      const { stage, onStateChange } = setup({ state: { ...BASE, tool: tool === 'select' ? 'pen' : 'select' } });

      key(stage, k);

      expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ tool }));
    });

    it('letters with a modifier are not tool keys', () => {
      const { stage, onStateChange } = setup();

      key(stage, 'p', { metaKey: true });

      expect(onStateChange).not.toHaveBeenCalled();
    });

    it('inactive, the stage keys do nothing', () => {
      const { stage, editor, onStateChange } = setup();

      editor.setActive(false);
      key(stage, 'p');

      expect(onStateChange).not.toHaveBeenCalled();
    });
  });

  it('destroy() leaves no Escape layer behind and never commits', () => {
    const { layer, editor, onCommit } = setup({ markup: [rect()] });
    const below = vi.fn();

    editor.setState({ ...BASE, tool: 'text' });
    fire(layer, 'pointerdown', 450, 200);
    fire(layer, 'pointerup', 450, 200);
    type('Lost');
    editor.destroy();
    document.addEventListener('keydown', below);
    key(document.body, 'Escape');

    expect(below).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
    document.removeEventListener('keydown', below);
  });
});
