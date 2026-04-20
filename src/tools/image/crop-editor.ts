import type { ImageCrop } from '../../../types/tools/image';
import { FULL_RECT, clampRect, isFullRect, resizeRect, applyRatio, type Handle } from './crop-math';

export interface CropEditorOptions {
  url: string;
  alt?: string;
  initial?: ImageCrop;
  onApply(rect: ImageCrop | null): void;
  onCancel(): void;
}

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const RATIOS: { label: string; value: number | null }[] = [
  { label: 'Free', value: null },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '16:9', value: 16 / 9 },
  { label: 'Original', value: 0 },
];

function assertEl<T extends Element>(node: T | null, what: string): T {
  if (!node) throw new Error(`CropEditor: missing ${what}`);
  return node;
}

function ratioDataValue(v: number | null): string {
  if (v === null) return 'free';
  if (v === 0) return 'original';
  return String(v);
}

export function mountCropEditor(
  container: HTMLElement,
  opts: CropEditorOptions
): () => void {
  const state = {
    rect: opts.initial ? clampRect(opts.initial) : { ...FULL_RECT },
    ratio: null as number | null,
  };

  const root = document.createElement('div');
  root.className = 'blok-image-crop-editor';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Crop image');

  const stage = document.createElement('div');
  stage.className = 'blok-image-crop-editor__stage';

  const source = document.createElement('img');
  source.className = 'blok-image-crop-editor__source';
  source.src = opts.url;
  source.alt = opts.alt ?? '';
  source.draggable = false;
  stage.appendChild(source);

  const mask = document.createElement('div');
  mask.className = 'blok-image-crop-editor__mask';
  stage.appendChild(mask);

  const rectEl = document.createElement('div');
  rectEl.className = 'blok-image-crop-editor__rect';
  stage.appendChild(rectEl);

  const handleEls: Record<Handle, HTMLElement> = {} as Record<Handle, HTMLElement>;
  for (const h of HANDLES) {
    const el = document.createElement('span');
    el.setAttribute('data-handle', h);
    el.className = `blok-image-crop-editor__handle blok-image-crop-editor__handle--${h}`;
    rectEl.appendChild(el);
    handleEls[h] = el;
  }

  const toolbar = document.createElement('div');
  toolbar.className = 'blok-image-crop-editor__toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.innerHTML = `
    <div class="blok-image-crop-editor__ratio-wrap" style="position:relative">
      <button type="button" data-action="ratio" aria-haspopup="menu" aria-expanded="false">Free ▾</button>
      <div data-role="ratio-menu" role="menu" hidden></div>
    </div>
    <button type="button" data-action="reset">Reset</button>
    <button type="button" data-action="cancel">Cancel</button>
    <button type="button" data-action="done">Done</button>
  `;

  root.appendChild(stage);
  root.appendChild(toolbar);
  container.appendChild(root);

  const ratioMenu = assertEl(toolbar.querySelector<HTMLElement>('[data-role="ratio-menu"]'), 'ratio-menu');
  const ratioTrigger = assertEl(toolbar.querySelector<HTMLButtonElement>('[data-action="ratio"]'), 'ratio trigger');

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
  }
  paint();

  function setRect(next: ImageCrop): void {
    state.rect = applyRatio(clampRect(next), state.ratio);
    paint();
  }

  function setRatio(next: number | null): void {
    if (next === 0) {
      const n = source.naturalWidth && source.naturalHeight
        ? source.naturalWidth / source.naturalHeight
        : null;
      state.ratio = n;
    } else {
      state.ratio = next;
    }
    setRect(state.rect);
  }

  for (const h of HANDLES) {
    handleEls[h].addEventListener('pointerdown', (e) => startHandleDrag(e, h));
  }
  rectEl.addEventListener('pointerdown', (e) => {
    const tgt = e.target as HTMLElement;
    if (tgt.dataset.handle) return;
    startBodyDrag(e);
  });

  function stagePct(clientX: number, clientY: number): { x: number; y: number } {
    const s = stage.getBoundingClientRect();
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

  ratioTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = ratioMenu.hidden;
    ratioMenu.hidden = !open;
    ratioTrigger.setAttribute('aria-expanded', String(open));
    if (open) renderRatioMenu();
  });

  function renderRatioMenu(): void {
    ratioMenu.replaceChildren();
    for (const r of RATIOS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'menuitem');
      btn.textContent = r.label;
      btn.setAttribute('data-ratio', ratioDataValue(r.value));
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        setRatio(r.value);
        ratioTrigger.textContent = `${r.label} ▾`;
        ratioMenu.hidden = true;
        ratioTrigger.setAttribute('aria-expanded', 'false');
      });
      ratioMenu.appendChild(btn);
    }
  }

  function applyDone(): void {
    opts.onApply(isFullRect(state.rect) ? null : state.rect);
  }

  const doneBtn = assertEl(toolbar.querySelector<HTMLButtonElement>('[data-action="done"]'), 'done button');
  doneBtn.addEventListener('click', applyDone);

  const cancelBtn = assertEl(toolbar.querySelector<HTMLButtonElement>('[data-action="cancel"]'), 'cancel button');
  cancelBtn.addEventListener('click', () => opts.onCancel());

  const resetBtn = assertEl(toolbar.querySelector<HTMLButtonElement>('[data-action="reset"]'), 'reset button');
  resetBtn.addEventListener('click', () => setRect({ ...FULL_RECT }));

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); opts.onCancel(); }
    else if (e.key === 'Enter') { e.preventDefault(); applyDone(); }
  };
  document.addEventListener('keydown', onKey);

  return (): void => {
    document.removeEventListener('keydown', onKey);
    root.remove();
  };
}
