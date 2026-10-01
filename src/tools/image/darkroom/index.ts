import type { ImageAdjust, ImageCrop, ImageCropShape, ImageMarkup } from '../../../../types/tools/image';
import { DATA_ATTR } from '../../../components/constants/data-attributes';
import { IconFlipHorizontal, IconRotateLeft } from '../../../components/icons';
import { openModalDialog } from '../../../components/utils/modal-dialog';
import { rovingRadioGroup } from '../../../components/utils/roving-radio-group';
import { createSpring, prefersReducedMotion, type SpringClock } from '../../../components/utils/spring';
import type { I18nInstance } from '../../../components/utils/tools';
import { DEFAULT_FILTERS, type FilterSet } from '../adjust';
import { applyRatio, clampRect, FULL_RECT, isFullRect, resizeRect, type Handle } from '../crop-math';
import { renderErrorState } from '../error-state';
import {
  coverCrop, flipHorizontal, IDENTITY, isIdentity, orientedSize, planeImageStyle, rotateLeft, type Geometry,
} from '../geometry';
import { tr } from '../i18n';
import { applyImageFilter } from '../image-view';
import { flipMarkup, readMarkup, turnMarkupLeft } from '../markup/model';
import { createAdjustPanel } from './adjust-panel';
import {
  cameraToRect, clampCamera, fitFrame, percentRatio, rectAspect, rectToCamera, rectToFrame,
  rubberCamera, zoomAt, type Box, type Camera, type Insets, type Size,
} from './camera';
import { createDial } from './dial';
import { createFilterStrip } from './filter-strip';
import { attachGestures } from './gestures';
import { createHistory, type Snapshot } from './history';
import { createMarkupEditor, stateForMark } from './markup-editor';
import { createMarkupPanel, DEFAULT_MARKUP_STATE, type MarkupPanelState } from './markup-panel';
import { createModeTabs } from './mode-tabs';
import { cameraPlane, createDissolve, createVeil, fitCameraPlane, flyOut, isOnScreen } from './motion';

export interface DarkroomResult {
  /** Null only when the rect is the full image and nothing is straightened. */
  crop: ImageCrop | null;
  geometry: Geometry;
  filter: string;
  /** 0–100. */
  strength: number;
  adjust: Required<ImageAdjust>;
  markup: ImageMarkup[];
}

export interface OpenDarkroomOptions {
  url: string;
  alt?: string;
  initial?: ImageCrop;
  initialGeometry?: Geometry;
  initialFilter?: string;
  initialStrength?: number;
  initialAdjust?: Required<ImageAdjust>;
  initialMarkup?: ImageMarkup[];
  onApply(result: DarkroomResult): void;
  onCancel(): void;
  i18n?: I18nInstance;
  /** Looks the strip offers and how each renders. Default: every built-in. */
  filters?: FilterSet;
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
// Fallback room for the top bar and bottom dock when they cannot be measured.
const PAD: Insets = { top: 72, right: 32, bottom: 200, left: 32 };
// Clear space between the frame and the chrome around it.
const CHROME_GAP = 16;
// Stand-in size for an SVG without intrinsic dimensions.
const FALLBACK_NATURAL = 1000;
const NUDGE = 0.01;
const NUDGE_BIG = 0.1;
const ZOOM_STEP = 1.1;
const KEY_IDLE_MS = 250;
const MAX_STRAIGHTEN = 45;
const QUARTER = 90;
const NO_ADJUST: Required<ImageAdjust> = { brightness: 0, contrast: 0, saturation: 0 };

type ViewKey = 's' | 'tx' | 'ty' | 'x' | 'y' | 'w' | 'h' | 'round' | 'theta' | 'spin';

const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const roundRect = (r: ImageCrop): ImageCrop => ({ x: round3(r.x), y: round3(r.y), w: round3(r.w), h: round3(r.h) });
const ratioByKey = (key: string): RatioDef => RATIOS.find((r) => r.key === key) ?? RATIOS[0];
const roundOf = (shape: RatioShape): number => (shape === 'rect' ? 0 : 1);
// A quarter turn makes a wide fixed ratio tall; only a square one still fits it.
const survivesQuarterTurn = (def: RatioDef): boolean => def.value === null || def.value === 1;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, role?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  node.className = className;
  if (role) node.setAttribute('data-role', role);

  return node;
}

export function openDarkroom(opts: OpenDarkroomOptions): () => void {
  const initialDef = RATIOS.find((r) => r.shape === (opts.initial?.shape ?? 'rect') && r.shape !== 'rect') ?? RATIOS[0];
  const initialGeometry: Geometry = { ...(opts.initialGeometry ?? IDENTITY) };
  const initialFilter = opts.initialFilter ?? 'none';
  const initialStrength = opts.initialStrength ?? 100;
  const filters = opts.filters ?? DEFAULT_FILTERS;
  // Only Original to offer, and the image does not use another look.
  const showFilters = filters.order.length > 1 || initialFilter !== 'none';
  const initialAdjust: Required<ImageAdjust> = { ...(opts.initialAdjust ?? NO_ADJUST) };
  const initialMarkup: ImageMarkup[] = readMarkup(opts.initialMarkup);
  const st = {
    natural: { w: FALLBACK_NATURAL, h: FALLBACK_NATURAL },
    measured: false,
    ready: false,
    stage: { w: 0, h: 0 },
    rect: opts.initial ? clampRect(opts.initial) : { ...FULL_RECT },
    def: initialDef,
    geometry: { ...initialGeometry },
    filter: initialFilter,
    strength: initialStrength,
    adjust: { ...initialAdjust },
    // Items are never mutated, so snapshots share them.
    markup: initialMarkup,
    markupState: { ...DEFAULT_MARKUP_STATE },
    panFrom: { s: 1, tx: 0, ty: 0 },
    rectFrom: { ...FULL_RECT },
    // The rect a straighten burst started from, so scrubbing back gives the crop back unshrunk.
    straightenFrom: null as ImageCrop | null,
    keyIdle: 0,
    closed: false,
    mode: 'crop',
    // A gesture that began in Crop mode still ends there, even if a tab key switched modes meanwhile.
    gesturing: false,
    // A chip picked before load; only then is the rect re-fitted to the ratio at load.
    ratioPicked: false,
  };
  const startRect = { ...st.rect };
  const snapshot = (): Snapshot => ({
    rect: { ...st.rect }, ratioKey: st.def.key, geometry: { ...st.geometry }, filter: st.filter, strength: st.strength, adjust: { ...st.adjust },
    markup: st.markup,
  });
  const hist = { stack: createHistory(snapshot()) };

  const backdrop = el('div', 'blok-darkroom');

  backdrop.setAttribute('data-blok-testid', 'image-crop-backdrop');
  backdrop.setAttribute('role', 'presentation');
  const surface = el('div', 'blok-darkroom__surface');

  surface.tabIndex = -1;
  surface.setAttribute(DATA_ATTR.keyboardOwner, '');
  // darkroom.css hides the crop chrome outside Crop mode and shows the cropped result.
  surface.setAttribute('data-mode', st.mode);

  const bar = el('div', 'blok-darkroom__bar');

  bar.setAttribute('data-darkroom-chrome', '');
  const makeBtn = (action: string, key: string, variant: string): HTMLButtonElement => {
    const b = el('button', `blok-darkroom__btn blok-darkroom__btn--${variant}`);

    b.type = 'button';
    b.setAttribute('data-action', action);
    b.textContent = tr(opts.i18n, key);

    return b;
  };
  const makeIconBtn = (action: string, key: string, icon: string): HTMLButtonElement => {
    const b = el('button', 'blok-darkroom__btn blok-darkroom__btn--ghost blok-darkroom__btn--icon');

    b.type = 'button';
    b.setAttribute('data-action', action);
    b.setAttribute('aria-label', tr(opts.i18n, key));
    b.innerHTML = icon;

    return b;
  };
  const cancelBtn = makeBtn('cancel', 'tools.image.cropCancel', 'ghost');
  const resetBtn = makeBtn('reset', 'tools.image.cropReset', 'ghost');
  const rotateBtn = makeIconBtn('rotate-left', 'tools.image.rotateLeft', IconRotateLeft);
  const flipBtn = makeIconBtn('flip', 'tools.image.flip', IconFlipHorizontal);
  const doneBtn = makeBtn('done', 'tools.image.cropDone', 'primary');
  const lead = el('div', 'blok-darkroom__bar-lead');

  lead.append(cancelBtn, resetBtn, rotateBtn, flipBtn);
  bar.append(lead, doneBtn);

  const stage = el('div', 'blok-darkroom__stage', 'darkroom-stage');

  stage.tabIndex = 0;
  stage.setAttribute('role', 'application');
  stage.setAttribute('aria-label', tr(opts.i18n, 'tools.image.cropStageLabel'));
  const photo = document.createElement('img');

  photo.setAttribute('data-role', 'darkroom-photo');
  photo.alt = opts.alt ?? '';
  photo.draggable = false;
  applyImageFilter(photo, st.filter, st.adjust, st.strength, filters);
  // The camera moves the plane; the img inside carries the turn and the filter.
  const plane = cameraPlane(photo, null, st.geometry);

  plane.classList.add('blok-darkroom__photo');
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
  stage.append(plane, frame);

  const pill = el('div', 'blok-darkroom__pill');

  pill.setAttribute('role', 'radiogroup');
  pill.setAttribute('aria-label', tr(opts.i18n, 'tools.image.cropAspectRatio'));
  const chips = RATIOS.map((r) => {
    const chip = el('button', 'blok-darkroom__chip');

    chip.type = 'button';
    chip.setAttribute('role', 'radio');
    chip.setAttribute('data-ratio', r.key);
    chip.textContent = tr(opts.i18n, r.i18nKey);
    chip.addEventListener('click', () => { flushAll(); setRatio(r); commit(); });
    pill.appendChild(chip);

    return chip;
  });

  const o = (): Size => orientedSize(st.natural, st.geometry);
  const theta = (): number => st.geometry.straighten;
  /** Shrinks a rect until the turned photo covers it; a no-op while nothing is straightened. */
  const covered = (r: ImageCrop): ImageCrop => (theta() === 0 ? r : coverCrop(r, o(), theta()));
  const pctRatio = (): number | null => (st.def.value === null ? null : percentRatio(st.def.value, o()));
  const frameOf = (v: Readonly<Record<ViewKey, number>>): Box => ({ x: v.x, y: v.y, w: v.w, h: v.h });
  const camOf = (v: Readonly<Record<ViewKey, number>>): Camera => ({ s: v.s, tx: v.tx, ty: v.ty });

  // Owns the one markup layer inside the plane, so the photo shows the marks in every mode.
  const markupEditor = createMarkupEditor({
    stage,
    plane,
    getSize: o,
    i18n: opts.i18n,
    markup: st.markup,
    state: st.markupState,
    clock: opts.clock,
    onCommit: (next) => {
      st.markup = next;
      commit();
    },
    onSelectionChange: (kind, item) => {
      if (item) setMarkupState(stateForMark(st.markupState, item));
      markupPanel.setSelection(kind);
    },
    // Through the panel, so a tool key swaps colour and size like a click.
    onStateChange: (next) => (next.tool === st.markupState.tool ? setMarkupState(next) : markupPanel.pickTool(next.tool)),
  });
  const setMarkupState = (next: MarkupPanelState): void => {
    st.markupState = next;
    markupPanel.set(next);
    markupEditor.setState(next);
  };

  const sizeText = (r: ImageCrop): string => {
    const size = o();

    return `${Math.round((r.w / 100) * size.w)} × ${Math.round((r.h / 100) * size.h)} px`;
  };

  const applyFilter = (): void => applyImageFilter(photo, st.filter, st.adjust, st.strength, filters);

  const paint = (v: Readonly<Record<ViewKey, number>>): void => {
    const cx = v.x + v.w / 2;
    const cy = v.y + v.h / 2;
    // The spin turns photo and frame together about the frame centre while a quarter turn lands.
    const spun = v.spin === 0 ? '' : `translate(${cx}px, ${cy}px) rotate(${v.spin}deg) translate(${-cx}px, ${-cy}px) `;

    plane.style.transform = `${spun}translate(${v.tx}px, ${v.ty}px) scale(${v.s})`;
    frame.style.transform = v.spin === 0 ? `translate(${v.x}px, ${v.y}px)` : `translate(${v.x}px, ${v.y}px) rotate(${v.spin}deg)`;
    frame.style.width = `${v.w}px`;
    frame.style.height = `${v.h}px`;
    frame.style.setProperty('--blok-radius-darkroom-frame', `${v.round * 50}%`);
    if (st.ready) photo.style.transform = planeImageStyle(st.natural, { ...st.geometry, straighten: v.theta }).transform;
    markupEditor.refresh();
  };

  const view = createSpring<ViewKey>({
    from: { s: 1, tx: 0, ty: 0, x: 0, y: 0, w: 0, h: 0, round: roundOf(st.def.shape), theta: theta(), spin: 0 },
    clock: opts.clock,
    onUpdate: (v) => {
      // e2e waits on this; a gesture that starts mid-spring measures a moving frame.
      stage.removeAttribute('data-settled');
      paint(v);
    },
    onSettle: () => stage.setAttribute('data-settled', ''),
  });

  /**
   * Room left by the bar and the dock as laid out now. The dock's height depends on the
   * panel, its wrapping and the font, so a fixed inset let it cover the frame.
   * Offsets ignore the fly-in transform; the bar and dock share the stage's origin.
   */
  const pad = (): Insets => {
    const top = bar.offsetHeight;
    const dockTop = dock.offsetTop;
    const stageH = stage.offsetHeight;

    return {
      ...PAD,
      top: top > 0 ? top + CHROME_GAP : PAD.top,
      bottom: dockTop > 0 && stageH > dockTop ? stageH - dockTop + CHROME_GAP : PAD.bottom,
    };
  };

  /** Target layout for the current rect: frame fitted and centred, camera showing the rect in it. */
  const fitted = (): Record<ViewKey, number> => {
    const f = fitFrame(rectAspect(st.rect, o()), st.stage, pad());

    return { ...rectToCamera(st.rect, o(), f), ...f, round: roundOf(st.def.shape), theta: theta(), spin: 0 };
  };

  /** jump() never settles, so an instant move marks rest itself. */
  const jumpTo = (v: Record<ViewKey, number>): void => {
    view.jump(v);
    stage.setAttribute('data-settled', '');
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
    hist.stack.push(snapshot());
    announce();
    syncResets();
  };

  /** A rotation swaps O, so the plane's box and the img inside it must follow. */
  const refitPlane = (): void => {
    if (!st.ready) return;
    fitCameraPlane(plane, photo, st.natural, st.geometry);
    paint(view.values());
  };

  const setRatio = (def: RatioDef): void => {
    st.def = def;
    if (!st.ready) st.ratioPicked = true;
    const r = pctRatio();

    st.rect = covered(r === null ? st.rect : applyRatio(st.rect, r));
    syncChips();
    if (st.ready) view.to(fitted());
  };

  const gridShow = createDissolve([], grid);

  const straightenDial = createDial({
    min: -MAX_STRAIGHTEN,
    max: MAX_STRAIGHTEN,
    value: st.geometry.straighten,
    label: tr(opts.i18n, 'tools.image.straighten'),
    resetLabel: tr(opts.i18n, 'tools.image.resetStraighten'),
    valueText: (v) => `${v}°`,
    onInput: (v) => {
      if (st.straightenFrom === null) {
        flushKeyCommit();
        st.straightenFrom = { ...st.rect };
        gridShow.begin();
      }
      st.geometry = { ...st.geometry, straighten: v };
      st.rect = covered(st.straightenFrom);
      syncResets();
      // The photo turns under a steady frame: no spring, the scrub drives it.
      if (st.ready) jumpTo(fitted());
    },
    onCommit: () => {
      st.straightenFrom = null;
      gridShow.end();
      commit();
    },
  });

  const makePanelReset = (action: string, key: string): HTMLButtonElement => {
    const b = makeBtn(action, key, 'ghost');

    b.classList.add('blok-darkroom__panel-reset');

    return b;
  };
  const cropReset = makePanelReset('reset-crop', 'tools.image.resetCrop');
  const adjustReset = makePanelReset('reset-adjust', 'tools.image.resetAdjustments');
  const filterReset = makePanelReset('reset-filter', 'tools.image.resetFilter');

  const cropPanel = el('div', 'blok-darkroom__panel blok-darkroom__panel--crop');

  cropPanel.append(pill, straightenDial.box, cropReset);

  const adjustPanel = createAdjustPanel({
    i18n: opts.i18n,
    value: st.adjust,
    onInput: (a) => { st.adjust = a; applyFilter(); syncResets(); },
    onCommit: (a) => { st.adjust = a; applyFilter(); commit(); },
  });
  const adjustWrap = el('div', 'blok-darkroom__panel');

  adjustWrap.append(adjustPanel.el, adjustReset);

  const filterStrip = createFilterStrip({
    i18n: opts.i18n,
    url: opts.url,
    filters,
    value: st.filter,
    strength: st.strength,
    onSelect: (p) => { flushAll(); st.filter = p; st.strength = 100; applyFilter(); commit(); },
    onStrengthInput: (v) => { st.strength = v; applyFilter(); },
    onStrengthCommit: (v) => { st.strength = v; applyFilter(); commit(); },
  });
  const filterWrap = el('div', 'blok-darkroom__panel');

  filterWrap.append(filterStrip.el, filterReset);

  const markupPanel = createMarkupPanel({
    i18n: opts.i18n,
    state: st.markupState,
    onChange: (next) => {
      st.markupState = next;
      markupEditor.setState(next);
    },
    onDelete: () => markupEditor.deleteSelection(),
    onClear: () => {
      flushAll();
      st.markup = [];
      markupEditor.set(st.markup);
      commit();
    },
  });

  /** An attribute, not [hidden]: darkroom.css keeps the box so the panel never jumps. */
  const showReset = (btn: HTMLButtonElement, shown: boolean, fallback: () => HTMLElement | null): void => {
    btn.setAttribute('data-shown', String(shown));
    // A browser drops focus to <body> from an invisible control; hand it to the panel's main control.
    if (!shown && document.activeElement === btn) fallback()?.focus();
  };

  const syncResets = (): void => {
    const cropDirty = !isFullRect(roundRect(st.rect)) || st.def.key !== RATIOS[0].key || !isIdentity(st.geometry);

    showReset(cropReset, cropDirty, () => pill.querySelector<HTMLElement>('[aria-checked="true"]'));
    showReset(adjustReset, Object.values(st.adjust).some((v) => v !== 0), () => adjustPanel.el.querySelector<HTMLElement>('[role="slider"]'));
    showReset(filterReset, st.filter !== 'none', () => filterStrip.el.querySelector<HTMLElement>('[aria-checked="true"]'));
    markupPanel.setHasMarkup(st.markup.length > 0);
  };

  const tabs = createModeTabs({
    modes: [
      { key: 'crop', label: tr(opts.i18n, 'tools.image.editModeCrop') },
      { key: 'adjust', label: tr(opts.i18n, 'tools.image.editModeAdjust') },
      ...(showFilters ? [{ key: 'filters', label: tr(opts.i18n, 'tools.image.editModeFilters') }] : []),
      { key: 'markup', label: tr(opts.i18n, 'tools.image.editModeMarkup') },
    ],
    panels: { crop: cropPanel, adjust: adjustWrap, ...(showFilters ? { filters: filterWrap } : {}), markup: markupPanel.el },
    selected: 'crop',
    label: tr(opts.i18n, 'tools.image.editModes'),
    onSelect: (mode) => {
      flushAll();
      if (mode !== 'markup') markupEditor.deselect();
      markupEditor.setActive(mode === 'markup');
      st.mode = mode;
      surface.setAttribute('data-mode', mode);
      stage.setAttribute('aria-label', tr(opts.i18n, mode === 'markup' ? 'tools.image.markupStageLabel' : 'tools.image.cropStageLabel'));
    },
  });

  const dock = el('div', 'blok-darkroom__dock');

  dock.setAttribute('data-darkroom-chrome', '');
  // The crop panel goes first so the ratio pill stays the first radiogroup in the dialog.
  dock.append(cropPanel, adjustWrap, ...(showFilters ? [filterWrap] : []), markupPanel.el, tabs.el);

  const live = el('div', 'blok-darkroom__live', 'darkroom-live');

  live.setAttribute('aria-live', 'polite');
  surface.append(bar, stage, dock, live);
  backdrop.appendChild(surface);

  const restore = (s: Snapshot | null): void => {
    if (!s) return;
    const turned = s.geometry.rotation !== st.geometry.rotation || s.geometry.flipX !== st.geometry.flipX;

    st.def = ratioByKey(s.ratioKey);
    st.rect = { ...s.rect };
    st.geometry = { ...s.geometry };
    st.filter = s.filter;
    st.strength = s.strength;
    st.adjust = { ...s.adjust };
    st.markup = s.markup;
    st.straightenFrom = null;
    straightenDial.set(st.geometry.straighten);
    adjustPanel.set(st.adjust);
    filterStrip.set(st.filter, st.strength);
    applyFilter();
    if (turned) refitPlane();
    markupEditor.set(st.markup);
    syncChips();
    if (st.ready) view.to(fitted());
    announce();
    syncResets();
  };

  const roving = rovingRadioGroup({
    radios: chips,
    getSelectedIndex: () => RATIOS.findIndex((r) => r.key === st.def.key),
    onSelect: (i) => { flushAll(); setRatio(RATIOS[i]); commit(); },
  });

  syncChips();
  syncResets();

  const dissolve = createDissolve([bar, dock], grid);

  // A nudge commits after a short idle; undo, a gesture, a chip and Reset must see it recorded first.
  const flushKeyCommit = (): void => {
    if (st.keyIdle === 0) return;
    window.clearTimeout(st.keyIdle);
    st.keyIdle = 0;
    commit();
  };

  // Every pending burst (stage nudge, dial keys) becomes its own step before the next edit.
  const flushAll = (): void => {
    flushKeyCommit();
    straightenDial.flush();
    adjustPanel.flush();
    filterStrip.flush();
    markupEditor.flush();
  };

  const turnLeft = (): void => {
    if (!st.ready) return;
    flushAll();
    const v = view.values();
    const next = rotateLeft(st.geometry, st.rect);

    st.geometry = next.g;
    st.rect = next.crop;
    st.markup = turnMarkupLeft(st.markup);
    if (!survivesQuarterTurn(st.def)) st.def = RATIOS[0];
    syncChips();
    refitPlane();
    markupEditor.set(st.markup);
    // The first frame matches the last one: the turned state, spun back a quarter about the same centre.
    const cx = v.x + v.w / 2;
    const cy = v.y + v.h / 2;
    const from: Box = { x: cx - v.h / 2, y: cy - v.w / 2, w: v.h, h: v.w };

    view.jump({ ...rectToCamera(st.rect, o(), from), ...from, round: v.round, theta: v.theta, spin: QUARTER });
    view.to(fitted());
    commit();
  };

  const flip = (): void => {
    if (!st.ready) return;
    flushAll();
    const next = flipHorizontal(st.geometry, st.rect);

    st.geometry = next.g;
    st.rect = next.crop;
    st.markup = flipMarkup(st.markup);
    straightenDial.set(st.geometry.straighten);
    refitPlane();
    markupEditor.set(st.markup);
    view.to(fitted());
    commit();
  };

  // Crop, ratio and geometry only: filter and adjust are other tabs' state.
  cropReset.addEventListener('click', () => {
    flushAll();
    const turned = st.geometry.rotation !== 0 || st.geometry.flipX;

    st.def = RATIOS[0];
    st.geometry = { ...IDENTITY };
    st.rect = { ...FULL_RECT };
    straightenDial.set(0);
    if (turned) refitPlane();
    syncChips();
    if (st.ready) view.to(fitted());
    commit();
  });
  adjustReset.addEventListener('click', () => {
    flushAll();
    st.adjust = { ...NO_ADJUST };
    adjustPanel.set(st.adjust);
    applyFilter();
    commit();
  });
  filterReset.addEventListener('click', () => {
    flushAll();
    st.filter = 'none';
    st.strength = 100;
    filterStrip.set(st.filter, st.strength);
    applyFilter();
    commit();
  });

  rotateBtn.addEventListener('click', turnLeft);
  flipBtn.addEventListener('click', flip);

  // Only Crop mode edits the crop; elsewhere the photo is a preview of the result.
  const cropping = (): boolean => st.ready && st.mode === 'crop';

  const detachGestures = attachGestures(stage, {
    onStart: (kind) => {
      if (!cropping()) return;
      st.gesturing = true;
      flushAll();
      dissolve.begin();
      view.stop();
      st.panFrom = camOf(view.values());
      if (kind === 'handle') st.rectFrom = { ...st.rect };
    },
    onPan: (dx, dy) => {
      if (!cropping()) return;
      const f = frameOf(view.values());

      view.jump(rubberCamera({ ...st.panFrom, tx: st.panFrom.tx + dx, ty: st.panFrom.ty + dy }, o(), f, theta()));
    },
    onZoom: (factor, center, dx, dy) => {
      if (!cropping()) return;
      const v = view.values();
      const f = frameOf(v);

      view.jump(zoomAt({ s: v.s, tx: v.tx + dx, ty: v.ty + dy }, factor, center, o(), f, theta()));
    },
    onHandle: (h, dx, dy) => {
      if (!cropping()) return;
      const cam = camOf(view.values());
      const size = o();
      const dxPct = (dx / (cam.s * size.w)) * 100;
      const dyPct = (dy / (cam.s * size.h)) * 100;
      const r = pctRatio();
      const next = clampRect(resizeRect(st.rectFrom, h, dxPct, dyPct));

      st.rect = covered(r === null ? next : applyRatio(next, r, h));
      view.jump(rectToFrame(st.rect, size, cam));
    },
    onEnd: (kind) => {
      if (!st.gesturing) return;
      st.gesturing = false;
      dissolve.end();
      if (kind !== 'handle') {
        const v = view.values();
        const f = frameOf(v);
        const settled = clampCamera(camOf(v), o(), f, theta());

        const r = pctRatio();

        // A mid-flight frame has the spring's in-between aspect, not the chip's.
        st.rect = cameraToRect(settled, o(), f);
        if (r !== null) st.rect = applyRatio(st.rect, r);
        st.rect = covered(st.rect);
      }
      // stop() keeps the old target, so every end retargets all keys to the new rect.
      view.to(fitted());
      commit();
    },
    onPeek: (active) => { surface.toggleAttribute('data-peek', active && cropping()); },
  });

  const layout = (animate: boolean): void => {
    const r = stage.getBoundingClientRect();

    st.stage = { w: r.width, h: r.height };
    if (animate) {
      view.to(fitted());

      return;
    }
    jumpTo(fitted());
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
    view.jump({ ...rectToCamera(st.rect, o(), from), ...from });
    view.to(fitted());
  };

  const start = (): void => {
    if (st.ready || st.closed) return;
    st.measured = photo.naturalWidth > 0 && photo.naturalHeight > 0;
    if (st.measured) {
      st.natural = { w: photo.naturalWidth, h: photo.naturalHeight };
    } else {
      const src = opts.sourceEl?.getBoundingClientRect();
      // The block box shows the oriented image, so this is O's aspect.
      const aspect = src && src.width > 0 && src.height > 0
        ? (src.width / src.height) * (st.rect.h / st.rect.w)
        : 1;

      st.natural = orientedSize({ w: FALLBACK_NATURAL, h: FALLBACK_NATURAL / aspect }, st.geometry);
    }
    const r = pctRatio();

    // A ratio picked before load was applied against the fallback size.
    // An untouched saved crop keeps its rect: an old circle may not be square in pixels.
    if (r !== null && st.ratioPicked) st.rect = applyRatio(st.rect, r);
    st.rect = covered(st.rect);
    // Steps taken before load hold rects measured against the fallback size, so the loaded state is the new base.
    hist.stack = createHistory(snapshot());
    st.ready = true;
    fitCameraPlane(plane, photo, st.natural, st.geometry);
    markupEditor.refresh();
    flyIn();
    announce();
  };

  const fail = (): void => {
    if (st.closed) return;
    // Read first: a browser drops focus to <body> the moment its control is disabled or hidden.
    const focused = document.activeElement;
    const gone = [doneBtn, resetBtn, rotateBtn, flipBtn, pill, dock, markupPanel.el];

    markupEditor.setActive(false);
    stage.replaceChildren(renderErrorState({ variant: 'broken', i18n: opts.i18n }));
    doneBtn.disabled = true;
    resetBtn.disabled = true;
    for (const n of gone) n.hidden = true;
    // Done holds the initial focus; a hidden control cannot keep it.
    if (gone.some((n) => n.contains(focused))) cancelBtn.focus();
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
  // A dock that grows (wrapping chips, a font swap) must push the frame up, not cover it.
  // The first observation only repeats the current height; acting on it would retarget the fly-in.
  const dockSeen = { h: -1 };
  const dockResize = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
      const h = dock.offsetHeight;
      const changed = dockSeen.h !== -1 && h !== dockSeen.h;

      dockSeen.h = h;
      if (changed && st.ready && !st.closed) layout(true);
    })
    : null;

  dockResize?.observe(dock);

  const finish = (): DarkroomResult => {
    const rect = roundRect(st.rect);
    const edits = { geometry: { ...st.geometry }, filter: st.filter, strength: st.strength, adjust: { ...st.adjust }, markup: st.markup };

    if (st.def.shape === 'circle' || st.def.shape === 'ellipse') return { crop: { ...rect, shape: st.def.shape }, ...edits };

    return { crop: isFullRect(rect) && theta() === 0 ? null : rect, ...edits };
  };

  interface Landing {
    rect: ImageCrop; round: number; geometry: Geometry; filter: string; strength: number; adjust: Required<ImageAdjust>; markup: ImageMarkup[];
  }

  const leave = (land: Landing, after: () => void): void => {
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
    try {
      after();
    } catch (error) {
      // No flight will come to fade it, and an opaque top-layer veil would cover the page for good.
      veil?.remove();
      throw error;
    }
    if (source) source.style.visibility = '';
    if (!flies) return;
    const request = opts.clock ? opts.clock.request : requestAnimationFrame;
    const natural = st.natural;

    request(() => {
      flyOut({
        url: opts.url, natural, rect: land.rect, geometry: land.geometry,
        filter: land.filter, strength: land.strength, filters, adjust: land.adjust, markup: land.markup,
        from, fromRound: v.round, target: getTarget(), targetRound: land.round,
        clock: opts.clock, veil,
      });
    });
  };

  const apply = (): void => {
    if (doneBtn.disabled) return;
    flushAll();
    const result = finish();

    leave({
      rect: result.crop ?? FULL_RECT, round: roundOf(st.def.shape),
      geometry: result.geometry, filter: result.filter, strength: result.strength, adjust: result.adjust, markup: result.markup,
    }, () => opts.onApply(result));
  };

  const cancel = (): void => {
    const startO = orientedSize(st.natural, initialGeometry);
    const f = fitFrame(rectAspect(startRect, startO), st.stage, pad());
    const round = roundOf(initialDef.shape);

    // The clone starts from this view, so its corners must already match the block.
    view.jump({ ...rectToCamera(startRect, startO, f), ...f, round, spin: 0 });
    leave({
      rect: { ...startRect }, round, geometry: initialGeometry,
      filter: initialFilter, strength: initialStrength, adjust: initialAdjust, markup: initialMarkup,
    }, () => opts.onCancel());
  };

  doneBtn.addEventListener('click', apply);
  cancelBtn.addEventListener('click', cancel);
  resetBtn.addEventListener('click', () => {
    flushAll();
    const turned = st.geometry.rotation !== 0 || st.geometry.flipX;

    st.geometry = { ...IDENTITY };
    st.filter = 'none';
    st.strength = 100;
    st.adjust = { ...NO_ADJUST };
    st.markup = [];
    markupEditor.set(st.markup);
    straightenDial.set(0);
    adjustPanel.set(st.adjust);
    filterStrip.set(st.filter, st.strength);
    applyFilter();
    if (turned) refitPlane();
    // Reset before load squares against the fallback size; start() must redo it at the real size.
    if (!st.ready) st.ratioPicked = true;
    const r = pctRatio();

    st.rect = r === null ? { ...FULL_RECT } : applyRatio({ ...FULL_RECT }, r);
    if (st.ready) view.to(fitted());
    commit();
  });

  const nudge = (e: KeyboardEvent): boolean => {
    const dirs: Record<string, [number, number]> = {
      ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1],
    };
    const dir = dirs[e.key];

    if (!dir && e.key !== '+' && e.key !== '=' && e.key !== '-') return false;
    const r = pctRatio();
    const size = o();

    // A saved circle that is not square in pixels is squared by its first edit.
    if (r !== null) st.rect = covered(applyRatio(st.rect, r));
    // From the committed rect, not the in-flight spring, so key repeats keep their full distance.
    const f = fitFrame(rectAspect(st.rect, size), st.stage, pad());
    const step = (e.shiftKey ? NUDGE_BIG : NUDGE) * f.w;
    const move = dir ? [dir[0] * step, dir[1] * step] : null;
    const centre = { x: f.x + f.w / 2, y: f.y + f.h / 2 };
    const cam = rectToCamera(st.rect, size, f);
    const next = move
      ? clampCamera({ ...cam, tx: cam.tx + move[0], ty: cam.ty + move[1] }, size, f, theta())
      : zoomAt(cam, e.key === '-' ? 1 / ZOOM_STEP : ZOOM_STEP, centre, size, f, theta());

    view.to({ ...next, ...f });
    st.rect = cameraToRect(next, size, f);
    window.clearTimeout(st.keyIdle);
    st.keyIdle = window.setTimeout(() => { st.keyIdle = 0; commit(); }, KEY_IDLE_MS);

    return true;
  };

  stage.addEventListener('keydown', (e) => {
    if (!cropping()) return;
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
      flushAll();
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
    directionSource: opts.sourceEl,
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
      gridShow.destroy();
      detachGestures();
      resize?.disconnect();
      dockResize?.disconnect();
      roving.destroy();
      straightenDial.destroy();
      adjustPanel.destroy();
      filterStrip.destroy();
      markupEditor.destroy();
      markupPanel.destroy();
      tabs.destroy();
      window.clearTimeout(st.keyIdle);
      if (opts.sourceEl) opts.sourceEl.style.removeProperty('visibility');
    },
  });

  // openModalDialog mounts the backdrop; a cached photo measured before that sees a 0×0 stage.
  if (photo.complete && photo.naturalWidth > 0) start();

  return dialogHandle.close;
}
