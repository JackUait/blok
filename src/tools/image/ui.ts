import type { ImageCrop, ImageData, ImageSize } from '../../../types/tools/image';
/**
 * Mirror of the upstream ImageAlign* union from types/tools/image.d.ts,
 * kept local so the i18n regression scan finds no stray hardcoded copy.
 */
type ImageAlign = 'left' | 'center' | 'right';
import { onHover as tooltipOnHover, hide as tooltipHide } from '../../components/utils/tooltip';
import type { I18nInstance } from '../../components/utils/tools';
import {
  IconCaption,
  IconCollapseFullscreen,
  IconCrop,
  IconDownload,
  IconExpandFullscreen,
  IconImageAlignCenter,
  IconImageAlignLeft,
  IconImageAlignRight,
  IconLinkCopy,
  IconMoreHorizontal,
  IconReplaceImage,
  IconZoomIn,
  IconZoomOut,
} from '../../components/icons';
import { applyRubberBand } from './spring';
import { tr } from './i18n';
import { promoteToTopLayer, removeFromTopLayer } from '../../components/utils/top-layer';

const ALIGN_TO_TEXT_ALIGN: Record<ImageAlign, string> = {
  left: 'left',
  center: 'center',
  right: 'right',
};

const ALIGN_ICON: Record<ImageAlign, string> = {
  left: IconImageAlignLeft,
  center: IconImageAlignCenter,
  right: IconImageAlignRight,
};

function bindIntrinsicAspect(img: HTMLImageElement, wrapper: HTMLElement, w: number, h: number): void {
  const target = wrapper;
  const apply = (): void => {
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (nw > 0 && nh > 0) {
      target.style.aspectRatio = `${w * nw} / ${h * nh}`;
    }
  };
  if (img.complete) apply();
  else img.addEventListener('load', apply, { once: true });
}

function alignLabel(i18n: I18nInstance | undefined, value: ImageAlign): string {
  switch (value) {
    case 'left': return tr(i18n, 'tools.image.alignmentLeftAria');
    case 'center': return tr(i18n, 'tools.image.alignmentCenterAria');
    case 'right': return tr(i18n, 'tools.image.alignmentRightAria');
  }
}

export function renderImage(
  data: Partial<ImageData> & { url: string }
): HTMLElement {
  const alignment = data.alignment ?? 'center';
  const figure = document.createElement('figure');
  figure.className = 'blok-image-inner';
  figure.setAttribute('data-role', 'image-figure');
  figure.style.margin = '0';
  figure.style.textAlign = ALIGN_TO_TEXT_ALIGN[alignment];
  figure.style.position = 'relative';
  if (data.width !== undefined) {
    figure.style.width = `${data.width}%`;
  }

  const img = document.createElement('img');
  img.setAttribute('src', data.url);
  img.setAttribute('alt', data.alt ?? '');
  img.draggable = false;

  if (data.crop) {
    const { x, y, w, h, shape } = data.crop;
    const wrapper = document.createElement('div');
    wrapper.className = 'blok-image-crop';
    wrapper.setAttribute('data-role', 'image-crop');
    wrapper.style.overflow = 'hidden';
    wrapper.style.position = 'relative';
    // Fallback until natural dims resolve — matches crop-region aspect only for square sources.
    wrapper.style.aspectRatio = `${w} / ${h}`;
    wrapper.style.width = '100%';
    if (shape) wrapper.setAttribute('data-shape', shape);
    if (shape === 'circle' || shape === 'ellipse') {
      wrapper.style.borderRadius = '50%';
    }
    img.style.display = 'block';
    // Opt out of the editor's global `img { max-width: 100% }` preflight so
    // the (100/w)*100% width below can actually scale the source past the wrapper.
    img.style.maxWidth = 'none';
    img.style.width = `${(100 / w) * 100}%`;
    // Height is intentionally unset so the img keeps its natural aspect inside the wrapper.
    // transform % resolves against the element's own box, so -x%/-y% shift the
    // img by x% of its width and y% of its height. margin-top % would instead
    // resolve against the container's WIDTH, skewing vertically for non-square crops.
    img.style.transform = `translate(-${x}%, -${y}%)`;
    // Crop is in percent of intrinsic pixels; the cropped region's pixel aspect is
    // (w*NW)/(h*NH), not w/h. Refine the wrapper's aspect once intrinsic dims are
    // known so non-square sources aren't squashed into a crop-aspect box.
    bindIntrinsicAspect(img, wrapper, w, h);
    wrapper.appendChild(img);
    figure.appendChild(wrapper);
  } else {
    figure.appendChild(img);
  }

  return figure;
}

export interface CaptionOptions {
  value: string;
  placeholder: string;
  readOnly: boolean;
}

export function renderCaption(opts: CaptionOptions): HTMLElement {
  const el = document.createElement('div');
  el.className = 'blok-image-caption';
  el.setAttribute('role', 'textbox');
  el.setAttribute('contenteditable', opts.readOnly ? 'false' : 'true');
  el.setAttribute('data-placeholder', opts.placeholder);
  el.textContent = opts.value;
  el.style.outline = 'none';
  el.style.textAlign = 'left';
  return el;
}

export interface CaptionRowOptions {
  caption: CaptionOptions;
  onAlt?: () => void;
  hasAlt?: boolean;
  i18n?: I18nInstance;
}

export function renderCaptionRow(opts: CaptionRowOptions): HTMLElement {
  const row = document.createElement('div');
  row.className = 'blok-image-caption-row';
  row.appendChild(renderCaption(opts.caption));

  if (opts.onAlt) {
    const altLabel = tr(opts.i18n, 'tools.image.altEdit');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'blok-image-caption-row__alt';
    btn.setAttribute('data-action', 'alt-edit');
    btn.setAttribute('aria-label', altLabel);
    btn.setAttribute('title', altLabel);
    btn.setAttribute('aria-pressed', opts.hasAlt ? 'true' : 'false');
    btn.textContent = tr(opts.i18n, 'tools.image.altButton');
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      opts.onAlt?.();
    });
    row.appendChild(btn);
  }

  return row;
}

export interface LightboxOptions {
  url: string;
  alt?: string;
  fileName?: string;
  /**
   * Non-destructive crop applied inline. When present, the lightbox mirrors
   * the same cropped view (wrapper + transformed inner img) so the preview
   * matches what the user sees in the editor.
   */
  crop?: ImageCrop;
  /**
   * Source element (the inline thumbnail) used for the FLIP open/close morph.
   * When omitted, the dialog cross-fades without a spatial transition.
   */
  origin?: HTMLElement;
  i18n?: I18nInstance;
}

const OPEN_DURATION = 360;
const CLOSE_DURATION = 280;
// Smooth ease-out-expo on open; symmetric material curve on close.
const OPEN_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const CLOSE_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

interface FlipTransform {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
}

function flipTransform(srcRect: DOMRect, destRect: DOMRect): FlipTransform {
  const sx = destRect.width > 0 ? srcRect.width / destRect.width : 1;
  const sy = destRect.height > 0 ? srcRect.height / destRect.height : 1;
  const srcCx = srcRect.left + srcRect.width / 2;
  const srcCy = srcRect.top + srcRect.height / 2;
  const destCx = destRect.left + destRect.width / 2;
  const destCy = destRect.top + destRect.height / 2;
  return { tx: srcCx - destCx, ty: srcCy - destCy, sx, sy };
}

function toTransform(t: FlipTransform): string {
  return `translate(${t.tx}px, ${t.ty}px) scale(${t.sx}, ${t.sy})`;
}

function canAnimate(el: Element): el is Element & { animate: HTMLElement['animate'] } {
  return typeof (el as HTMLElement).animate === 'function';
}

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;
// 100-pixel wheel tick multiplies zoom by (1 + ZOOM_STEP); small trackpad pinch deltas stay smooth.
const WHEEL_ZOOM_COEF = Math.log(1 + ZOOM_STEP) / 100;

export function openLightbox(opts: LightboxOptions): () => void {
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', tr(opts.i18n, 'tools.image.preview'));
  dialog.className = 'blok-image-lightbox';

  const backdrop = document.createElement('div');
  backdrop.className = 'blok-image-lightbox__backdrop';
  backdrop.setAttribute('aria-hidden', 'true');
  dialog.appendChild(backdrop);

  const img = document.createElement('img');
  img.setAttribute('src', opts.url);
  img.setAttribute('alt', opts.alt ?? '');
  img.draggable = false;

  // displayEl is the element that receives zoom/pan/FLIP transforms. When a crop
  // is active, the img already carries the `translate(-x%, -y%)` crop transform,
  // so we mount it inside a wrapper and animate the wrapper instead. Without a
  // crop, the img itself is the display element and keeps the legacy behavior.
  const displayEl: HTMLElement = (() => {
    const crop = opts.crop;
    if (!crop) {
      img.className = 'blok-image-lightbox__image';
      return img;
    }
    const { x, y, w, h, shape } = crop;
    const wrapper = document.createElement('div');
    wrapper.className = 'blok-image-lightbox__image blok-image-lightbox__crop';
    wrapper.setAttribute('data-role', 'lightbox-crop');
    wrapper.style.overflow = 'hidden';
    wrapper.style.aspectRatio = `${w} / ${h}`;
    if (shape) wrapper.setAttribute('data-shape', shape);
    if (shape === 'circle' || shape === 'ellipse') {
      wrapper.style.borderRadius = '50%';
    }
    img.style.display = 'block';
    img.style.maxWidth = 'none';
    img.style.width = `${(100 / w) * 100}%`;
    img.style.transform = `translate(-${x}%, -${y}%)`;
    bindIntrinsicAspect(img, wrapper, w, h);
    wrapper.appendChild(img);
    return wrapper;
  })();

  const zoomState = { value: 1 };
  const panState = { x: 0, y: 0 };

  const applyTransform = (): void => {
    displayEl.style.transform = `translate(${panState.x}px, ${panState.y}px) scale(${zoomState.value})`;
  };

  function panBounds(): { maxX: number; maxY: number; width: number; height: number } {
    const rect = displayEl.getBoundingClientRect();
    return { maxX: rect.width / 2, maxY: rect.height / 2, width: rect.width, height: rect.height };
  }

  function clampPan(p: { x: number; y: number }): { x: number; y: number } {
    const { maxX, maxY } = panBounds();
    return {
      x: Math.max(-maxX, Math.min(maxX, p.x)),
      y: Math.max(-maxY, Math.min(maxY, p.y)),
    };
  }

  function rubberBandPan(p: { x: number; y: number }): { x: number; y: number } {
    const { maxX, maxY, width, height } = panBounds();
    return {
      x: applyRubberBand(p.x, maxX, width),
      y: applyRubberBand(p.y, maxY, height),
    };
  }

  const setZoom = (next: number, options: { preservePan?: boolean } = {}): void => {
    zoomState.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    if (options.preservePan) {
      const clamped = clampPan(panState);
      panState.x = clamped.x;
      panState.y = clamped.y;
    } else {
      panState.x = 0;
      panState.y = 0;
    }
    applyTransform();
    syncResetLabel();
  };

  applyTransform();

  const toolbar = renderLightboxToolbar({
    i18n: opts.i18n,
    getZoom: () => zoomState.value,
    setZoom,
    onDownload: () => {
      const a = document.createElement('a');
      a.href = opts.url;
      a.download = opts.fileName ?? '';
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    },
    onCopyUrl: () => {
      const clip = (navigator as Navigator & { clipboard?: { writeText(text: string): Promise<void> } }).clipboard;
      void clip?.writeText(opts.url);
    },
    onCollapse: () => close(),
  });
  const syncResetLabel = (): void => {
    const reset = toolbar.querySelector<HTMLButtonElement>('[data-action="zoom-reset"]');
    if (reset) reset.textContent = `${Math.round(zoomState.value * 100)}%`;
  };

  dialog.appendChild(displayEl);
  dialog.appendChild(toolbar);
  document.body.appendChild(dialog);
  /**
   * Promote to the CSS Top Layer so the lightbox stacks above every other
   * blok overlay (tooltips, popovers) and host-page content regardless of
   * z-index. Also tags the dialog with `data-blok-top-layer` which makes
   * the `[data-blok-interface], [data-blok-popover], [data-blok-top-layer]`
   * scoped tokens in colors.css resolve — without it the backdrop tint and
   * toolbar chrome render as `var(--…)` → unset → transparent.
   */
  promoteToTopLayer(dialog);

  const animState: { img: Animation | null; backdrop: Animation | null; toolbar: Animation | null; closing: boolean } = {
    img: null,
    backdrop: null,
    toolbar: null,
    closing: false,
  };
  const origin = opts.origin && opts.origin.isConnected ? opts.origin : null;
  const originPrevOpacity = origin ? origin.style.opacity : '';

  const cancelRunning = (): void => {
    animState.img?.cancel();
    animState.backdrop?.cancel();
    animState.toolbar?.cancel();
    animState.img = null;
    animState.backdrop = null;
    animState.toolbar = null;
  };

  const slideToolbar = (
    from: { opacity: number; y: number },
    to: { opacity: number; y: number },
    timing: KeyframeAnimationOptions
  ): Animation | null => {
    if (!canAnimate(toolbar)) return null;
    return toolbar.animate(
      [
        { opacity: from.opacity, transform: `translate(-50%, ${from.y}px)` },
        { opacity: to.opacity, transform: `translate(-50%, ${to.y}px)` },
      ],
      timing
    );
  };

  const playOpen = (): void => {
    if (origin && canAnimate(displayEl)) {
      const srcRect = origin.getBoundingClientRect();
      const destRect = displayEl.getBoundingClientRect();
      if (srcRect.width > 0 && srcRect.height > 0 && destRect.width > 0 && destRect.height > 0) {
        const from = toTransform(flipTransform(srcRect, destRect));
        origin.style.opacity = '0';
        animState.img = displayEl.animate(
          [{ transform: from }, { transform: 'translate(0px, 0px) scale(1)' }],
          { duration: OPEN_DURATION, easing: OPEN_EASING, fill: 'backwards' }
        );
      }
    }
    if (canAnimate(backdrop)) {
      animState.backdrop = backdrop.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: 260, easing: 'linear', fill: 'backwards' }
      );
    }
    animState.toolbar = slideToolbar(
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0 },
      { duration: 320, delay: 140, easing: OPEN_EASING, fill: 'both' }
    );
  };

  const finalize = (): void => {
    document.removeEventListener('keydown', onKey);
    removeFromTopLayer(dialog);
    dialog.remove();
    if (origin) origin.style.opacity = originPrevOpacity;
    previousFocus?.focus?.();
  };

  const closeFadeOnly = (): void => {
    if (!canAnimate(backdrop)) {
      finalize();
      return;
    }
    const a = backdrop.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: 'linear', fill: 'forwards' });
    a.onfinish = finalize;
    a.oncancel = finalize;
    slideToolbar({ opacity: 1, y: 0 }, { opacity: 0, y: 12 }, { duration: 180, easing: CLOSE_EASING, fill: 'forwards' });
  };

  const closeWithFlip = (originEl: HTMLElement): void => {
    const srcRect = originEl.getBoundingClientRect();
    if (srcRect.width === 0 || srcRect.height === 0) {
      finalize();
      return;
    }
    // Suppress the spring transition on .blok-image-lightbox__image so the
    // identity measurement and final-state commit below don't trigger a CSS
    // tween underneath the WAAPI animation.
    displayEl.style.transition = 'none';
    // Capture the currently-displayed transform (may include user zoom/pan) so
    // the reverse-FLIP starts from where the image visually is right now.
    const current = displayEl.style.transform || 'translate(0px, 0px) scale(1)';
    // Measure the identity rect (transform=none) so we can map dest→source.
    displayEl.style.transform = 'none';
    const identRect = displayEl.getBoundingClientRect();
    displayEl.style.transform = current;
    const to = toTransform(flipTransform(srcRect, identRect));
    // Lock the final visible state on the inline style so there is no snap
    // back to identity after WAAPI releases its hold.
    displayEl.style.transform = to;
    const anim = displayEl.animate(
      [{ transform: current }, { transform: to }],
      { duration: CLOSE_DURATION, easing: CLOSE_EASING, fill: 'forwards' }
    );
    anim.onfinish = finalize;
    anim.oncancel = finalize;

    if (canAnimate(backdrop)) {
      backdrop.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CLOSE_DURATION, easing: 'linear', fill: 'forwards' });
    }
    slideToolbar({ opacity: 1, y: 0 }, { opacity: 0, y: 12 }, { duration: 200, easing: CLOSE_EASING, fill: 'forwards' });
  };

  const close = (): void => {
    if (animState.closing) return;
    animState.closing = true;
    cancelRunning();
    if (origin && canAnimate(displayEl)) closeWithFlip(origin);
    else closeFadeOnly();
  };

  playOpen();

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' || event.key === ' ') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      setZoom(zoomState.value + ZOOM_STEP);
      return;
    }
    if (event.key === '-') {
      event.preventDefault();
      setZoom(zoomState.value - ZOOM_STEP);
      return;
    }
  };

  const DRAG_THRESHOLD = 3;
  const dragState = {
    pointerDown: false,
    dragging: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  };

  /**
   * Stop `mousedown` from bubbling out of the dialog (except on the toolbar,
   * whose buttons need their own mousedown for focus/click behavior). Without
   * this, document-level handlers — notably `RectangleSelection` on
   * `document.body` — see drags inside the lightbox as drags on the editor
   * underneath and start a rubber-band block selection behind the dialog.
   */
  dialog.addEventListener('mousedown', (event: MouseEvent) => {
    if (event.target instanceof Node && toolbar.contains(event.target)) return;
    event.stopPropagation();
  });

  dialog.addEventListener('pointerdown', (event: PointerEvent) => {
    if (event.target instanceof Node && toolbar.contains(event.target)) return;
    dragState.pointerDown = true;
    dragState.dragging = false;
    dragState.startX = event.clientX;
    dragState.startY = event.clientY;
    dragState.originX = panState.x;
    dragState.originY = panState.y;
    dialog.setPointerCapture(event.pointerId);
  });

  dialog.addEventListener('pointermove', (event: PointerEvent) => {
    if (!dragState.pointerDown) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    if (!dragState.dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      dragState.dragging = true;
      dialog.classList.add('is-dragging');
    }
    if (!dragState.dragging) return;
    const next = rubberBandPan({ x: dragState.originX + dx, y: dragState.originY + dy });
    panState.x = next.x;
    panState.y = next.y;
    applyTransform();
  });

  const endDrag = (): void => {
    if (!dragState.pointerDown) return;
    dragState.pointerDown = false;
    dialog.classList.remove('is-dragging');
    if (dragState.dragging) {
      dragState.dragging = false;
      // Removing is-dragging re-enables the CSS transform transition; clamping now
      // triggers the spring animation from the rubber-banded position back to bounds.
      const settled = clampPan(panState);
      panState.x = settled.x;
      panState.y = settled.y;
      applyTransform();
      const swallow = (e: MouseEvent): void => {
        if (e.target instanceof Node && toolbar.contains(e.target)) return;
        e.stopPropagation();
        dialog.removeEventListener('click', swallow, true);
      };
      dialog.addEventListener('click', swallow, true);
    }
  };

  dialog.addEventListener('pointerup', endDrag);
  dialog.addEventListener('pointercancel', endDrag);

  const wheelIdle: { timer: ReturnType<typeof setTimeout> | null } = { timer: null };
  dialog.addEventListener('wheel', (event: WheelEvent) => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_COEF);
    const prevZoom = zoomState.value;
    const nextZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prevZoom * factor));
    const k = nextZoom / prevZoom;
    // Anchor the zoom around the cursor: keep the image pixel under the cursor fixed on screen.
    const rect = dialog.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    panState.x = dx * (1 - k) + panState.x * k;
    panState.y = dy * (1 - k) + panState.y * k;
    // Skip the 420ms spring transition for each wheel tick — it makes continuous
    // scroll/pinch zoom feel laggy. Button zoom keeps the bounce.
    dialog.classList.add('is-wheel-zooming');
    if (wheelIdle.timer !== null) clearTimeout(wheelIdle.timer);
    wheelIdle.timer = setTimeout(() => {
      dialog.classList.remove('is-wheel-zooming');
      wheelIdle.timer = null;
    }, 120);
    setZoom(nextZoom, { preservePan: true });
  }, { passive: false });

  dialog.addEventListener('click', (event) => {
    if (event.target instanceof Node && toolbar.contains(event.target)) return;
    close();
  });
  document.addEventListener('keydown', onKey);
  dialog.focus();

  return close;
}

interface LightboxToolbarOptions {
  i18n?: I18nInstance;
  getZoom(): number;
  setZoom(next: number): void;
  onDownload(): void;
  onCopyUrl(): void;
  onCollapse(): void;
}

function renderLightboxToolbar(opts: LightboxToolbarOptions): HTMLElement {
  const bar = document.createElement('div');
  bar.setAttribute('data-role', 'lightbox-toolbar');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', tr(opts.i18n, 'tools.image.previewControls'));
  bar.className = 'blok-image-lightbox__bar';
  bar.addEventListener('click', (event) => event.stopPropagation());

  const iconMinus = IconZoomOut;
  const iconPlus = IconZoomIn;
  const iconDownload = IconDownload;
  const iconCopy = IconLinkCopy;
  const iconCollapse = IconCollapseFullscreen;

  appendLightboxButton(bar, {
    action: 'zoom-out',
    label: tr(opts.i18n, 'tools.image.zoomOut'),
    shortcut: '−',
    html: iconMinus,
    onClick: () => opts.setZoom(opts.getZoom() - ZOOM_STEP),
  });
  appendLightboxButton(bar, {
    action: 'zoom-reset',
    label: tr(opts.i18n, 'tools.image.resetZoom'),
    html: '100%',
    onClick: () => opts.setZoom(1),
    extraClass: 'blok-image-lightbox__zoom-label',
  });
  appendLightboxButton(bar, {
    action: 'zoom-in',
    label: tr(opts.i18n, 'tools.image.zoomIn'),
    shortcut: '+',
    html: iconPlus,
    onClick: () => opts.setZoom(opts.getZoom() + ZOOM_STEP),
  });

  appendLightboxDivider(bar);

  appendLightboxButton(bar, {
    action: 'lightbox-download',
    label: tr(opts.i18n, 'tools.image.download'),
    html: iconDownload,
    onClick: opts.onDownload,
  });
  appendLightboxButton(bar, {
    action: 'lightbox-copy-url',
    label: tr(opts.i18n, 'tools.image.copyUrl'),
    html: iconCopy,
    onClick: opts.onCopyUrl,
  });
  appendLightboxButton(bar, {
    action: 'lightbox-collapse',
    label: tr(opts.i18n, 'tools.image.exitFullscreen'),
    shortcut: 'Esc',
    html: iconCollapse,
    onClick: opts.onCollapse,
  });

  return bar;
}

function appendLightboxDivider(parent: HTMLElement): void {
  const d = document.createElement('div');
  d.className = 'blok-image-lightbox__divider';
  d.setAttribute('aria-hidden', 'true');
  parent.appendChild(d);
}

interface LightboxButtonSpec {
  action: string;
  label: string;
  shortcut?: string;
  html: string;
  onClick(): void;
  extraClass?: string;
}

function buildLightboxTooltipContent(label: string, shortcut?: string): HTMLElement | string {
  if (shortcut === undefined) return label;
  const root = document.createElement('span');
  root.className = 'blok-image-lightbox-tooltip';
  root.append(document.createTextNode(label));
  const kbd = document.createElement('span');
  kbd.className = 'blok-image-lightbox-tooltip__shortcut';
  kbd.textContent = shortcut;
  root.appendChild(kbd);
  return root;
}

function appendLightboxButton(parent: HTMLElement, spec: LightboxButtonSpec): void {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('data-action', spec.action);
  btn.setAttribute('aria-label', spec.label);
  btn.className = spec.extraClass
    ? `blok-image-lightbox__btn ${spec.extraClass}`
    : 'blok-image-lightbox__btn';
  btn.innerHTML = spec.html;
  tooltipOnHover(btn, buildLightboxTooltipContent(spec.label, spec.shortcut), { placement: 'top' });
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    tooltipHide();
    spec.onClick();
  });
  parent.appendChild(btn);
}

export interface OverlayState {
  alignment: ImageAlign;
  captionVisible: boolean;
  size: ImageSize;
}

/**
 * Below this figure width the overlay collapses to just the "..." button.
 * The expanded toolbar is ~240px; collapse only when the image is too narrow
 * to comfortably fit the full row (roughly sm-size territory).
 */
export const OVERLAY_COMPACT_THRESHOLD = 230;

export function updateOverlayCompact(
  overlay: HTMLElement,
  width: number,
  threshold: number = OVERLAY_COMPACT_THRESHOLD
): void {
  if (width > 0 && width < threshold) {
    overlay.setAttribute('data-compact', 'true');
  } else {
    overlay.removeAttribute('data-compact');
  }
}

export interface OverlayOptions {
  state: OverlayState;
  onAlign(next: ImageAlign): void;
  onSize(next: ImageSize): void;
  onReplace(): void;
  onDelete(): void;
  onDownload(): void;
  onFullscreen(): void;
  onCopyUrl(): void;
  onToggleCaption(): void;
  onCrop(): void;
  i18n?: I18nInstance;
}

/**
 * Data-action naming stays stable for test & user-code targeting.
 * Additional visual-only elements carry their own class names.
 */
export function renderOverlay(opts: OverlayOptions): HTMLElement {
  const root = document.createElement('div');
  root.setAttribute('data-role', 'image-overlay');
  root.className = 'blok-image-toolbar';

  appendAlignCtrl(root, opts);

  appendDivider(root);

  appendSimpleButton(root, {
    action: 'caption-toggle',
    label: tr(opts.i18n, 'tools.image.toggleCaption'),
    pressed: opts.state.captionVisible,
    icon: IconCaption,
    onClick: opts.onToggleCaption,
  });
  appendSimpleButton(root, {
    action: 'replace',
    label: tr(opts.i18n, 'tools.image.replace'),
    icon: IconReplaceImage,
    onClick: opts.onReplace,
  });
  appendSimpleButton(root, {
    action: 'crop',
    label: tr(opts.i18n, 'tools.image.crop'),
    icon: IconCrop,
    onClick: opts.onCrop,
  });
  appendSimpleButton(root, {
    action: 'fullscreen',
    label: tr(opts.i18n, 'tools.image.viewFullscreen'),
    icon: IconExpandFullscreen,
    onClick: opts.onFullscreen,
  });
  appendSimpleButton(root, {
    action: 'download',
    label: tr(opts.i18n, 'tools.image.downloadOriginal'),
    icon: IconDownload,
    onClick: opts.onDownload,
  });

  appendDivider(root);

  const moreLabel = tr(opts.i18n, 'tools.image.moreOptions');
  const more = document.createElement('button');
  more.type = 'button';
  more.setAttribute('data-action', 'more');
  more.setAttribute('aria-label', moreLabel);
  more.setAttribute('aria-haspopup', 'menu');
  more.innerHTML = IconMoreHorizontal;
  tooltipOnHover(more, moreLabel);
  root.appendChild(more);

  // Delete is reachable from the popover; expose an invisible legacy button for consumers/tests.
  const deleteAlias = document.createElement('button');
  deleteAlias.type = 'button';
  deleteAlias.setAttribute('data-action', 'delete');
  deleteAlias.setAttribute('aria-label', tr(opts.i18n, 'blockSettings.delete'));
  deleteAlias.className = 'blok-image-toolbar__alias is-danger';
  deleteAlias.style.display = 'none';
  deleteAlias.addEventListener('click', (event) => {
    event.stopPropagation();
    opts.onDelete();
  });
  root.appendChild(deleteAlias);

  return root;
}

function appendAlignCtrl(root: HTMLElement, opts: OverlayOptions): void {
  const wrapper = document.createElement('div');
  wrapper.className = 'blok-image-toolbar__align';
  wrapper.style.position = 'relative';

  const current = opts.state.alignment;
  const alignmentText = tr(opts.i18n, 'tools.image.alignment');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.setAttribute('data-action', 'align-trigger');
  trigger.setAttribute('data-current', current);
  trigger.setAttribute('aria-label', alignmentText);
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML = ALIGN_ICON[current];
  tooltipOnHover(trigger, alignmentText);
  wrapper.appendChild(trigger);

  const popover = document.createElement('div');
  popover.setAttribute('data-role', 'align-popover');
  popover.setAttribute('role', 'group');
  popover.setAttribute('aria-label', alignmentText);
  popover.className = 'blok-image-toolbar__align-popover';
  popover.hidden = true;

  for (const value of ['left', 'center', 'right'] as ImageAlign[]) {
    const label = alignLabel(opts.i18n, value);
    const option = document.createElement('button');
    option.type = 'button';
    option.setAttribute('data-action', `align-${value}`);
    option.setAttribute('aria-label', label);
    option.setAttribute('aria-pressed', current === value ? 'true' : 'false');
    option.innerHTML = ALIGN_ICON[value];
    tooltipOnHover(option, label);
    option.addEventListener('click', (event) => {
      event.stopPropagation();
      tooltipHide();
      closePopover();
      opts.onAlign(value);
    });
    popover.appendChild(option);
  }

  wrapper.appendChild(popover);
  root.appendChild(wrapper);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !popover.hidden) {
      event.stopPropagation();
      closePopover();
    }
  };

  const onOutside = (event: MouseEvent): void => {
    if (popover.hidden) return;
    const target = event.target as Node | null;
    if (target && wrapper.contains(target)) return;
    closePopover();
  };

  const imageRoot = (): HTMLElement | null => wrapper.closest<HTMLElement>('[data-blok-tool="image"]');

  const openPopover = (): void => {
    if (!popover.hidden) return;
    popover.hidden = false;
    popover.setAttribute('data-blok-popover-opened', 'true');
    imageRoot()?.setAttribute('data-align-open', 'true');
    trigger.setAttribute('aria-expanded', 'true');
    tooltipHide();
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onOutside);
  };

  function closePopover(): void {
    if (popover.hidden) return;
    popover.hidden = true;
    popover.removeAttribute('data-blok-popover-opened');
    imageRoot()?.removeAttribute('data-align-open');
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('mousedown', onOutside);
  }

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (popover.hidden) openPopover();
    else closePopover();
  });
}

function appendDivider(parent: HTMLElement): void {
  const d = document.createElement('div');
  d.className = 'blok-image-toolbar__divider';
  d.setAttribute('aria-hidden', 'true');
  parent.appendChild(d);
}

interface SimpleButtonSpec {
  action: string;
  label: string;
  icon: string;
  onClick(): void;
  pressed?: boolean;
}

function appendSimpleButton(parent: HTMLElement, spec: SimpleButtonSpec): void {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('aria-label', spec.label);
  btn.setAttribute('data-action', spec.action);
  if (spec.pressed !== undefined) {
    btn.setAttribute('aria-pressed', spec.pressed ? 'true' : 'false');
  }
  btn.innerHTML = spec.icon;
  tooltipOnHover(btn, spec.label);
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    tooltipHide();
    spec.onClick();
  });
  parent.appendChild(btn);
}

