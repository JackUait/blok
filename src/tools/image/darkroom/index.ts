import type { ImageCrop, ImageCropShape } from '../../../../types/tools/image';
import { DATA_ATTR } from '../../../components/constants/data-attributes';
import { openModalDialog } from '../../../components/utils/modal-dialog';
import { rovingRadioGroup } from '../../../components/utils/roving-radio-group';
import { createSpring, prefersReducedMotion, type SpringClock } from '../../../components/utils/spring';
import type { I18nInstance } from '../../../components/utils/tools';
import { applyRatio, clampRect, FULL_RECT, isFullRect, resizeRect, type Handle } from '../crop-math';
import { renderErrorState } from '../error-state';
import { tr } from '../i18n';
import {
  cameraToRect, clampCamera, fitFrame, percentRatio, rectAspect, rectToCamera, rectToFrame,
  rubberCamera, zoomAt, type Box, type Camera, type Insets,
} from './camera';
import { attachGestures } from './gestures';
import { createHistory, type Snapshot } from './history';
import { createDissolve, createVeil, flyOut, isOnScreen } from './motion';

export interface OpenDarkroomOptions {
  url: string;
  alt?: string;
  initial?: ImageCrop;
  onApply(rect: ImageCrop | null): void;
  onCancel(): void;
  i18n?: I18nInstance;
  /** The block's visible image box; the photo flies out of it. */
  sourceEl?: HTMLElement | null;
  /** Read after onApply/onCancel has re-rendered the block; the photo flies into it. */
  getTargetEl?: () => HTMLElement | null;
  clock?: SpringClock;
}

type RatioShape = 'rect' | ImageCropShape;

interface RatioDef { key: string; i18nKey: string; value: number | null; shape: RatioShape }

const RATIOS: RatioDef[] = [
  { key: 'free', i18nKey: 'tools.image.cropRatioFree', value: null, shape: 'rect' },
  { key: '1', i18nKey: 'tools.image.cropRatio1to1', value: 1, shape: 'rect' },
  { key: String(4 / 3), i18nKey: 'tools.image.cropRatio4to3', value: 4 / 3, shape: 'rect' },
  { key: String(16 / 9), i18nKey: 'tools.image.cropRatio16to9', value: 16 / 9, shape: 'rect' },
  { key: 'circle', i18nKey: 'tools.image.cropRatioCircle', value: 1, shape: 'circle' },
  { key: 'ellipse', i18nKey: 'tools.image.cropRatioOval', value: null, shape: 'ellipse' },
];

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CORNERS = new Set<Handle>(['nw', 'ne', 'se', 'sw']);
// Room for the top bar and the bottom pill around the frame.
const PAD: Insets = { top: 72, right: 32, bottom: 104, left: 32 };
// Stand-in size for an SVG without intrinsic dimensions.
const FALLBACK_NATURAL = 1000;
const NUDGE = 0.01;
const NUDGE_BIG = 0.1;
const ZOOM_STEP = 1.1;
const KEY_IDLE_MS = 250;

type ViewKey = 's' | 'tx' | 'ty' | 'x' | 'y' | 'w' | 'h' | 'round';

const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const roundRect = (r: ImageCrop): ImageCrop => ({ x: round3(r.x), y: round3(r.y), w: round3(r.w), h: round3(r.h) });
const ratioByKey = (key: string): RatioDef => RATIOS.find((r) => r.key === key) ?? RATIOS[0];
const roundOf = (shape: RatioShape): number => (shape === 'rect' ? 0 : 1);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, role?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  node.className = className;
  if (role) node.setAttribute('data-role', role);

  return node;
}

export function openDarkroom(opts: OpenDarkroomOptions): () => void {
  const initialDef = RATIOS.find((r) => r.shape === (opts.initial?.shape ?? 'rect') && r.shape !== 'rect') ?? RATIOS[0];
  const st = {
    natural: { w: FALLBACK_NATURAL, h: FALLBACK_NATURAL },
    measured: false,
    ready: false,
    stage: { w: 0, h: 0 },
    rect: opts.initial ? clampRect(opts.initial) : { ...FULL_RECT },
    def: initialDef,
    panFrom: { s: 1, tx: 0, ty: 0 },
    rectFrom: { ...FULL_RECT },
    keyIdle: 0,
    closed: false,
    // A chip picked before load; only then is the rect re-fitted to the ratio at load.
    ratioPicked: false,
  };
  const startRect = { ...st.rect };
  const hist = { stack: createHistory({ rect: { ...st.rect }, ratioKey: st.def.key }) };

  const backdrop = el('div', 'blok-darkroom');

  backdrop.setAttribute('data-blok-testid', 'image-crop-backdrop');
  backdrop.setAttribute('role', 'presentation');
  const surface = el('div', 'blok-darkroom__surface');

  surface.tabIndex = -1;
  surface.setAttribute(DATA_ATTR.keyboardOwner, '');

  const bar = el('div', 'blok-darkroom__bar');

  bar.setAttribute('data-darkroom-chrome', '');
  const makeBtn = (action: string, key: string, variant: string): HTMLButtonElement => {
    const b = el('button', `blok-darkroom__btn blok-darkroom__btn--${variant}`);

    b.type = 'button';
    b.setAttribute('data-action', action);
    b.textContent = tr(opts.i18n, key);

    return b;
  };
  const cancelBtn = makeBtn('cancel', 'tools.image.cropCancel', 'ghost');
  const resetBtn = makeBtn('reset', 'tools.image.cropReset', 'ghost');
  const doneBtn = makeBtn('done', 'tools.image.cropDone', 'primary');
  const readout = el('span', 'blok-darkroom__readout', 'darkroom-readout');

  readout.setAttribute('aria-hidden', 'true');
  const lead = el('div', 'blok-darkroom__bar-lead');

  lead.append(cancelBtn, resetBtn);
  bar.append(lead, readout, doneBtn);

  const stage = el('div', 'blok-darkroom__stage', 'darkroom-stage');

  stage.tabIndex = 0;
  stage.setAttribute('role', 'application');
  stage.setAttribute('aria-label', tr(opts.i18n, 'tools.image.cropStageLabel'));
  const photo = el('img', 'blok-darkroom__photo', 'darkroom-photo');

  photo.alt = opts.alt ?? '';
  photo.draggable = false;
  const frame = el('div', 'blok-darkroom__frame', 'darkroom-frame');
  const grid = el('div', 'blok-darkroom__grid');

  grid.setAttribute('aria-hidden', 'true');
  frame.appendChild(grid);
  const handleEls = new Map<Handle, HTMLElement>();

  for (const h of HANDLES) {
    const handle = el('span', `blok-darkroom__handle blok-darkroom__handle--${CORNERS.has(h) ? 'corner' : 'edge'} blok-darkroom__handle--${h}`);

    handle.setAttribute('data-handle', h);
    frame.appendChild(handle);
    handleEls.set(h, handle);
  }
  stage.append(photo, frame);

  const pill = el('div', 'blok-darkroom__pill');

  pill.setAttribute('data-darkroom-chrome', '');
  pill.setAttribute('role', 'radiogroup');
  pill.setAttribute('aria-label', tr(opts.i18n, 'tools.image.cropAspectRatio'));
  const chips = RATIOS.map((r) => {
    const chip = el('button', 'blok-darkroom__chip');

    chip.type = 'button';
    chip.setAttribute('role', 'radio');
    chip.setAttribute('data-ratio', r.key);
    chip.textContent = tr(opts.i18n, r.i18nKey);
    chip.addEventListener('click', () => { flushKeyCommit(); setRatio(r); commit(); });
    pill.appendChild(chip);

    return chip;
  });

  const live = el('div', 'blok-darkroom__live', 'darkroom-live');

  live.setAttribute('aria-live', 'polite');
  surface.append(bar, stage, pill, live);
  backdrop.appendChild(surface);

  const pctRatio = (): number | null => (st.def.value === null ? null : percentRatio(st.def.value, st.natural));
  const frameOf = (v: Readonly<Record<ViewKey, number>>): Box => ({ x: v.x, y: v.y, w: v.w, h: v.h });
  const camOf = (v: Readonly<Record<ViewKey, number>>): Camera => ({ s: v.s, tx: v.tx, ty: v.ty });

  const sizeText = (r: ImageCrop): string =>
    `${Math.round((r.w / 100) * st.natural.w)} × ${Math.round((r.h / 100) * st.natural.h)} px`;

  const paint = (v: Readonly<Record<ViewKey, number>>): void => {
    photo.style.transform = `translate(${v.tx}px, ${v.ty}px) scale(${v.s})`;
    frame.style.transform = `translate(${v.x}px, ${v.y}px)`;
    frame.style.width = `${v.w}px`;
    frame.style.height = `${v.h}px`;
    frame.style.setProperty('--blok-radius-darkroom-frame', `${v.round * 50}%`);
    readout.textContent = sizeText(cameraToRect(camOf(v), st.natural, frameOf(v)));
  };

  const view = createSpring<ViewKey>({
    from: { s: 1, tx: 0, ty: 0, x: 0, y: 0, w: 0, h: 0, round: roundOf(st.def.shape) },
    clock: opts.clock,
    onUpdate: (v) => {
      // e2e waits on this; a gesture that starts mid-spring measures a moving frame.
      stage.removeAttribute('data-settled');
      paint(v);
    },
    onSettle: () => stage.setAttribute('data-settled', ''),
  });

  /** Target layout for the current rect: frame fitted and centred, camera showing the rect in it. */
  const fitted = (): Record<ViewKey, number> => {
    const f = fitFrame(rectAspect(st.rect, st.natural), st.stage, PAD);

    return { ...rectToCamera(st.rect, st.natural, f), ...f, round: roundOf(st.def.shape) };
  };

  const syncChips = (): void => {
    chips.forEach((chip, i) => {
      const on = RATIOS[i].key === st.def.key;

      chip.setAttribute('data-active', String(on));
      chip.setAttribute('aria-checked', String(on));
    });
    roving.refresh();
    const freeform = st.def.value === null;

    handleEls.forEach((h, name) => { if (!CORNERS.has(name)) h.toggleAttribute('hidden', !freeform); });
    frame.setAttribute('data-shape', st.def.shape);
  };

  const announce = (): void => {
    if (st.measured) live.textContent = sizeText(st.rect);
  };

  const commit = (): void => {
    hist.stack.push({ rect: { ...st.rect }, ratioKey: st.def.key });
    announce();
  };

  const setRatio = (def: RatioDef): void => {
    st.def = def;
    if (!st.ready) st.ratioPicked = true;
    const r = pctRatio();

    st.rect = r === null ? st.rect : applyRatio(st.rect, r);
    syncChips();
    if (st.ready) view.to(fitted());
  };

  const restore = (s: Snapshot | null): void => {
    if (!s) return;
    st.def = ratioByKey(s.ratioKey);
    st.rect = { ...s.rect };
    syncChips();
    view.to(fitted());
    announce();
  };

  const roving = rovingRadioGroup({
    radios: chips,
    getSelectedIndex: () => RATIOS.findIndex((r) => r.key === st.def.key),
    onSelect: (i) => { flushKeyCommit(); setRatio(RATIOS[i]); commit(); },
  });

  syncChips();

  const dissolve = createDissolve([bar, pill], grid);

  // A nudge commits after a short idle; undo, a gesture, a chip and Reset must see it recorded first.
  const flushKeyCommit = (): void => {
    if (st.keyIdle === 0) return;
    window.clearTimeout(st.keyIdle);
    st.keyIdle = 0;
    commit();
  };

  const detachGestures = attachGestures(stage, {
    onStart: (kind) => {
      if (!st.ready) return;
      flushKeyCommit();
      dissolve.begin();
      view.stop();
      st.panFrom = camOf(view.values());
      if (kind === 'handle') st.rectFrom = { ...st.rect };
    },
    onPan: (dx, dy) => {
      if (!st.ready) return;
      const f = frameOf(view.values());

      view.jump(rubberCamera({ ...st.panFrom, tx: st.panFrom.tx + dx, ty: st.panFrom.ty + dy }, st.natural, f));
    },
    onZoom: (factor, center, dx, dy) => {
      if (!st.ready) return;
      const v = view.values();
      const f = frameOf(v);

      view.jump(zoomAt({ s: v.s, tx: v.tx + dx, ty: v.ty + dy }, factor, center, st.natural, f));
    },
    onHandle: (h, dx, dy) => {
      if (!st.ready) return;
      const cam = camOf(view.values());
      const dxPct = (dx / (cam.s * st.natural.w)) * 100;
      const dyPct = (dy / (cam.s * st.natural.h)) * 100;
      const r = pctRatio();
      const next = clampRect(resizeRect(st.rectFrom, h, dxPct, dyPct));

      st.rect = r === null ? next : applyRatio(next, r, h);
      view.jump(rectToFrame(st.rect, st.natural, cam));
    },
    onEnd: (kind) => {
      if (!st.ready) return;
      dissolve.end();
      if (kind !== 'handle') {
        const v = view.values();
        const f = frameOf(v);
        const settled = clampCamera(camOf(v), st.natural, f);

        const r = pctRatio();

        // A mid-flight frame has the spring's in-between aspect, not the chip's.
        st.rect = cameraToRect(settled, st.natural, f);
        if (r !== null) st.rect = applyRatio(st.rect, r);
      }
      // stop() keeps the old target, so every end retargets all keys to the new rect.
      view.to(fitted());
      commit();
    },
    onPeek: (active) => { surface.toggleAttribute('data-peek', active); },
  });

  const layout = (animate: boolean): void => {
    const r = stage.getBoundingClientRect();

    st.stage = { w: r.width, h: r.height };
    if (animate) {
      view.to(fitted());

      return;
    }
    view.jump(fitted());
    // jump() never settles, so an instant layout marks rest itself.
    stage.setAttribute('data-settled', '');
  };

  const flyIn = (): void => {
    const src = opts.sourceEl?.getBoundingClientRect();
    const stageBox = stage.getBoundingClientRect();

    layout(false);
    if (!src || !isOnScreen(src)) {
      surface.setAttribute('data-entering', 'fade');

      return;
    }
    const from: Box = { x: src.left - stageBox.left, y: src.top - stageBox.top, w: src.width, h: src.height };

    if (opts.sourceEl) opts.sourceEl.style.setProperty('visibility', 'hidden');
    view.jump({ ...rectToCamera(st.rect, st.natural, from), ...from });
    view.to(fitted());
  };

  const start = (): void => {
    if (st.ready || st.closed) return;
    st.measured = photo.naturalWidth > 0 && photo.naturalHeight > 0;
    if (st.measured) {
      st.natural = { w: photo.naturalWidth, h: photo.naturalHeight };
    } else {
      const src = opts.sourceEl?.getBoundingClientRect();
      const aspect = src && src.width > 0 && src.height > 0
        ? (src.width / src.height) * (st.rect.h / st.rect.w)
        : 1;

      st.natural = { w: FALLBACK_NATURAL, h: FALLBACK_NATURAL / aspect };
    }
    const r = pctRatio();

    // A ratio picked before load was applied against the fallback size.
    // An untouched saved crop keeps its rect: an old circle may not be square in pixels.
    if (r !== null && st.ratioPicked) st.rect = applyRatio(st.rect, r);
    // Steps taken before load hold rects measured against the fallback size, so the loaded state is the new base.
    hist.stack = createHistory({ rect: { ...st.rect }, ratioKey: st.def.key });
    readout.hidden = !st.measured;
    photo.style.width = `${st.natural.w}px`;
    photo.style.height = `${st.natural.h}px`;
    st.ready = true;
    flyIn();
    announce();
  };

  const fail = (): void => {
    if (st.closed) return;
    // Read first: a browser drops focus to <body> the moment its control is disabled or hidden.
    const focused = document.activeElement;

    stage.replaceChildren(renderErrorState({ variant: 'broken', i18n: opts.i18n }));
    doneBtn.disabled = true;
    resetBtn.disabled = true;
    doneBtn.hidden = true;
    resetBtn.hidden = true;
    pill.hidden = true;
    // Done holds the initial focus; a hidden control cannot keep it.
    if ([doneBtn, resetBtn, pill].some((n) => n.contains(focused))) cancelBtn.focus();
  };

  photo.addEventListener('load', start);
  photo.addEventListener('error', fail);
  photo.src = opts.url;

  // The first observation repeats the size start() measured; a relayout then would snap over the fly-in.
  const resize = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
      const r = stage.getBoundingClientRect();

      if (st.ready && (r.width !== st.stage.w || r.height !== st.stage.h)) layout(false);
    })
    : null;

  resize?.observe(stage);

  const finish = (): ImageCrop | null => {
    const rect = roundRect(st.rect);

    if (st.def.shape === 'circle' || st.def.shape === 'ellipse') return { ...rect, shape: st.def.shape };

    return isFullRect(rect) ? null : rect;
  };

  const leave = (rect: ImageCrop, round: number, after: () => void): void => {
    const v = view.values();
    const stageBox = stage.getBoundingClientRect();
    const from: Box = { x: v.x + stageBox.left, y: v.y + stageBox.top, w: v.w, h: v.h };
    const source = opts.sourceEl ?? null;
    const getTarget = opts.getTargetEl;
    // Without a target there is nothing to land on; skipping also keeps a late rAF out of torn-down tests.
    const flies = st.ready && getTarget !== undefined;
    // Made before close() so the dark surround never drops for a frame. Reduced motion lets it drop at once.
    const veil = flies && !prefersReducedMotion() ? createVeil() : null;

    dialogHandle.close();
    after();
    if (source) source.style.visibility = '';
    if (!flies) return;
    const request = opts.clock ? opts.clock.request : requestAnimationFrame;

    request(() => {
      flyOut({
        url: opts.url, natural: st.natural, rect, from, fromRound: v.round,
        target: getTarget(), targetRound: round,
        clock: opts.clock, veil,
      });
    });
  };

  const apply = (): void => {
    if (doneBtn.disabled) return;
    const result = finish();

    leave(result ?? FULL_RECT, roundOf(st.def.shape), () => opts.onApply(result));
  };

  const cancel = (): void => {
    const f = fitFrame(rectAspect(startRect, st.natural), st.stage, PAD);

    const round = roundOf(initialDef.shape);

    // The clone starts from this view, so its corners must already match the block.
    view.jump({ ...rectToCamera(startRect, st.natural, f), ...f, round });
    leave({ ...startRect }, round, () => opts.onCancel());
  };

  doneBtn.addEventListener('click', apply);
  cancelBtn.addEventListener('click', cancel);
  resetBtn.addEventListener('click', () => {
    flushKeyCommit();
    const r = pctRatio();

    st.rect = r === null ? { ...FULL_RECT } : applyRatio({ ...FULL_RECT }, r);
    view.to(fitted());
    commit();
  });

  const nudge = (e: KeyboardEvent): boolean => {
    const dirs: Record<string, [number, number]> = {
      ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1],
    };
    const dir = dirs[e.key];

    if (!dir && e.key !== '+' && e.key !== '=' && e.key !== '-') return false;
    const r = pctRatio();

    // A saved circle that is not square in pixels is squared by its first edit.
    if (r !== null) st.rect = applyRatio(st.rect, r);
    // From the committed rect, not the in-flight spring, so key repeats keep their full distance.
    const f = fitFrame(rectAspect(st.rect, st.natural), st.stage, PAD);
    const step = (e.shiftKey ? NUDGE_BIG : NUDGE) * f.w;
    const move = dir ? [dir[0] * step, dir[1] * step] : null;
    const centre = { x: f.x + f.w / 2, y: f.y + f.h / 2 };
    const cam = rectToCamera(st.rect, st.natural, f);
    const next = move
      ? clampCamera({ ...cam, tx: cam.tx + move[0], ty: cam.ty + move[1] }, st.natural, f)
      : zoomAt(cam, e.key === '-' ? 1 / ZOOM_STEP : ZOOM_STEP, centre, st.natural, f);
    view.to({ ...next, ...f });
    st.rect = cameraToRect(next, st.natural, f);
    window.clearTimeout(st.keyIdle);
    st.keyIdle = window.setTimeout(() => { st.keyIdle = 0; commit(); }, KEY_IDLE_MS);

    return true;
  };

  stage.addEventListener('keydown', (e) => {
    if (!st.ready) return;
    if (e.key === '\\' && !e.repeat) { surface.setAttribute('data-peek', ''); e.preventDefault(); return; }
    if (nudge(e)) e.preventDefault();
  });
  stage.addEventListener('keyup', (e) => {
    if (e.key === '\\') surface.removeAttribute('data-peek');
  });
  // A keyup that lands elsewhere never reaches the stage.
  stage.addEventListener('blur', () => surface.removeAttribute('data-peek'));

  surface.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    // Same rule as the editor's shortcutLetter: the physical key counts only when the layout types a non-Latin letter there.
    const nonLatin = e.key.length === 1 && !/^[\x20-\x7e]$/.test(e.key) && !e.altKey;
    const isLetter = (letter: string): boolean =>
      e.key.toLowerCase() === letter || (nonLatin && e.code === `Key${letter.toUpperCase()}`);
    // Same history keys as the editor's KeyboardController: Ctrl+Y redoes on Windows and Linux.
    const redoY = e.ctrlKey && !e.shiftKey && isLetter('y');

    if ((mod && isLetter('z')) || redoY) {
      e.preventDefault();
      flushKeyCommit();
      restore(e.shiftKey || redoY ? hist.stack.redo() : hist.stack.undo());

      return;
    }
    // Enter on a button is that button's click.
    if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      apply();
    }
  });

  const dialogHandle = openModalDialog({
    content: backdrop,
    surface,
    role: 'dialog',
    label: tr(opts.i18n, 'tools.image.cropDialogLabel'),
    initialFocus: () => doneBtn,
    // The whole viewport is the surface: a drag released on the dark surround must not cancel.
    outside: false,
    onDismiss: () => cancel(),
    onClose: () => {
      st.closed = true;
      photo.removeEventListener('load', start);
      photo.removeEventListener('error', fail);
      view.stop();
      dissolve.destroy();
      detachGestures();
      resize?.disconnect();
      roving.destroy();
      window.clearTimeout(st.keyIdle);
      if (opts.sourceEl) opts.sourceEl.style.removeProperty('visibility');
    },
  });

  // openModalDialog mounts the backdrop; a cached photo measured before that sees a 0×0 stage.
  if (photo.complete && photo.naturalWidth > 0) start();

  return dialogHandle.close;
}
