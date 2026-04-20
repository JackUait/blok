import type { ImageCrop, ImageCropShape } from '../../../types/tools/image';
import { FULL_RECT, clampRect, isFullRect, resizeRect, applyRatio, type Handle } from './crop-math';

export interface CropEditorOptions {
  url: string;
  alt?: string;
  initial?: ImageCrop;
  onApply(rect: ImageCrop | null): void;
  onCancel(): void;
}

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CORNERS = new Set<Handle>(['nw', 'ne', 'se', 'sw']);

type RatioShape = 'rect' | ImageCropShape;

interface RatioDef {
  label: string;
  key: string;
  value: number | null;
  shape: RatioShape;
}

const RATIOS: RatioDef[] = [
  { label: 'Free', key: 'free', value: null, shape: 'rect' },
  { label: '1:1', key: '1', value: 1, shape: 'rect' },
  { label: '4:3', key: String(4 / 3), value: 4 / 3, shape: 'rect' },
  { label: '16:9', key: String(16 / 9), value: 16 / 9, shape: 'rect' },
  { label: 'Circle', key: 'circle', value: 1, shape: 'circle' },
  { label: 'Oval', key: 'ellipse', value: null, shape: 'ellipse' },
];

function assertEl<T extends Element>(node: T | null, what: string): T {
  if (!node) throw new Error(`CropEditor: missing ${what}`);
  return node;
}

function buildHandle(h: Handle): HTMLElement {
  const el = document.createElement('span');
  el.setAttribute('data-handle', h);
  const variant = CORNERS.has(h) ? 'corner' : 'edge';
  el.className = `blok-image-crop-editor__handle blok-image-crop-editor__handle--${variant} blok-image-crop-editor__handle--${h}`;
  if (CORNERS.has(h)) {
    el.appendChild(makeStroke('a'));
    el.appendChild(makeStroke('b'));
  }
  return el;
}

function makeStroke(side: 'a' | 'b'): HTMLElement {
  const stroke = document.createElement('i');
  stroke.className = `blok-image-crop-editor__handle-stroke blok-image-crop-editor__handle-stroke--${side}`;
  return stroke;
}

export function mountCropEditor(
  container: HTMLElement,
  opts: CropEditorOptions
): () => void {
  const initialShape: RatioShape = opts.initial?.shape ?? 'rect';
  const initialDef = RATIOS.find((r) => r.shape === initialShape && r.shape !== 'rect')
    ?? RATIOS[0];

  const state = {
    rect: opts.initial ? clampRect(opts.initial) : { ...FULL_RECT },
    ratio: initialDef.value,
    ratioKey: initialDef.key,
    shape: initialDef.shape,
  };

  const root = document.createElement('div');
  root.className = 'blok-image-crop-editor';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Crop image');

  const stage = document.createElement('div');
  stage.className = 'blok-image-crop-editor__stage';

  const frame = document.createElement('div');
  frame.className = 'blok-image-crop-editor__frame';
  stage.appendChild(frame);

  const source = document.createElement('img');
  source.className = 'blok-image-crop-editor__source';
  source.src = opts.url;
  source.alt = opts.alt ?? '';
  source.draggable = false;
  frame.appendChild(source);

  const mask = document.createElement('div');
  mask.className = 'blok-image-crop-editor__mask';
  frame.appendChild(mask);

  const rectEl = document.createElement('div');
  rectEl.className = 'blok-image-crop-editor__rect';
  rectEl.setAttribute('data-shape', state.shape);
  frame.appendChild(rectEl);

  const shapeMask = document.createElement('div');
  shapeMask.className = 'blok-image-crop-editor__shape-mask';
  shapeMask.setAttribute('aria-hidden', 'true');
  rectEl.appendChild(shapeMask);

  const GRID_LINE_VARIANTS = ['v-1', 'v-2', 'h-1', 'h-2'] as const;
  for (const variant of GRID_LINE_VARIANTS) {
    const line = document.createElement('i');
    line.className = `blok-image-crop-editor__grid-line blok-image-crop-editor__grid-line--${variant}`;
    rectEl.appendChild(line);
  }

  const pill = document.createElement('div');
  pill.className = 'blok-image-crop-editor__size-pill';
  pill.hidden = true;
  rectEl.appendChild(pill);

  const handleEls: Record<Handle, HTMLElement> = {} as Record<Handle, HTMLElement>;
  for (const h of HANDLES) {
    const el = buildHandle(h);
    rectEl.appendChild(el);
    handleEls[h] = el;
  }

  const toolbar = document.createElement('div');
  toolbar.className = 'blok-image-crop-editor__toolbar blok-image-crop-editor__toolbar--footer';
  toolbar.setAttribute('role', 'toolbar');

  const ratioGroup = document.createElement('div');
  ratioGroup.className = 'blok-image-crop-editor__ratio-group';
  ratioGroup.setAttribute('role', 'radiogroup');
  ratioGroup.setAttribute('aria-label', 'Aspect ratio');
  ratioGroup.setAttribute('data-action', 'ratio');

  const ratioChips: Record<string, HTMLButtonElement> = {};
  for (const r of RATIOS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'blok-image-crop-editor__ratio-chip';
    chip.setAttribute('role', 'radio');
    chip.setAttribute('data-ratio', r.key);
    chip.setAttribute('data-active', String(r.key === state.ratioKey));
    chip.setAttribute('aria-checked', String(r.key === state.ratioKey));
    chip.textContent = r.label;
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      setRatio(r);
    });
    ratioGroup.appendChild(chip);
    ratioChips[r.key] = chip;
  }

  const actions = document.createElement('div');
  actions.className = 'blok-image-crop-editor__actions';
  actions.innerHTML = `
    <button type="button" class="blok-image-crop-editor__btn blok-image-crop-editor__btn--ghost" data-action="reset">Reset</button>
    <button type="button" class="blok-image-crop-editor__btn blok-image-crop-editor__btn--ghost" data-action="cancel">Cancel</button>
    <button type="button" class="blok-image-crop-editor__btn blok-image-crop-editor__btn--primary" data-action="done">Done</button>
  `;

  toolbar.appendChild(ratioGroup);
  toolbar.appendChild(actions);

  root.appendChild(stage);
  root.appendChild(toolbar);
  container.appendChild(root);

  function updatePill(): void {
    const nw = source.naturalWidth;
    const nh = source.naturalHeight;
    if (!nw || !nh) {
      pill.hidden = true;
      return;
    }
    pill.hidden = false;
    const w = Math.round((state.rect.w / 100) * nw);
    const h = Math.round((state.rect.h / 100) * nh);
    pill.textContent = `${w} × ${h} px`;
  }

  function paint(): void {
    const { rect } = state;
    rectEl.style.left = `${rect.x}%`;
    rectEl.style.top = `${rect.y}%`;
    rectEl.style.width = `${rect.w}%`;
    rectEl.style.height = `${rect.h}%`;
    mask.style.clipPath = `polygon(
      0 0, 100% 0, 100% 100%, 0 100%, 0 0,
      ${rect.x}% ${rect.y}%,
      ${rect.x}% ${rect.y + rect.h}%,
      ${rect.x + rect.w}% ${rect.y + rect.h}%,
      ${rect.x + rect.w}% ${rect.y}%,
      ${rect.x}% ${rect.y}%
    )`;
    updatePill();
  }
  paint();

  if (source.complete && source.naturalWidth > 0) {
    updatePill();
  }
  source.addEventListener('load', updatePill);

  function setRect(next: ImageCrop): void {
    state.rect = applyRatio(clampRect(next), state.ratio);
    paint();
  }

  function updateActiveChip(): void {
    for (const [key, chip] of Object.entries(ratioChips)) {
      const active = key === state.ratioKey;
      chip.setAttribute('data-active', String(active));
      chip.setAttribute('aria-checked', String(active));
    }
  }

  function setRatio(def: RatioDef): void {
    state.ratio = def.value;
    state.ratioKey = def.key;
    state.shape = def.shape;
    rectEl.setAttribute('data-shape', def.shape);
    updateActiveChip();
    setRect(state.rect);
  }

  for (const h of HANDLES) {
    handleEls[h].addEventListener('pointerdown', (e) => startHandleDrag(e, h));
  }
  rectEl.addEventListener('pointerdown', (e) => {
    const tgt = e.target as HTMLElement;
    if (tgt.closest('[data-handle]')) return;
    startBodyDrag(e);
  });

  function stagePct(clientX: number, clientY: number): { x: number; y: number } {
    const s = frame.getBoundingClientRect();
    return {
      x: ((clientX - s.left) / s.width) * 100,
      y: ((clientY - s.top) / s.height) * 100,
    };
  }

  function startHandleDrag(ev: PointerEvent, h: Handle): void {
    ev.preventDefault();
    ev.stopPropagation();
    const start = { ...state.rect };
    const origin = stagePct(ev.clientX, ev.clientY);
    const move = (m: PointerEvent): void => {
      const p = stagePct(m.clientX, m.clientY);
      setRect(resizeRect(start, h, p.x - origin.x, p.y - origin.y));
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function startBodyDrag(ev: PointerEvent): void {
    ev.preventDefault();
    const start = { ...state.rect };
    const origin = stagePct(ev.clientX, ev.clientY);
    const move = (m: PointerEvent): void => {
      const p = stagePct(m.clientX, m.clientY);
      setRect({ ...start, x: start.x + (p.x - origin.x), y: start.y + (p.y - origin.y) });
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function applyDone(): void {
    const shape = state.shape;
    if (shape === 'circle' || shape === 'ellipse') {
      opts.onApply({ ...state.rect, shape });
      return;
    }
    opts.onApply(isFullRect(state.rect) ? null : state.rect);
  }

  const doneBtn = assertEl(actions.querySelector<HTMLButtonElement>('[data-action="done"]'), 'done button');
  doneBtn.addEventListener('click', applyDone);

  const cancelBtn = assertEl(actions.querySelector<HTMLButtonElement>('[data-action="cancel"]'), 'cancel button');
  cancelBtn.addEventListener('click', () => opts.onCancel());

  const resetBtn = assertEl(actions.querySelector<HTMLButtonElement>('[data-action="reset"]'), 'reset button');
  resetBtn.addEventListener('click', () => setRect({ ...FULL_RECT }));

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); opts.onCancel(); }
    else if (e.key === 'Enter') { e.preventDefault(); applyDone(); }
  };
  document.addEventListener('keydown', onKey);

  return (): void => {
    document.removeEventListener('keydown', onKey);
    source.removeEventListener('load', updatePill);
    root.remove();
  };
}
