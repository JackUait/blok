import type { ImageMarkup, ImageMarkupShape, ImageMarkupStroke, ImageMarkupText } from '../../../../types/tools/image';
import { registerLayer } from '../../../components/utils/dismissable-layer';
import { prefersReducedMotion, type SpringClock } from '../../../components/utils/spring';
import type { I18nInstance } from '../../../components/utils/tools';
import { tr } from '../i18n';
import {
  commitMarkupItem, contrastInk, eraseMarkup, HIGHLIGHTER_SCALE, hitTest, isClosedShape, takesFill, MARKUP_SIZES, markupBounds, moveMarkup, newMarkupId,
  resizeMarkup, TEXT_LINE_HEIGHT, textBoxSize,
} from '../markup/model';
import { smoothStroke, strokeOutline } from '../markup/freehand';
import { createMarkupLayer, HIGHLIGHTER_PASSES, updateMarkupLayer } from '../markup/render';
import type { Box, Point, Size } from './camera';
import type { MarkupPanelState, MarkupSelectionKind, MarkupSizeIndex, MarkupTool } from './markup-panel';

export interface MarkupEditorOptions {
  /** The darkroom stage; the interaction layer mounts here, above the frame. */
  stage: HTMLElement;
  /** The camera plane (the O box); the drawn layer mounts inside it. */
  plane: HTMLElement;
  /** O in px. */
  getSize(): Size;
  i18n?: I18nInstance;
  markup: ImageMarkup[];
  state: MarkupPanelState;
  /** Every finished edit, as the whole new list. One history step each. */
  onCommit(next: ImageMarkup[]): void;
  onSelectionChange(kind: MarkupSelectionKind, item: ImageMarkup | null): void;
  /** The stage asked for another panel state (a tool key). */
  onStateChange?(next: MarkupPanelState): void;
  clock?: SpringClock;
}

export interface MarkupEditor {
  setActive(on: boolean): void;
  /** New data from outside (undo, reset, a turn). */
  set(markup: ImageMarkup[]): void;
  setState(s: MarkupPanelState): void;
  deleteSelection(): void;
  /** False when nothing was selected. */
  deselect(): boolean;
  isEditingText(): boolean;
  /** Commits an open text edit and a pending nudge. */
  flush(): void;
  /** The camera or the O size changed. */
  refresh(): void;
  destroy(): void;
}

type HandleName = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';

const HANDLES: HandleName[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const TEXT_HANDLES: HandleName[] = ['nw', 'ne', 'se', 'sw', 'rotate'];
const TOOL_KEYS: Record<string, MarkupTool> = {
  v: 'select', p: 'pen', h: 'highlighter', t: 'text', r: 'rect', o: 'ellipse', a: 'arrow', l: 'line', e: 'eraser',
};
const NUDGES: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
};

/** Below this many screen px a press is a click, not a drag. */
const SLOP_PX = 4;
/** Hit reach around a mark, in screen px. */
const HIT_PX = 8;
/** Eraser radius per size, in screen px. markup-editor.css draws a cursor ring of each. */
export const ERASER_PX: Readonly<Record<MarkupSizeIndex, number>> = { 0: 4, 1: 8, 2: 16 };
const NUDGE_BIG = 10;
const KEY_IDLE_MS = 250;
/** A click-placed shape spans this share of the short side. */
const DEFAULT_SHAPE = 0.2;
const SNAP_DEG = 15;
const POP_MS = 260;
/** Live ink freezes in chunks of this many points; only the tail is outlined again each frame. */
const LIVE_CHUNK = 48;
/** Points a frozen chunk shares with the next, so the joins stay smooth. */
const LIVE_OVERLAP = 3;
/** The live ink crossfades into the committed, tapered stroke. */
const HANDOVER_MS = 90;
const ERASE_MS = 160;
/** A shape placed by a click pops from small; a mark the user watched being drawn only settles. */
const POP_FROM_CLICK = 0.4;
const POP_FROM_DRAWN = 0.94;
const ERASE_TO = 0.6;
const MIN_TEXT = 0.01;
const MAX_TEXT = 0.5;
/** render.ts draws the outline this many font sizes wide, and the background box with this padding. */
const OUTLINE_WIDTH = 0.16;
const BG_PAD_X = 0.08;
const BG_PAD_Y = 0.2;
const FONT_FAMILY = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const SHAPES = new Set<MarkupTool>(['rect', 'rounded-rect', 'ellipse', 'arrow', 'line', 'bubble', 'star', 'polygon', 'spotlight', 'magnifier']);

const rafClock: SpringClock = {
  now: () => performance.now(),
  request: (cb) => requestAnimationFrame(() => cb()),
  cancel: (id) => cancelAnimationFrame(id),
};

const isText = (m: ImageMarkup): m is ImageMarkupText => m.type === 'text';
const isBoxShape = (m: ImageMarkup): boolean => takesFill(m.type);

const easeOutBack = (t: number): number => {
  const c1 = 1.70158;

  return 1 + (c1 + 1) * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};

const nearestIndex = (list: readonly number[], v: number): MarkupSizeIndex => {
  const best = list.reduce((b, s, i) => (Math.abs(s - v) < Math.abs((list[b] ?? 0) - v) ? i : b), 0);

  return best === 0 || best === 1 || best === 2 ? best : 1;
};

/** The panel state that shows a mark's own colour, width, style and fill. */
export function stateForMark(state: MarkupPanelState, item: ImageMarkup): MarkupPanelState {
  const next: MarkupPanelState = { ...state, color: item.color };

  if (isText(item)) {
    return { ...next, size: nearestIndex(MARKUP_SIZES.text, item.size), textStyle: item.style ?? 'plain' };
  }
  const scale = item.type === 'highlighter' ? HIGHLIGHTER_SCALE : 1;

  next.size = nearestIndex(MARKUP_SIZES.pen, item.size / scale);
  if (isBoxShape(item)) next.fill = (item as ImageMarkupShape).fill === true;

  return next;
}

const sizeFor = (tool: MarkupTool | ImageMarkup['type'], index: MarkupSizeIndex): number => {
  if (tool === 'text') return MARKUP_SIZES.text[index];

  return MARKUP_SIZES.pen[index] * (tool === 'highlighter' ? HIGHLIGHTER_SCALE : 1);
};

/** Applies one changed panel field to a mark, or returns it as is. */
const restyle = (item: ImageMarkup, key: keyof MarkupPanelState, s: MarkupPanelState): ImageMarkup => {
  if (key === 'color') return { ...item, color: s.color };
  if (key === 'size') return { ...item, size: sizeFor(item.type, s.size) };
  if (key === 'textStyle' && isText(item)) {
    const { style: _drop, ...rest } = item;

    return s.textStyle === 'plain' ? rest : { ...rest, style: s.textStyle };
  }
  if (key === 'fill' && isBoxShape(item)) {
    const { fill: _drop, ...rest } = item as ImageMarkupShape;

    return s.fill ? { ...rest, fill: true } : rest;
  }

  return item;
};

interface Mapping { left: number; top: number; scale: number }

type Gesture =
  | { kind: 'stroke'; id: number; pen: boolean; touch: boolean; item: ImageMarkupStroke }
  | { kind: 'shape'; id: number; touch: boolean; type: ImageMarkupShape['type']; markId: string; from: Point; to: Point; screen: Point; moved: boolean }
  | { kind: 'move'; id: number; touch: boolean; item: ImageMarkup; from: Point; screen: Point; moved: boolean }
  | { kind: 'resize'; id: number; touch: boolean; item: ImageMarkup; handle: HandleName; box: Box; from: Point }
  | { kind: 'text-scale'; id: number; touch: boolean; item: ImageMarkupText; dist: number }
  | { kind: 'rotate'; id: number; touch: boolean; item: ImageMarkupText; angle: number }
  | { kind: 'erase'; id: number; touch: boolean; last: Point; list: ImageMarkup[]; faded: Set<string> }
  | { kind: 'text'; id: number; touch: boolean; at: Point; target: ImageMarkupText | null }
  | { kind: 'idle'; id: number; touch: boolean };

interface TextEdit { item: ImageMarkupText; isNew: boolean; el: HTMLTextAreaElement; unregister: () => void; closing: boolean }

const SVG_NS = 'http://www.w3.org/2000/svg';

export function createMarkupEditor(opts: MarkupEditorOptions): MarkupEditor {
  const clock = opts.clock ?? rafClock;
  const st = {
    markup: opts.markup,
    state: { ...opts.state },
    active: false,
    destroyed: false,
    selected: null as string | null,
    /** Shown instead of `markup` while a gesture previews a change. */
    preview: null as ImageMarkup[] | null,
    gesture: null as Gesture | null,
    /** Pointers down on the layer; a second touch cancels, a pen silences touch. */
    pointers: new Map<number, string>(),
    /** Set after a cancel: nothing draws until every pointer lifts. */
    dead: false,
    map: { left: 0, top: 0, scale: 1 },
    frame: 0,
    size: '',
    keyIdle: 0,
    nudged: null as ImageMarkup | null,
  };
  const anims = new Map<string, () => void>();
  const edit: { current: TextEdit | null } = { current: null };
  const selection: { el: HTMLElement | null; unregister: (() => void) | null } = { el: null, unregister: null };

  const svg = createMarkupLayer([], null);
  // Erased marks fade here: the main layer drops any node that is not a current mark.
  const ghosts = document.createElementNS(SVG_NS, 'svg');

  ghosts.setAttribute('data-role', 'markup-ghosts');
  ghosts.setAttribute('aria-hidden', 'true');
  ghosts.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none');
  // Live ink: the main layer would redraw a growing stroke in full every frame.
  const live = document.createElementNS(SVG_NS, 'svg');

  live.setAttribute('data-role', 'markup-live');
  live.setAttribute('aria-hidden', 'true');
  live.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none');
  opts.plane.append(svg, live, ghosts);
  const ink: { group: SVGGElement | null; tail: SVGPathElement | null; twins: SVGPathElement[]; frozen: number } = { group: null, tail: null, twins: [], frozen: 0 };

  const layer = document.createElement('div');

  layer.className = 'blok-markup-layer';
  layer.setAttribute('data-role', 'markup-layer');
  layer.hidden = true;
  opts.stage.appendChild(layer);

  const o = (): Size => opts.getSize();
  const shortSide = (): number => Math.min(o().w, o().h);
  const shown = (): ImageMarkup[] => st.preview ?? st.markup;
  const find = (id: string | null, list = shown()): ImageMarkup | null => (id === null ? null : list.find((m) => m.id === id) ?? null);
  const nodeOf = (id: string): SVGGElement | null => svg.querySelector<SVGGElement>(`[data-markup-id="${CSS.escape(id)}"]`);

  const measure = (): Mapping => {
    const r = opts.plane.getBoundingClientRect();
    const w = o().w;

    return { left: r.left, top: r.top, scale: w > 0 && r.width > 0 ? r.width / w : 1 };
  };
  const toO = (x: number, y: number, m = st.map): Point => ({ x: (x - m.left) / m.scale, y: (y - m.top) / m.scale });
  /** O px to layer px. */
  const toLayer = (p: Point): Point => {
    const m = measure();
    const r = layer.getBoundingClientRect();

    return { x: m.left + p.x * m.scale - r.left, y: m.top + p.y * m.scale - r.top };
  };

  const draw = (): void => {
    const size = o();

    st.size = `${size.w}x${size.h}`;
    ghosts.setAttribute('viewBox', `0 0 ${size.w} ${size.h}`);
    live.setAttribute('viewBox', `0 0 ${size.w} ${size.h}`);
    updateMarkupLayer(svg, shown(), size);
    // A redrawn node loses the inline hide; the text under the editor must stay hidden.
    if (edit.current) nodeOf(edit.current.item.id)?.style.setProperty('visibility', 'hidden');
  };

  const strokePx = (item: ImageMarkupStroke, from: number, to: number): number[] => {
    const size = o();

    return item.points.slice(from * 3, to * 3).map((v, i) => {
      const axis = i % 3;

      if (axis === 0) return v * size.w;

      return axis === 1 ? v * size.h : v;
    });
  };

  /** Centreline through x, y, p triples, curved through the midpoints. */
  const centreline = (pts: number[]): string => {
    const n = Math.floor(pts.length / 3);
    const at = (i: number): Point => ({ x: pts[i * 3] ?? 0, y: pts[i * 3 + 1] ?? 0 });
    const curves = Array.from({ length: Math.max(0, n - 2) }, (_, k) => {
      const p = at(k + 1);
      const q = at(k + 2);

      return `Q${p.x} ${p.y} ${(p.x + q.x) / 2} ${(p.y + q.y) / 2}`;
    });
    const last = at(n - 1);

    return `M${at(0).x} ${at(0).y}${curves.join('')}L${last.x} ${last.y}`;
  };

  const inkPath = (): SVGPathElement => document.createElementNS(SVG_NS, 'path');

  const drawInk = (item: ImageMarkupStroke): void => {
    const width = item.size * shortSide();
    const n = item.points.length / 3;

    if (!ink.group) {
      ink.group = document.createElementNS(SVG_NS, 'g');
      ink.tail = inkPath();
      ink.group.appendChild(ink.tail);
      live.appendChild(ink.group);
      if (item.type === 'pen') ink.group.setAttribute('fill', item.color);
      else {
        // One path per blend pass; the first is the tail, the rest follow its d.
        const passes = HIGHLIGHTER_PASSES.map((pass, i) => {
          const path = i === 0 ? ink.tail ?? inkPath() : inkPath();

          path.setAttribute('fill', 'none');
          path.setAttribute('stroke', item.color);
          path.setAttribute('stroke-width', String(width));
          path.setAttribute('stroke-linecap', 'round');
          path.setAttribute('stroke-linejoin', 'round');
          path.setAttribute('opacity', pass.opacity);
          path.style.mixBlendMode = pass.blend;

          return path;
        });

        ink.twins = passes.slice(1);
        ink.group.append(...ink.twins);
      }
    }
    const { group, tail } = ink;

    if (!tail) return;
    if (item.type === 'highlighter') {
      // A flat stroke: one cheap path. Chunks would darken where they overlap.
      const d = centreline(strokePx(item, 0, n));

      tail.setAttribute('d', d);
      ink.twins.forEach((twin) => twin.setAttribute('d', d));

      return;
    }
    // Untapered while live; the committed stroke tapers.
    while (n - ink.frozen > LIVE_CHUNK) {
      const end = ink.frozen + LIVE_CHUNK;
      const chunk = inkPath();

      chunk.setAttribute('d', strokeOutline(smoothStroke(strokePx(item, ink.frozen, end + 1)), width, { taper: false }));
      group.insertBefore(chunk, tail);
      ink.frozen = end - LIVE_OVERLAP;
    }
    tail.setAttribute('d', strokeOutline(smoothStroke(strokePx(item, ink.frozen, n)), width, { taper: false }));
  };

  const releaseInk = (): SVGGElement | null => {
    const group = ink.group;

    ink.group = null;
    ink.tail = null;
    ink.twins = [];
    ink.frozen = 0;

    return group;
  };

  const scheduleDraw = (): void => {
    if (st.frame !== 0) return;
    st.frame = clock.request(() => {
      st.frame = 0;
      const g = st.gesture;

      if (g?.kind === 'stroke') drawInk(g.item);
      else draw();
    });
  };

  const cancelFrame = (): void => {
    if (st.frame === 0) return;
    clock.cancel(st.frame);
    st.frame = 0;
  };

  const animate = (id: string, ms: number, step: (t: number) => void, done: () => void): void => {
    anims.get(id)?.();
    const start = clock.now();
    const run = { frame: 0 };
    const tick = (): void => {
      const t = Math.min(1, (clock.now() - start) / ms);

      step(t);
      if (t < 1) {
        run.frame = clock.request(tick);

        return;
      }
      anims.delete(id);
      done();
    };

    run.frame = clock.request(tick);
    anims.set(id, () => clock.cancel(run.frame));
  };

  /** Scales a mark about its box centre. 2D only: a 3D transform rasterises SVG. */
  const scaleAbout = (node: Element, item: ImageMarkup, s: number): void => {
    const b = markupBounds(item, o());
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;

    node.setAttribute('transform', `translate(${cx} ${cy}) scale(${s}) translate(${-cx} ${-cy})`);
  };

  const pop = (item: ImageMarkup, from: number): void => {
    if (prefersReducedMotion()) return;
    animate(item.id, POP_MS, (t) => {
      const node = nodeOf(item.id);

      if (node) scaleAbout(node, item, from + (1 - from) * easeOutBack(t));
    }, () => nodeOf(item.id)?.removeAttribute('transform'));
  };

  const handOver = (item: ImageMarkup): void => {
    const group = releaseInk();

    if (!group) return;
    if (prefersReducedMotion()) {
      group.remove();

      return;
    }
    nodeOf(item.id)?.style.setProperty('opacity', '0');
    animate(`ink:${item.id}`, HANDOVER_MS, (t) => {
      group.style.opacity = String(1 - t);
      nodeOf(item.id)?.style.setProperty('opacity', String(t));
    }, () => {
      group.remove();
      nodeOf(item.id)?.style.removeProperty('opacity');
    });
  };

  const fadeOut = (item: ImageMarkup): void => {
    const node = nodeOf(item.id);

    if (!node) return;
    ghosts.appendChild(node);
    if (prefersReducedMotion()) {
      node.remove();

      return;
    }
    animate(`erase:${item.id}`, ERASE_MS, (t) => {
      const k = t * t;

      node.style.opacity = String(1 - k);
      scaleAbout(node, item, 1 - (1 - ERASE_TO) * k);
    }, () => node.remove());
  };

  /* ---------- selection ---------- */

  const announceSelection = (): void => {
    const item = find(st.selected, st.markup);

    if (item) st.state = stateForMark(st.state, item);
    opts.onSelectionChange(item ? item.type : null, item);
  };

  const placeSelection = (): void => {
    const el = selection.el;
    const item = find(st.selected);

    if (!el || !item) return;
    const scale = measure().scale;

    if (isText(item)) {
      const box = textBoxSize(item, o());
      const c = toLayer({ x: item.x * o().w, y: item.y * o().h });

      el.style.left = `${c.x}px`;
      el.style.top = `${c.y}px`;
      el.style.width = `${box.w * scale}px`;
      el.style.height = `${box.h * scale}px`;
      el.style.transform = `translate(-50%, -50%) rotate(${item.rotation ?? 0}deg)`;

      return;
    }
    const b = markupBounds(item, o());
    const a = toLayer({ x: b.x, y: b.y });

    el.style.left = `${a.x}px`;
    el.style.top = `${a.y}px`;
    el.style.width = `${b.w * scale}px`;
    el.style.height = `${b.h * scale}px`;
    el.style.transform = '';
  };

  const buildSelection = (item: ImageMarkup): void => {
    selection.el?.remove();
    const el = document.createElement('div');

    el.className = 'blok-markup-selection';
    el.setAttribute('data-role', 'markup-selection');
    el.setAttribute('data-kind', item.type);
    for (const h of isText(item) ? TEXT_HANDLES : HANDLES) {
      const handle = document.createElement('span');

      handle.className = 'blok-markup-selection__handle';
      handle.setAttribute('data-markup-handle', h);
      el.appendChild(handle);
    }
    layer.appendChild(el);
    selection.el = el;
    placeSelection();
  };

  const clearSelection = (): void => {
    selection.el?.remove();
    selection.el = null;
    selection.unregister?.();
    selection.unregister = null;
    st.selected = null;
  };

  const select = (id: string | null): void => {
    if (id === st.selected) return;
    flushNudge();
    clearSelection();
    const item = find(id, st.markup);

    if (item) {
      st.selected = item.id;
      buildSelection(item);
      // Its own Escape layer: one Escape clears the selection, the next reaches the dialog.
      selection.unregister = registerLayer({ element: layer, outside: false, onDismiss: () => select(null) });
    }
    announceSelection();
  };

  /* ---------- commits ---------- */

  /** Follows the selected mark through new data; drops the selection when the mark is gone. */
  const syncSelection = (): void => {
    if (st.selected === null) return;
    const item = find(st.selected);

    if (!item) {
      clearSelection();
      announceSelection();

      return;
    }
    if (selection.el?.getAttribute('data-kind') !== item.type) buildSelection(item);
    placeSelection();
  };

  const commit = (next: ImageMarkup[]): void => {
    st.markup = next;
    st.preview = null;
    cancelFrame();
    draw();
    syncSelection();
    opts.onCommit(next);
  };

  const replace = (item: ImageMarkup): ImageMarkup[] => st.markup.map((m) => (m.id === item.id ? item : m));

  const flushNudge = (): void => {
    if (st.keyIdle === 0) return;
    window.clearTimeout(st.keyIdle);
    st.keyIdle = 0;
    const item = st.nudged;

    st.nudged = null;
    if (item) commit(replace(commitMarkupItem(item)));
  };

  /* ---------- text editor ---------- */

  const styleEditor = (t: TextEdit): void => {
    const { item, el } = t;
    const scale = measure().scale;
    const font = item.size * shortSide() * scale;
    const c = toLayer({ x: item.x * o().w, y: item.y * o().h });
    const lines = el.value === '' ? [el.placeholder] : el.value.split('\n');
    const box = textBoxSize({ ...item, text: lines.join('\n') }, o());
    const bg = item.style === 'background';
    const padX = bg ? box.w * BG_PAD_X * scale : 0;
    const padY = bg ? box.h * BG_PAD_Y * scale : 0;

    el.style.left = `${c.x}px`;
    el.style.top = `${c.y}px`;
    el.style.fontSize = `${font}px`;
    el.style.lineHeight = String(TEXT_LINE_HEIGHT);
    el.style.fontFamily = FONT_FAMILY;
    el.style.color = bg ? contrastInk(item.color) : item.color;
    el.style.caretColor = bg ? contrastInk(item.color) : item.color;
    el.style.backgroundColor = bg ? item.color : 'transparent';
    el.style.padding = `${padY}px ${padX}px`;
    el.style.setProperty('-webkit-text-stroke', item.style === 'outline' ? `${font * OUTLINE_WIDTH}px ${contrastInk(item.color)}` : '');
    el.style.transform = `translate(-50%, -50%) rotate(${item.rotation ?? 0}deg)`;
    el.rows = Math.max(1, lines.length);
    // content-box: the padding is outside these.
    el.style.height = `${lines.length * TEXT_LINE_HEIGHT * font}px`;
    el.style.width = `${box.w * scale + 2}px`;
    // The estimate is a guess at glyph widths; the real content may be wider.
    if (el.scrollWidth > el.clientWidth && el.clientWidth > 0) el.style.width = `${el.scrollWidth + 2}px`;
  };

  const closeEditor = (keep: boolean): void => {
    const t = edit.current;

    if (!t || t.closing) return;
    t.closing = true;
    edit.current = null;
    t.unregister();
    if (selection.el) selection.el.hidden = false;
    const value = t.el.value;
    const hadFocus = document.activeElement === t.el;

    t.el.remove();
    nodeOf(t.item.id)?.style.removeProperty('visibility');
    if (hadFocus && !st.destroyed) opts.stage.focus({ preventScroll: true });
    if (!keep || st.destroyed) return;

    const empty = value.trim() === '';

    if (t.isNew) {
      if (empty) return;
      const item = commitMarkupItem({ ...t.item, text: value });

      commit([...st.markup, item]);
      select(item.id);

      return;
    }
    if (empty) {
      if (st.selected === t.item.id) clearSelection();
      commit(st.markup.filter((m) => m.id !== t.item.id));
      announceSelection();

      return;
    }
    if (value !== t.item.text) commit(replace(commitMarkupItem({ ...t.item, text: value })));
    else draw();
  };

  const openEditor = (item: ImageMarkupText, isNew: boolean): void => {
    flushNudge();
    // Before the editor's own layer: the stack peels the last one registered first.
    if (!isNew && st.selected !== item.id) select(item.id);
    const el = document.createElement('textarea');

    el.className = 'blok-markup-text-editor';
    el.setAttribute('data-role', 'markup-text-editor');
    el.setAttribute('aria-label', tr(opts.i18n, 'tools.image.markupTextEditorLabel'));
    el.placeholder = tr(opts.i18n, 'tools.image.markupTextPlaceholder');
    el.spellcheck = false;
    el.setAttribute('autocomplete', 'off');
    el.value = item.text;
    const t: TextEdit = {
      item, isNew, el, closing: false,
      // Escape commits: the typed text is the user's, Escape only ends the typing.
      unregister: registerLayer({ element: el, outside: false, onDismiss: () => closeEditor(true) }),
    };

    edit.current = t;
    el.addEventListener('input', () => styleEditor(t));
    el.addEventListener('blur', () => closeEditor(true));
    el.addEventListener('keydown', (e) => {
      // The darkroom's Enter-applies and Cmd+Z live on ancestors; typing must never reach them.
      if (e.key !== 'Tab') e.stopPropagation();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        closeEditor(true);
      }
    });
    layer.appendChild(el);
    // Its handles would sit on the text and take the clicks meant for the caret.
    if (selection.el) selection.el.hidden = true;
    nodeOf(item.id)?.style.setProperty('visibility', 'hidden');
    styleEditor(t);
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  };

  const newText = (at: Point): ImageMarkupText => {
    const item: ImageMarkupText = {
      id: newMarkupId(), type: 'text', color: st.state.color,
      x: at.x / o().w, y: at.y / o().h, text: '', size: sizeFor('text', st.state.size),
    };

    if (st.state.textStyle !== 'plain') item.style = st.state.textStyle;

    return item;
  };

  /* ---------- gestures ---------- */

  const tolerance = (): number => HIT_PX / st.map.scale;
  const eraserRadius = (): number => ERASER_PX[st.state.size] / st.map.scale;

  const shapeEnds = (type: ImageMarkupShape['type'], a: Point, b: Point, e: MouseEvent): [Point, Point] => {
    const raw = { x: b.x - a.x, y: b.y - a.y };
    const box = isClosedShape(type);
    const d = ((): Point => {
      // A lens is always round.
      if (!e.shiftKey && type !== 'magnifier') return raw;
      if (box) {
        const m = Math.max(Math.abs(raw.x), Math.abs(raw.y));

        return { x: (raw.x < 0 ? -1 : 1) * m, y: (raw.y < 0 ? -1 : 1) * m };
      }
      const len = Math.hypot(raw.x, raw.y);
      const step = (SNAP_DEG * Math.PI) / 180;
      const ang = Math.round(Math.atan2(raw.y, raw.x) / step) * step;

      return { x: len * Math.cos(ang), y: len * Math.sin(ang) };
    })();

    return e.altKey ? [{ x: a.x - d.x, y: a.y - d.y }, { x: a.x + d.x, y: a.y + d.y }] : [a, { x: a.x + d.x, y: a.y + d.y }];
  };

  const shapeItem = (g: Extract<Gesture, { kind: 'shape' }>): ImageMarkupShape => {
    const size = o();
    const item: ImageMarkupShape = {
      id: g.markId, type: g.type, color: st.state.color,
      x1: g.from.x / size.w, y1: g.from.y / size.h, x2: g.to.x / size.w, y2: g.to.y / size.h,
      size: sizeFor(g.type, st.state.size),
    };

    if (takesFill(g.type) && st.state.fill) item.fill = true;

    return item;
  };

  const samples = (e: PointerEvent): PointerEvent[] => {
    // The coalesced list already ends with this event; adding it again doubles the last point.
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];

    return list.length > 0 ? list : [e];
  };

  const pressureOf = (e: PointerEvent, pen: boolean): number => (pen && e.pressure > 0 ? e.pressure : 0.5);

  /** Erases along the segment from the last point to `p`, not just under the samples. */
  const eraseAlong = (p: Point): void => {
    const g = st.gesture;

    if (g?.kind !== 'erase') return;
    const from = g.last;
    const before = g.list;
    const n = Math.max(1, Math.ceil(Math.hypot(p.x - from.x, p.y - from.y) / Math.max(1, eraserRadius() / 2)));

    Array.from({ length: n }, (_, k) => (k + 1) / n).forEach((t) => {
      const at = { x: from.x + (p.x - from.x) * t, y: from.y + (p.y - from.y) * t };
      const next = eraseMarkup(g.list, at, eraserRadius(), o());

      if (next === g.list) return;
      const kept = new Set(next.map((m) => m.id));

      // Only a mark gone whole fades; a cut stroke keeps its node under the same id.
      for (const gone of g.list.filter((m) => !kept.has(m.id))) {
        g.faded.add(gone.id);
        fadeOut(gone);
      }
      g.list = next;
    });
    g.last = p;
    if (g.list === before) return;
    st.preview = g.list;
    scheduleDraw();
  };

  const appendSamples = (g: Extract<Gesture, { kind: 'stroke' }>, e: PointerEvent): void => {
    const size = o();

    for (const s of samples(e)) {
      const q = toO(s.clientX, s.clientY);
      const n = g.item.points.length;
      const same = q.x / size.w === g.item.points[n - 3] && q.y / size.h === g.item.points[n - 2];

      if (!same) g.item.points.push(q.x / size.w, q.y / size.h, pressureOf(s, g.pen));
    }
  };

  const handleOf = (target: EventTarget | null): HandleName | null => {
    const v = target instanceof Element ? target.closest('[data-markup-handle]')?.getAttribute('data-markup-handle') : null;

    return v === 'rotate' || HANDLES.includes(v as HandleName) ? (v as HandleName) : null;
  };

  const textCentre = (item: ImageMarkupText): Point => ({ x: item.x * o().w, y: item.y * o().h });

  const startSelectGesture = (e: PointerEvent, p: Point, base: { id: number; touch: boolean }): Gesture => {
    const selected = find(st.selected, st.markup);
    const handle = handleOf(e.target);

    if (selected && handle && isText(selected)) {
      const c = textCentre(selected);

      if (handle === 'rotate') return { ...base, kind: 'rotate', item: selected, angle: Math.atan2(p.y - c.y, p.x - c.x) };

      return { ...base, kind: 'text-scale', item: selected, dist: Math.max(1, Math.hypot(p.x - c.x, p.y - c.y)) };
    }
    if (selected && handle) return { ...base, kind: 'resize', item: selected, handle, box: markupBounds(selected, o()), from: p };
    const b = selected ? markupBounds(selected, o()) : null;
    const inBox = b !== null && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
    const hit = inBox && selected ? selected : hitTest(st.markup, p, o(), tolerance());

    select(hit ? hit.id : null);

    return hit
      ? { ...base, kind: 'move', item: hit, from: p, screen: { x: e.clientX, y: e.clientY }, moved: false }
      : { ...base, kind: 'idle' };
  };

  const onDown = (e: PointerEvent): void => {
    e.stopPropagation();
    if (!st.active || edit.current?.el.contains(e.target as Node)) return;
    const touch = e.pointerType === 'touch';

    if (touch && [...st.pointers.values()].includes('pen')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    st.pointers.set(e.pointerId, e.pointerType);
    layer.setPointerCapture?.(e.pointerId);
    if (st.gesture) {
      // A second finger: the user meant to pinch or rest a hand, not to draw.
      if (touch && st.gesture.touch) cancelGesture();

      return;
    }
    if (st.dead) return;
    if (edit.current) {
      closeEditor(true);
      st.gesture = { kind: 'idle', id: e.pointerId, touch };

      return;
    }
    if (document.activeElement !== opts.stage) opts.stage.focus({ preventScroll: true });
    st.map = measure();
    const p = toO(e.clientX, e.clientY);
    const base = { id: e.pointerId, touch };
    const tool = st.state.tool;

    flushNudge();
    if (tool === 'select') {
      st.gesture = startSelectGesture(e, p, base);

      return;
    }
    if (handleOf(e.target) && st.selected !== null) {
      st.gesture = startSelectGesture(e, p, base);

      return;
    }
    select(null);
    if (tool === 'pen' || tool === 'highlighter') {
      const pen = e.pointerType === 'pen';
      const size = o();

      st.gesture = {
        ...base, kind: 'stroke', pen,
        item: { id: newMarkupId(), type: tool, color: st.state.color, points: [p.x / size.w, p.y / size.h, pressureOf(e, pen)], size: sizeFor(tool, st.state.size) },
      };
      scheduleDraw();

      return;
    }
    if (SHAPES.has(tool)) {
      st.gesture = {
        ...base, kind: 'shape', type: tool as ImageMarkupShape['type'], markId: newMarkupId(), from: p, to: p, screen: { x: e.clientX, y: e.clientY }, moved: false,
      };

      return;
    }
    if (tool === 'eraser') {
      st.gesture = { ...base, kind: 'erase', last: p, list: st.markup, faded: new Set() };
      eraseAlong(p);

      return;
    }
    const hit = hitTest(st.markup, p, o(), tolerance());

    st.gesture = { ...base, kind: 'text', at: p, target: hit && isText(hit) ? hit : null };
  };

  const onMove = (e: PointerEvent): void => {
    const g = st.gesture;

    if (!g || g.id !== e.pointerId) return;
    const p = toO(e.clientX, e.clientY);
    const size = o();

    if (g.kind === 'stroke') {
      appendSamples(g, e);
      scheduleDraw();

      return;
    }
    if (g.kind === 'shape') {
      g.moved = g.moved || Math.hypot(e.clientX - g.screen.x, e.clientY - g.screen.y) >= SLOP_PX;
      if (!g.moved) return;
      const anchor = g.from;
      const [a, b] = shapeEnds(g.type, anchor, p, e);

      st.preview = [...st.markup, shapeItem({ ...g, from: a, to: b })];
      g.to = p;
      scheduleDraw();

      return;
    }
    if (g.kind === 'move') {
      g.moved = g.moved || Math.hypot(e.clientX - g.screen.x, e.clientY - g.screen.y) >= SLOP_PX;
      if (!g.moved) return;
      st.preview = replace(moveMarkup(g.item, (p.x - g.from.x) / size.w, (p.y - g.from.y) / size.h));
    } else if (g.kind === 'resize') {
      st.preview = replace(resizeMarkup(g.item, g.box, resizedBox(g, p, e.shiftKey), size));
    } else if (g.kind === 'text-scale') {
      const c = textCentre(g.item);
      const k = Math.hypot(p.x - c.x, p.y - c.y) / g.dist;

      st.preview = replace({ ...g.item, size: Math.min(MAX_TEXT, Math.max(MIN_TEXT, g.item.size * k)) });
    } else if (g.kind === 'rotate') {
      const c = textCentre(g.item);
      const turn = ((Math.atan2(p.y - c.y, p.x - c.x) - g.angle) * 180) / Math.PI;
      const raw = (g.item.rotation ?? 0) + turn;

      st.preview = replace({ ...g.item, rotation: e.shiftKey ? Math.round(raw / SNAP_DEG) * SNAP_DEG : raw });
    } else if (g.kind === 'erase') {
      for (const s of samples(e)) eraseAlong(toO(s.clientX, s.clientY));

      return;
    } else {
      return;
    }
    scheduleDraw();
    placeSelection();
  };

  const resizedBox = (g: Extract<Gesture, { kind: 'resize' }>, p: Point, keepAspect: boolean): Box => {
    const dx = p.x - g.from.x;
    const dy = p.y - g.from.y;
    const { box, handle } = g;
    const west = handle.includes('w');
    const east = handle.includes('e');
    const north = handle.includes('n');
    const south = handle.includes('s');
    const left = west ? box.x + dx : box.x;
    const right = east ? box.x + box.w + dx : box.x + box.w;
    const top = north ? box.y + dy : box.y;
    const bottom = south ? box.y + box.h + dy : box.y + box.h;
    const next = { x: left, y: top, w: right - left, h: bottom - top };

    if (!keepAspect || box.w === 0 || box.h === 0 || !(west || east) || !(north || south)) return next;
    const k = Math.max(next.w / box.w, next.h / box.h);
    const w = box.w * k;
    const h = box.h * k;

    return { x: west ? box.x + box.w - w : box.x, y: north ? box.y + box.h - h : box.y, w, h };
  };

  const cancelGesture = (): void => {
    const g = st.gesture;

    releaseInk()?.remove();
    st.gesture = null;
    st.preview = null;
    st.dead = true;
    cancelFrame();
    if (g?.kind === 'erase') {
      for (const id of g.faded) anims.get(`erase:${id}`)?.();
      ghosts.replaceChildren();
    }
    draw();
    placeSelection();
  };

  const finish = (g: Gesture, e: PointerEvent): void => {
    const size = o();

    if (g.kind === 'stroke') {
      const item = commitMarkupItem(g.item, size);

      cancelFrame();
      commit([...st.markup, item]);
      handOver(item);

      return;
    }
    if (g.kind === 'shape') {
      const ends = ((): [Point, Point] => {
        if (g.moved) return shapeEnds(g.type, g.from, toO(e.clientX, e.clientY), e);
        const half = (DEFAULT_SHAPE * Math.min(size.w, size.h)) / 2;
        const box = isClosedShape(g.type);

        return [{ x: g.from.x - half, y: g.from.y - (box ? half : 0) }, { x: g.from.x + half, y: g.from.y + (box ? half : 0) }];
      })();
      const item = commitMarkupItem(shapeItem({ ...g, from: ends[0], to: ends[1] }));

      commit([...st.markup, item]);
      pop(item, g.moved ? POP_FROM_DRAWN : POP_FROM_CLICK);

      return;
    }
    if (g.kind === 'erase') {
      if (g.list !== st.markup) commit(g.list);

      return;
    }
    if (g.kind === 'text') {
      openEditor(g.target ?? newText(g.at), g.target === null);

      return;
    }
    if (g.kind === 'idle' || (g.kind === 'move' && !g.moved)) return;
    const changed = find(g.item.id);

    if (changed) commit(replace(commitMarkupItem(changed)));
  };

  const onUp = (e: PointerEvent): void => {
    if (!st.pointers.delete(e.pointerId)) return;
    if (st.pointers.size === 0) st.dead = false;
    const g = st.gesture;

    if (!g || g.id !== e.pointerId) return;
    st.gesture = null;
    if (e.type === 'pointercancel') {
      st.preview = null;
      draw();
      placeSelection();

      return;
    }
    finish(g, e);
  };

  // Select only: a drawing tool has already placed a mark for each of the two clicks.
  const onDblClick = (e: MouseEvent): void => {
    if (!st.active || edit.current || st.state.tool !== 'select') return;
    const hit = hitTest(st.markup, toO(e.clientX, e.clientY, measure()), o(), HIT_PX / measure().scale);

    if (hit && isText(hit)) openEditor(hit, false);
  };

  const nudge = (e: KeyboardEvent): boolean => {
    const dir = NUDGES[e.key];
    const item = find(st.selected, st.markup);

    if (!dir || !item) return false;
    const step = (e.shiftKey ? NUDGE_BIG : 1) / measure().scale;
    const from = st.nudged ?? item;
    const next = moveMarkup(from, (dir[0] * step) / o().w, (dir[1] * step) / o().h);

    st.nudged = next;
    st.preview = replace(next);
    draw();
    placeSelection();
    window.clearTimeout(st.keyIdle);
    st.keyIdle = window.setTimeout(flushNudge, KEY_IDLE_MS);

    return true;
  };

  const deleteSelection = (): void => {
    const id = st.selected;

    if (id === null) return;
    flushNudge();
    clearSelection();
    commit(st.markup.filter((m) => m.id !== id));
    announceSelection();
  };

  const setState = (next: MarkupPanelState): void => {
    const prev = st.state;

    st.state = { ...next };
    if (next.tool !== prev.tool && next.tool !== 'select' && !edit.current) select(null);
    layer.setAttribute('data-tool', next.tool);
    layer.setAttribute('data-size', String(next.size));
    const keys = (['color', 'size', 'textStyle', 'fill'] as const).filter((k) => next[k] !== prev[k]);
    const target = edit.current ? edit.current.item : find(st.selected, st.markup);

    if (keys.length === 0 || !target) return;
    const styled = keys.reduce((m, k) => restyle(m, k, next), target);

    if (edit.current) {
      // The mark under the editor takes the new look as the user types; it lands on commit.
      edit.current.item = styled as ImageMarkupText;
      styleEditor(edit.current);

      return;
    }
    const clean = commitMarkupItem(styled);

    if (JSON.stringify(clean) !== JSON.stringify(target)) commit(replace(clean));
  };

  const onKey = (e: KeyboardEvent): void => {
    if (!st.active || edit.current || e.target !== opts.stage) return;
    const mod = e.metaKey || e.ctrlKey;
    const item = find(st.selected, st.markup);

    if ((e.key === 'Delete' || e.key === 'Backspace') && item) {
      e.preventDefault();
      deleteSelection();

      return;
    }
    if (e.key === 'Enter' && item && isText(item) && !mod) {
      // The darkroom's Enter applies; on a selected text it means "edit".
      e.preventDefault();
      e.stopPropagation();
      openEditor(item, false);

      return;
    }
    if (mod && !e.altKey && e.key.toLowerCase() === 'd' && item) {
      e.preventDefault();
      const shift = 12 / measure().scale;
      const copy = commitMarkupItem({ ...moveMarkup(item, shift / o().w, shift / o().h), id: newMarkupId() });

      commit([...st.markup, copy]);
      select(copy.id);
      pop(copy, POP_FROM_DRAWN);

      return;
    }
    if (nudge(e)) {
      e.preventDefault();

      return;
    }
    // A non-Latin layout picks by physical key, as the darkroom's own letter keys do.
    const letter = /^[\x20-\x7e]$/.test(e.key) ? e.key.toLowerCase() : /^Key([A-Z])$/.exec(e.code)?.[1].toLowerCase();
    // Shift+letter belongs to the darkroom (Shift+H flips).
    const tool = mod || e.altKey || e.shiftKey || e.key.length !== 1 || letter === undefined ? undefined : TOOL_KEYS[letter];

    if (tool && tool !== st.state.tool) {
      e.preventDefault();
      const next = { ...st.state, tool };

      setState(next);
      opts.onStateChange?.(next);
    }
  };

  layer.addEventListener('pointerdown', onDown);
  layer.addEventListener('pointermove', onMove);
  layer.addEventListener('pointerup', onUp);
  layer.addEventListener('pointercancel', onUp);
  layer.addEventListener('dblclick', onDblClick);
  opts.stage.addEventListener('keydown', onKey);
  layer.setAttribute('data-tool', st.state.tool);
  layer.setAttribute('data-size', String(st.state.size));
  draw();

  const flush = (): void => {
    closeEditor(true);
    flushNudge();
  };

  return {
    setActive(on) {
      if (on === st.active) return;
      if (!on) {
        flush();
        if (st.gesture) cancelGesture();
        st.dead = false;
        st.pointers.clear();
        if (st.selected !== null) select(null);
      }
      st.active = on;
      layer.hidden = !on;
    },
    set(markup) {
      if (markup === st.markup) return;
      closeEditor(false);
      window.clearTimeout(st.keyIdle);
      st.keyIdle = 0;
      st.nudged = null;
      st.markup = markup;
      st.preview = null;
      cancelFrame();
      draw();
      if (st.selected !== null) {
        const item = find(st.selected);

        if (!item) select(null);
        else {
          buildSelection(item);
          announceSelection();
        }
      }
    },
    setState,
    deleteSelection,
    deselect() {
      if (st.selected === null) return false;
      select(null);

      return true;
    },
    isEditingText: () => edit.current !== null,
    flush,
    refresh() {
      const size = o();

      if (`${size.w}x${size.h}` !== st.size) draw();
      if (selection.el) placeSelection();
      if (edit.current) styleEditor(edit.current);
    },
    destroy() {
      st.destroyed = true;
      closeEditor(false);
      clearSelection();
      cancelFrame();
      window.clearTimeout(st.keyIdle);
      anims.forEach((stop) => stop());
      anims.clear();
      layer.removeEventListener('pointerdown', onDown);
      layer.removeEventListener('pointermove', onMove);
      layer.removeEventListener('pointerup', onUp);
      layer.removeEventListener('pointercancel', onUp);
      layer.removeEventListener('dblclick', onDblClick);
      opts.stage.removeEventListener('keydown', onKey);
      layer.remove();
      svg.remove();
      live.remove();
      ghosts.remove();
    },
  };
}
