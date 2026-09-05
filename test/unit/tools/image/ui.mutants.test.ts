import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/components/utils/tooltip', () => ({
  onHover: vi.fn(),
  hide: vi.fn(),
  show: vi.fn(),
}));

vi.mock('../../../../src/tools/image/download', () => ({
  downloadImage: vi.fn(() => Promise.resolve()),
}));

import {
  applyAutoFull,
  isTinyImage,
  openLightbox,
  renderCaption,
  renderCaptionRow,
  renderImage,
  renderOverlay,
  updateOverlayTier,
} from '../../../../src/tools/image/ui';
import type { LightboxOptions, OverlayOptions } from '../../../../src/tools/image/ui';
import { downloadImage } from '../../../../src/tools/image/download';
import * as tooltip from '../../../../src/components/utils/tooltip';
import { simulateClick, simulateKeydown, simulateMousedown } from '../../../helpers/simulate';

const OPEN_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const CLOSE_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

/**
 * jsdom ships no WAAPI, so `canAnimate()` is false and every FLIP / slide
 * branch is skipped. Recording fake animations is what makes the open, close
 * and navigate transforms assertable at all.
 */
class FakeAnimation {
  public onfinish: (() => void) | null = null;

  public oncancel: (() => void) | null = null;

  public cancelled = false;

  public finished = false;

  public readonly target: Element;

  public readonly keyframes: Keyframe[];

  public readonly options: KeyframeAnimationOptions;

  public constructor(target: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    this.target = target;
    this.keyframes = keyframes;
    this.options = options;
  }

  public cancel(): void {
    this.cancelled = true;
  }

  public finish(): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    this.onfinish?.();
  }
}

const animations: FakeAnimation[] = [];

const EMPTY_RECT: DOMRect = {
  x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}),
};

interface RectRule {
  match(el: Element): boolean;
  rect: DOMRect;
}

const rectRules: RectRule[] = [];

function planRect(match: (el: Element) => boolean, partial: Partial<DOMRect>): void {
  rectRules.unshift({ match, rect: { ...EMPTY_RECT, ...partial } });
}

function planDisplayRect(partial: Partial<DOMRect>): void {
  planRect((el) => el.classList.contains('blok-image-lightbox__image'), partial);
}

const originalRect = Element.prototype.getBoundingClientRect;

/** Mutable source for the stubbed img intrinsics; tests reassign between load events. */
const intrinsics = { complete: false, naturalWidth: 0, naturalHeight: 0 };

const imageDescriptors: Array<[string, PropertyDescriptor | undefined]> = [
  ['complete', Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'complete')],
  ['naturalWidth', Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalWidth')],
  ['naturalHeight', Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalHeight')],
];

const writeText = vi.fn(() => Promise.resolve());

const opened: Array<() => void> = [];

const onHoverMock = vi.mocked(tooltip.onHover);
const hideMock = vi.mocked(tooltip.hide);
const downloadMock = vi.mocked(downloadImage);

beforeEach(() => {
  vi.clearAllMocks();
  animations.length = 0;
  rectRules.length = 0;
  opened.length = 0;
  intrinsics.complete = false;
  intrinsics.naturalWidth = 0;
  intrinsics.naturalHeight = 0;

  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    writable: true,
    value: function fakeAnimate(this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions): FakeAnimation {
      const anim = new FakeAnimation(this, keyframes, options);

      animations.push(anim);

      return anim;
    },
  });

  Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
    configurable: true,
    writable: true,
    value: function stubbedRect(this: Element): DOMRect {
      return rectRules.find((rule) => rule.match(this))?.rect ?? EMPTY_RECT;
    },
  });

  Object.defineProperty(HTMLImageElement.prototype, 'complete', {
    configurable: true,
    get: () => intrinsics.complete,
  });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
    configurable: true,
    get: () => intrinsics.naturalWidth,
  });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', {
    configurable: true,
    get: () => intrinsics.naturalHeight,
  });

  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

afterEach(() => {
  for (const close of opened) {
    close();
  }
  flushAnimations();
  document.body.replaceChildren();

  Reflect.deleteProperty(Element.prototype, 'animate');
  Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
    configurable: true,
    writable: true,
    value: originalRect,
  });
  for (const [key, descriptor] of imageDescriptors) {
    if (descriptor) {
      Object.defineProperty(HTMLImageElement.prototype, key, descriptor);
    }
  }
  Reflect.deleteProperty(navigator, 'clipboard');

  vi.restoreAllMocks();
});

function flushAnimations(): void {
  for (const anim of [...animations]) {
    anim.finish();
  }
}

function animationsFor(el: Element): FakeAnimation[] {
  return animations.filter((anim) => anim.target === el);
}

function firstAnimationFor(el: Element): FakeAnimation {
  const [anim] = animationsFor(el);

  if (!anim) {
    throw new Error('no animation recorded for element');
  }

  return anim;
}

function open(opts: LightboxOptions): () => void {
  const close = openLightbox(opts);

  opened.push(close);

  const dialog = dialogEl();

  Object.defineProperty(dialog, 'setPointerCapture', { configurable: true, value: () => undefined });
  Object.defineProperty(dialog, 'releasePointerCapture', { configurable: true, value: () => undefined });

  return close;
}

function required<T extends Element>(el: T | null, what: string): T {
  if (!el) {
    throw new Error(`${what} missing`);
  }

  return el;
}

function dialogEl(): HTMLElement {
  return required(document.body.querySelector<HTMLElement>('.blok-image-lightbox'), 'dialog');
}

function displayEl(): HTMLElement {
  return required(document.body.querySelector<HTMLElement>('.blok-image-lightbox__image'), 'display element');
}

function backdropEl(): HTMLElement {
  return required(document.body.querySelector<HTMLElement>('.blok-image-lightbox__backdrop'), 'backdrop');
}

function toolbarEl(): HTMLElement {
  return required(document.body.querySelector<HTMLElement>('[data-role="lightbox-toolbar"]'), 'toolbar');
}

function navEl(): HTMLElement {
  return required(document.body.querySelector<HTMLElement>('[data-role="lightbox-nav"]'), 'nav');
}

function action(root: ParentNode, name: string): HTMLButtonElement {
  return required(root.querySelector<HTMLButtonElement>(`[data-action="${name}"]`), `button ${name}`);
}

function hoverArg(el: Element, index: 1 | 2): unknown {
  const call = onHoverMock.mock.calls.find((entry) => entry[0] === el);

  if (!call) {
    throw new Error('no tooltip binding for element');
  }

  return call[index];
}

function shortcutText(el: Element): string | null {
  const content = hoverArg(el, 1);

  if (!(content instanceof HTMLElement)) {
    return null;
  }

  return content.querySelector('.blok-image-lightbox-tooltip__shortcut')?.textContent ?? null;
}

function pointer(type: string, x: number, y: number): PointerEvent {
  return new PointerEvent(type, { pointerId: 1, clientX: x, clientY: y, bubbles: true });
}

function wheel(deltaY: number, init: WheelEventInit = {}): WheelEvent {
  return new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true, ...init });
}

function overlayOptions(overrides: Partial<OverlayOptions> = {}): OverlayOptions {
  return {
    state: { alignment: 'center', captionVisible: false, size: 'md' },
    onAlign: vi.fn(),
    onSize: vi.fn(),
    onReplace: vi.fn(),
    onDelete: vi.fn(),
    onDownload: vi.fn(),
    onFullscreen: vi.fn(),
    onCopyUrl: vi.fn(),
    onToggleCaption: vi.fn(),
    onCrop: vi.fn(),
    ...overrides,
  };
}

function imgOf(figure: HTMLElement): HTMLImageElement {
  return required(figure.querySelector('img'), 'img');
}

describe('renderImage figure chrome', () => {
  it('keeps a saved width of 0 on the figure so a zero-width layout is not silently dropped', () => {
    expect(renderImage({ url: 'u', width: 0 }).style.width).toBe('0%');
  });

  it('writes the stored width as a percentage on the figure', () => {
    expect(renderImage({ url: 'u', width: 42 }).style.width).toBe('42%');
  });

  it('centres the image when the saved data carries no alignment', () => {
    expect(renderImage({ url: 'u' }).style.textAlign).toBe('center');
  });

  it('tags the figure so the tool can find it back in the DOM', () => {
    expect(renderImage({ url: 'u' }).getAttribute('data-role')).toBe('image-figure');
  });

  it('zeroes the figure margin so the alignment box hugs the image', () => {
    expect(renderImage({ url: 'u' }).style.margin).toBe('0px');
  });

  it('positions the figure relative so overlay controls anchor to it', () => {
    expect(renderImage({ url: 'u' }).style.position).toBe('relative');
  });

  it('turns off native dragging so the pointer drag manager owns the gesture', () => {
    expect(imgOf(renderImage({ url: 'u' })).draggable).toBe(false);
  });
});

describe('renderImage crop rendering', () => {
  const crop = { x: 10, y: 20, w: 50, h: 25 };

  function wrapperOf(figure: HTMLElement): HTMLElement {
    return required(figure.querySelector<HTMLElement>('[data-role="image-crop"]'), 'crop wrapper');
  }

  it('names the crop wrapper so the crop stylesheet applies', () => {
    expect(wrapperOf(renderImage({ url: 'u', crop })).className).toBe('blok-image-crop');
  });

  it('clips the overflowing image to the crop window', () => {
    expect(wrapperOf(renderImage({ url: 'u', crop })).style.overflow).toBe('hidden');
  });

  it('positions the crop wrapper relative so the shifted image stays inside it', () => {
    expect(wrapperOf(renderImage({ url: 'u', crop })).style.position).toBe('relative');
  });

  it('falls back to the crop-region aspect before intrinsic dimensions resolve', () => {
    expect(wrapperOf(renderImage({ url: 'u', crop: { x: 0, y: 0, w: 4, h: 3 } })).style.aspectRatio).toBe('4 / 3');
  });

  it('stretches the crop wrapper to the available width', () => {
    expect(wrapperOf(renderImage({ url: 'u', crop })).style.width).toBe('100%');
  });

  it('leaves data-shape off a crop with no shape rather than writing an undefined one', () => {
    expect(wrapperOf(renderImage({ url: 'u', crop })).hasAttribute('data-shape')).toBe(false);
  });

  it('records the crop shape so shape-specific styling applies', () => {
    expect(wrapperOf(renderImage({ url: 'u', crop: { ...crop, shape: 'circle' } })).getAttribute('data-shape')).toBe('circle');
  });

  it('rounds a circle crop into a disc', () => {
    expect(wrapperOf(renderImage({ url: 'u', crop: { ...crop, shape: 'circle' } })).style.borderRadius).toBe('50%');
  });

  it('leaves a rect crop square', () => {
    expect(wrapperOf(renderImage({ url: 'u', crop: { ...crop, shape: 'rect' } })).style.borderRadius).toBe('');
  });

  it('makes the cropped image a block so the wrapper height follows it', () => {
    expect(imgOf(renderImage({ url: 'u', crop })).style.display).toBe('block');
  });

  it('scales the source by the inverse of the crop width so the crop window is filled', () => {
    expect(imgOf(renderImage({ url: 'u', crop })).style.width).toBe('200%');
  });

  it('shifts the source by the crop offset in its own percentage box', () => {
    expect(imgOf(renderImage({ url: 'u', crop })).style.transform).toBe('translate(-10%, -20%)');
  });
});

describe('renderImage intrinsic aspect binding', () => {
  const crop = { x: 0, y: 0, w: 4, h: 3 };

  function wrapperOf(figure: HTMLElement): HTMLElement {
    return required(figure.querySelector<HTMLElement>('[data-role="image-crop"]'), 'crop wrapper');
  }

  it('refines the wrapper aspect from intrinsic pixels once a decoded image is rendered', () => {
    intrinsics.complete = true;
    intrinsics.naturalWidth = 200;
    intrinsics.naturalHeight = 100;

    expect(wrapperOf(renderImage({ url: 'u', crop })).style.aspectRatio).toBe('800 / 300');
  });

  it('keeps the fallback aspect while the source has no height yet', () => {
    intrinsics.complete = true;
    intrinsics.naturalWidth = 200;
    intrinsics.naturalHeight = 0;

    expect(wrapperOf(renderImage({ url: 'u', crop })).style.aspectRatio).toBe('4 / 3');
  });

  it('keeps the fallback aspect while the source has no width yet', () => {
    intrinsics.complete = true;
    intrinsics.naturalWidth = 0;
    intrinsics.naturalHeight = 100;

    expect(wrapperOf(renderImage({ url: 'u', crop })).style.aspectRatio).toBe('4 / 3');
  });

  it('waits for the load event when the source has not decoded yet', () => {
    intrinsics.complete = false;
    intrinsics.naturalWidth = 200;
    intrinsics.naturalHeight = 100;

    const figure = renderImage({ url: 'u', crop });

    expect(wrapperOf(figure).style.aspectRatio).toBe('4 / 3');

    imgOf(figure).dispatchEvent(new Event('load'));

    expect(wrapperOf(figure).style.aspectRatio).toBe('800 / 300');
  });

  it('stops listening after the first load so a later re-decode cannot re-write the aspect', () => {
    intrinsics.complete = false;
    intrinsics.naturalWidth = 200;
    intrinsics.naturalHeight = 100;

    const figure = renderImage({ url: 'u', crop });
    const img = imgOf(figure);

    img.dispatchEvent(new Event('load'));
    intrinsics.naturalWidth = 400;
    img.dispatchEvent(new Event('load'));

    expect(wrapperOf(figure).style.aspectRatio).toBe('800 / 300');
  });
});

describe('renderCaption', () => {
  it('declares the textbox contract while the caption is editable', () => {
    const el = renderCaption({ value: 'v', placeholder: 'p', readOnly: false });

    expect(el.getAttribute('contenteditable')).toBe('true');
    expect(el.getAttribute('role')).toBe('textbox');
    expect(el.getAttribute('aria-multiline')).toBe('true');
    expect(el.getAttribute('aria-label')).toBe('p');
  });

  it('drops the textbox contract in read-only so aria-multiline is not orphaned', () => {
    const el = renderCaption({ value: 'v', placeholder: 'p', readOnly: true });

    expect(el.getAttribute('contenteditable')).toBe('false');
    expect(el.hasAttribute('role')).toBe(false);
    expect(el.hasAttribute('aria-multiline')).toBe(false);
    expect(el.hasAttribute('aria-label')).toBe(false);
  });

  it('renders the stored caption text', () => {
    expect(renderCaption({ value: 'hello', placeholder: 'p', readOnly: false }).textContent).toBe('hello');
  });

  it('suppresses the focus ring so the caption reads as body text', () => {
    expect(renderCaption({ value: 'v', placeholder: 'p', readOnly: false }).style.outline).toBe('none');
  });
});

describe('renderCaptionRow', () => {
  it('omits the alt button when the host wires no alt handler', () => {
    const row = renderCaptionRow({ caption: { value: '', placeholder: 'p', readOnly: false } });

    expect(row.querySelector('[data-action="alt-edit"]')).toBeNull();
  });

  it('labels the alt button and marks it pressed when alt text exists', () => {
    const row = renderCaptionRow({
      caption: { value: '', placeholder: 'p', readOnly: false },
      onAlt: vi.fn(),
      hasAlt: true,
    });
    const btn = action(row, 'alt-edit');

    expect(btn.type).toBe('button');
    expect(btn.className).toBe('blok-image-caption-row__alt');
    expect(btn.getAttribute('aria-label')).toBe('Edit alt text');
    expect(btn.getAttribute('title')).toBe('Edit alt text');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.textContent).toBe('Alt');
  });

  it('marks the alt button unpressed when the image has no alt text', () => {
    const row = renderCaptionRow({
      caption: { value: '', placeholder: 'p', readOnly: false },
      onAlt: vi.fn(),
    });

    expect(action(row, 'alt-edit').getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps the alt click inside the row so the block below does not also react', () => {
    const host = document.createElement('div');
    const outer = vi.fn();
    const row = renderCaptionRow({
      caption: { value: '', placeholder: 'p', readOnly: false },
      onAlt: vi.fn(),
    });

    host.appendChild(row);
    host.addEventListener('click', outer);
    action(row, 'alt-edit').click();

    expect(outer).not.toHaveBeenCalled();
  });

  it('invokes the alt handler on click', () => {
    const onAlt = vi.fn();
    const row = renderCaptionRow({ caption: { value: '', placeholder: 'p', readOnly: false }, onAlt });

    action(row, 'alt-edit').click();

    expect(onAlt).toHaveBeenCalledTimes(1);
  });

  it('survives a host that clears its alt handler after render', () => {
    const opts = {
      caption: { value: '', placeholder: 'p', readOnly: false },
      onAlt: vi.fn(),
    };
    const row = renderCaptionRow(opts);

    opts.onAlt = undefined as unknown as () => void;

    expect(() => action(row, 'alt-edit').click()).not.toThrow();
  });
});

describe('isTinyImage', () => {
  it('treats an image exactly at the height threshold as tall enough', () => {
    expect(isTinyImage(800, 80, 800)).toBe(false);
  });

  it('treats an image one pixel below the threshold as tiny', () => {
    expect(isTinyImage(800, 79, 800)).toBe(true);
  });

  it('refuses to classify an image with no intrinsic height', () => {
    expect(isTinyImage(800, 0, 800)).toBe(false);
  });

  it('refuses to classify an image with no intrinsic width', () => {
    expect(isTinyImage(0, 600, 800)).toBe(false);
  });

  it('refuses to classify against an unmeasured container', () => {
    expect(isTinyImage(800, 600, 0)).toBe(false);
  });

  it('honours a caller-supplied height threshold', () => {
    expect(isTinyImage(800, 100, 800, 120)).toBe(true);
  });
});

describe('applyAutoFull', () => {
  it('flags a banner-shaped image for full-width layout', () => {
    const root = document.createElement('div');

    applyAutoFull(root, { naturalWidth: 800, naturalHeight: 40 }, 800);

    expect(root.getAttribute('data-auto-full')).toBe('true');
  });

  it('clears a stale flag when the image is tall enough', () => {
    const root = document.createElement('div');

    root.setAttribute('data-auto-full', 'true');
    applyAutoFull(root, { naturalWidth: 800, naturalHeight: 800 }, 800);

    expect(root.hasAttribute('data-auto-full')).toBe(false);
  });
});

describe('updateOverlayTier', () => {
  function tierOf(width: number, height?: number): string | null {
    const overlay = document.createElement('div');

    updateOverlayTier(overlay, width, height);

    return overlay.getAttribute('data-tier');
  }

  it('collapses one pixel below the compact width', () => {
    expect(tierOf(229)).toBe('compact');
  });

  it('stays medium exactly at the compact width', () => {
    expect(tierOf(230)).toBe('medium');
  });

  it('stays medium one pixel below the medium width', () => {
    expect(tierOf(359)).toBe('medium');
  });

  it('goes full exactly at the medium width', () => {
    expect(tierOf(360)).toBe('full');
  });

  it('treats an unmeasured figure as full rather than compact', () => {
    expect(tierOf(0)).toBe('full');
  });

  it('collapses one pixel below the compact height', () => {
    expect(tierOf(800, 79)).toBe('compact');
  });

  it('stays full exactly at the compact height', () => {
    expect(tierOf(800, 80)).toBe('full');
  });

  it('ignores an unmeasured height', () => {
    expect(tierOf(800, 0)).toBe('full');
  });

  it('mirrors the compact tier onto the legacy data-compact alias', () => {
    const overlay = document.createElement('div');

    updateOverlayTier(overlay, 100);
    expect(overlay.getAttribute('data-compact')).toBe('true');

    updateOverlayTier(overlay, 800);
    expect(overlay.hasAttribute('data-compact')).toBe(false);
  });
});

describe('renderOverlay', () => {
  it('tags the overlay root so the tool can find its own toolbar', () => {
    expect(renderOverlay(overlayOptions()).getAttribute('data-role')).toBe('image-overlay');
  });

  it('renders the alignment control before the first divider', () => {
    const root = renderOverlay(overlayOptions());

    expect(root.querySelector('.blok-image-toolbar__align')).not.toBeNull();
  });

  it('separates the alignment control from the action buttons with dividers', () => {
    const root = renderOverlay(overlayOptions());

    expect(root.querySelectorAll('.blok-image-toolbar__divider')).toHaveLength(2);
  });

  it('labels every action button with its localized name', () => {
    const root = renderOverlay(overlayOptions());
    const labels = ['caption-toggle', 'replace', 'crop', 'fullscreen', 'download'].map(
      (name) => action(root, name).getAttribute('aria-label')
    );

    expect(labels).toEqual([
      'Toggle caption',
      'Replace image',
      'Crop',
      'View full screen',
      'Download original',
    ]);
  });

  it('reflects a visible caption on the toggle button', () => {
    const root = renderOverlay(overlayOptions({ state: { alignment: 'center', captionVisible: true, size: 'md' } }));

    expect(action(root, 'caption-toggle').getAttribute('aria-pressed')).toBe('true');
  });

  it('reflects a hidden caption on the toggle button', () => {
    const root = renderOverlay(overlayOptions());

    expect(action(root, 'caption-toggle').getAttribute('aria-pressed')).toBe('false');
  });

  it('leaves aria-pressed off buttons that are not toggles', () => {
    const root = renderOverlay(overlayOptions());

    expect(action(root, 'replace').hasAttribute('aria-pressed')).toBe(false);
  });

  it('routes each action button to its own handler', () => {
    const opts = overlayOptions();
    const root = renderOverlay(opts);

    action(root, 'caption-toggle').click();
    action(root, 'replace').click();
    action(root, 'crop').click();
    action(root, 'fullscreen').click();
    action(root, 'download').click();

    expect(opts.onToggleCaption).toHaveBeenCalledTimes(1);
    expect(opts.onReplace).toHaveBeenCalledTimes(1);
    expect(opts.onCrop).toHaveBeenCalledTimes(1);
    expect(opts.onFullscreen).toHaveBeenCalledTimes(1);
    expect(opts.onDownload).toHaveBeenCalledTimes(1);
  });

  it('hides the tooltip before running an action so it cannot outlive the click', () => {
    const root = renderOverlay(overlayOptions());

    action(root, 'replace').click();

    expect(hideMock).toHaveBeenCalled();
  });

  it('keeps an action click inside the overlay', () => {
    const host = document.createElement('div');
    const outer = vi.fn();
    const root = renderOverlay(overlayOptions());

    host.appendChild(root);
    host.addEventListener('click', outer);
    action(root, 'replace').click();

    expect(outer).not.toHaveBeenCalled();
  });

  it('binds a tooltip to each action button carrying that button own label', () => {
    const root = renderOverlay(overlayOptions());
    const replace = action(root, 'replace');

    expect(hoverArg(replace, 1)).toBe('Replace image');
  });

  it('describes the overflow trigger as a menu opener', () => {
    const root = renderOverlay(overlayOptions());
    const more = action(root, 'more');

    expect(more.type).toBe('button');
    expect(more.getAttribute('aria-label')).toBe('More options');
    expect(more.getAttribute('aria-haspopup')).toBe('menu');
    expect(more.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps every overlay control out of an enclosing form submit', () => {
    const root = renderOverlay(overlayOptions());

    expect(action(root, 'replace').type).toBe('button');
    expect(action(root, 'delete').type).toBe('button');
    expect(action(root, 'align-trigger').type).toBe('button');
    expect(action(root, 'align-left').type).toBe('button');
  });

  it('keeps the legacy delete button present but invisible', () => {
    const root = renderOverlay(overlayOptions());
    const alias = action(root, 'delete');

    expect(alias.style.display).toBe('none');
    expect(alias.getAttribute('aria-label')).toBe('Delete');
    expect(alias.className).toBe('blok-image-toolbar__alias is-danger');
  });

  it('deletes the block from the legacy alias without bubbling the click', () => {
    const host = document.createElement('div');
    const outer = vi.fn();
    const opts = overlayOptions();
    const root = renderOverlay(opts);

    host.appendChild(root);
    host.addEventListener('click', outer);
    action(root, 'delete').click();

    expect(opts.onDelete).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });
});

describe('renderOverlay alignment popover', () => {
  function mount(opts: OverlayOptions): { root: HTMLElement; toolRoot: HTMLElement } {
    const toolRoot = document.createElement('div');

    toolRoot.setAttribute('data-blok-tool', 'image');
    const root = renderOverlay(opts);

    toolRoot.appendChild(root);
    document.body.appendChild(toolRoot);

    return { root, toolRoot };
  }

  it('anchors the alignment popover to its own wrapper', () => {
    const { root } = mount(overlayOptions());
    const wrapper = required(root.querySelector<HTMLElement>('.blok-image-toolbar__align'), 'align wrapper');
    const popover = required(root.querySelector<HTMLElement>('[data-role="align-popover"]'), 'popover');

    expect(wrapper.style.position).toBe('relative');
    expect(popover.className).toBe('blok-image-toolbar__align-popover');
    expect(popover.getAttribute('role')).toBe('group');
    expect(popover.getAttribute('aria-label')).toBe('Alignment');
  });

  it('keeps the alignment clicks inside the overlay', () => {
    const outer = vi.fn();
    const { root, toolRoot } = mount(overlayOptions());

    toolRoot.addEventListener('click', outer);
    action(root, 'align-trigger').click();
    action(root, 'align-left').click();
    toolRoot.removeEventListener('click', outer);

    expect(outer).not.toHaveBeenCalled();
  });

  it('hides the tooltip when the alignment popover takes over', () => {
    const { root } = mount(overlayOptions());

    action(root, 'align-trigger').click();

    expect(hideMock).toHaveBeenCalled();
  });

  it('shows the current alignment on the trigger', () => {
    const { root } = mount(overlayOptions({ state: { alignment: 'right', captionVisible: false, size: 'md' } }));
    const trigger = action(root, 'align-trigger');

    expect(trigger.getAttribute('data-current')).toBe('right');
    expect(trigger.getAttribute('aria-label')).toBe('Alignment');
    expect(trigger.getAttribute('aria-haspopup')).toBe('true');
  });

  it('marks only the active option as pressed', () => {
    const { root } = mount(overlayOptions({ state: { alignment: 'left', captionVisible: false, size: 'md' } }));

    expect(action(root, 'align-left').getAttribute('aria-pressed')).toBe('true');
    expect(action(root, 'align-center').getAttribute('aria-pressed')).toBe('false');
    expect(action(root, 'align-right').getAttribute('aria-pressed')).toBe('false');
  });

  it('labels each alignment option', () => {
    const { root } = mount(overlayOptions());

    expect(action(root, 'align-left').getAttribute('aria-label')).toBe('Align left');
    expect(action(root, 'align-center').getAttribute('aria-label')).toBe('Align center');
    expect(action(root, 'align-right').getAttribute('aria-label')).toBe('Align right');
  });

  it('starts closed', () => {
    const { root, toolRoot } = mount(overlayOptions());
    const popover = required(root.querySelector<HTMLElement>('[data-role="align-popover"]'), 'popover');

    expect(popover.hidden).toBe(true);
    expect(popover.hasAttribute('data-blok-popover-opened')).toBe(false);
    expect(toolRoot.hasAttribute('data-align-open')).toBe(false);
  });

  it('opens on the trigger and tells the block root the popover is up', () => {
    const { root, toolRoot } = mount(overlayOptions());
    const popover = required(root.querySelector<HTMLElement>('[data-role="align-popover"]'), 'popover');

    action(root, 'align-trigger').click();

    expect(popover.hidden).toBe(false);
    expect(popover.getAttribute('data-blok-popover-opened')).toBe('true');
    expect(toolRoot.getAttribute('data-align-open')).toBe('true');
    expect(action(root, 'align-trigger').getAttribute('aria-expanded')).toBe('true');
  });

  it('closes again on a second trigger click', () => {
    const { root, toolRoot } = mount(overlayOptions());
    const popover = required(root.querySelector<HTMLElement>('[data-role="align-popover"]'), 'popover');
    const trigger = action(root, 'align-trigger');

    trigger.click();
    trigger.click();

    expect(popover.hidden).toBe(true);
    expect(popover.hasAttribute('data-blok-popover-opened')).toBe(false);
    expect(toolRoot.hasAttribute('data-align-open')).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('applies the chosen alignment and closes', () => {
    const opts = overlayOptions();
    const { root } = mount(opts);
    const popover = required(root.querySelector<HTMLElement>('[data-role="align-popover"]'), 'popover');

    action(root, 'align-trigger').click();
    action(root, 'align-right').click();

    expect(opts.onAlign).toHaveBeenCalledWith('right');
    expect(popover.hidden).toBe(true);
  });

  it('closes on Escape while open', () => {
    const { root } = mount(overlayOptions());
    const popover = required(root.querySelector<HTMLElement>('[data-role="align-popover"]'), 'popover');

    action(root, 'align-trigger').click();
    simulateKeydown(document, 'Escape');

    expect(popover.hidden).toBe(true);
  });

  it('leaves Escape to the editor while the popover is closed', () => {
    const outer = vi.fn();

    mount(overlayOptions());
    window.addEventListener('keydown', outer);
    simulateKeydown(document, 'Escape');
    window.removeEventListener('keydown', outer);

    expect(outer).toHaveBeenCalledTimes(1);
  });

  it('swallows the Escape that closed the popover so the editor does not also act on it', () => {
    const { root } = mount(overlayOptions());
    const outer = vi.fn();

    action(root, 'align-trigger').click();
    window.addEventListener('keydown', outer);
    simulateKeydown(document, 'Escape');
    window.removeEventListener('keydown', outer);

    expect(outer).not.toHaveBeenCalled();
  });

  it('closes on a mousedown outside the alignment control', () => {
    const { root } = mount(overlayOptions());
    const popover = required(root.querySelector<HTMLElement>('[data-role="align-popover"]'), 'popover');

    action(root, 'align-trigger').click();
    simulateMousedown(document.body);

    expect(popover.hidden).toBe(true);
  });

  it('stays open on a mousedown inside the alignment control', () => {
    const { root } = mount(overlayOptions());
    const popover = required(root.querySelector<HTMLElement>('[data-role="align-popover"]'), 'popover');

    action(root, 'align-trigger').click();
    simulateMousedown(popover);

    expect(popover.hidden).toBe(false);
  });
});

describe('openLightbox chrome', () => {
  it('promotes the dialog to the top layer so its scoped colour tokens resolve', () => {
    open({ url: 'https://x/a.png' });

    expect(dialogEl().getAttribute('data-blok-top-layer')).toBe('true');
  });

  it('drops the top-layer tag when the dialog is torn down', () => {
    const close = open({ url: 'https://x/a.png' });
    const dialog = dialogEl();

    close();
    flushAnimations();

    expect(dialog.hasAttribute('data-blok-top-layer')).toBe(false);
  });

  it('names the dialog and its control groups for assistive tech', () => {
    open({
      url: 'https://x/a.png',
      navigation: { items: [{ url: 'https://x/a.png' }, { url: 'https://x/b.png' }], startIndex: 0 },
    });

    expect(dialogEl().getAttribute('aria-label')).toBe('Image preview');
    expect(toolbarEl().getAttribute('aria-label')).toBe('Image preview controls');
    expect(toolbarEl().getAttribute('role')).toBe('toolbar');
    expect(navEl().getAttribute('aria-label')).toBe('Image navigation');
    expect(navEl().getAttribute('role')).toBe('group');
  });

  it('labels every toolbar button with its localized name', () => {
    open({ url: 'https://x/a.png' });

    const labels = ['zoom-out', 'zoom-reset', 'zoom-in', 'lightbox-download', 'lightbox-copy-url', 'lightbox-collapse']
      .map((name) => action(toolbarEl(), name).getAttribute('aria-label'));

    expect(labels).toEqual(['Zoom out', 'Reset zoom', 'Zoom in', 'Download', 'Copy URL', 'Exit full screen']);
  });

  it('labels the navigation buttons', () => {
    open({
      url: 'https://x/a.png',
      navigation: { items: [{ url: 'https://x/a.png' }, { url: 'https://x/b.png' }], startIndex: 0 },
    });

    expect(action(navEl(), 'lightbox-prev').getAttribute('aria-label')).toBe('Previous image');
    expect(action(navEl(), 'lightbox-next').getAttribute('aria-label')).toBe('Next image');
  });

  it('shows the keyboard shortcut alongside the label in each toolbar tooltip', () => {
    open({ url: 'https://x/a.png' });

    expect(shortcutText(action(toolbarEl(), 'zoom-out'))).toBe('−');
    expect(shortcutText(action(toolbarEl(), 'zoom-in'))).toBe('+');
    expect(shortcutText(action(toolbarEl(), 'lightbox-collapse'))).toBe('Esc');
  });

  it('shows the arrow shortcuts on the navigation tooltips', () => {
    open({
      url: 'https://x/a.png',
      navigation: { items: [{ url: 'https://x/a.png' }, { url: 'https://x/b.png' }], startIndex: 0 },
    });

    expect(shortcutText(action(navEl(), 'lightbox-prev'))).toBe('←');
    expect(shortcutText(action(navEl(), 'lightbox-next'))).toBe('→');
  });

  it('uses a plain-text tooltip for the shortcut-less zoom readout', () => {
    open({ url: 'https://x/a.png' });

    expect(hoverArg(action(toolbarEl(), 'zoom-reset'), 1)).toBe('Reset zoom');
  });

  it('places toolbar tooltips above and navigation tooltips beside their button', () => {
    open({
      url: 'https://x/a.png',
      navigation: { items: [{ url: 'https://x/a.png' }, { url: 'https://x/b.png' }], startIndex: 0 },
    });

    expect(hoverArg(action(toolbarEl(), 'zoom-in'), 2)).toStrictEqual({ placement: 'top' });
    expect(hoverArg(action(navEl(), 'lightbox-next'), 2)).toStrictEqual({ placement: 'right' });
  });

  it('gives the zoom readout its own class so it renders as a label, not an icon', () => {
    open({ url: 'https://x/a.png' });

    expect(action(toolbarEl(), 'zoom-reset').className).toBe('blok-image-lightbox__btn blok-image-lightbox__zoom-label');
    expect(action(toolbarEl(), 'zoom-in').className).toBe('blok-image-lightbox__btn');
  });

  it('marks the backdrop decorative and separates it from the image', () => {
    open({ url: 'https://x/a.png' });

    expect(backdropEl().getAttribute('aria-hidden')).toBe('true');
    expect(backdropEl().className).toBe('blok-image-lightbox__backdrop');
  });

  it('separates the zoom cluster from the actions with a divider', () => {
    open({ url: 'https://x/a.png' });

    const divider = required(toolbarEl().querySelector('.blok-image-lightbox__divider'), 'divider');

    expect(divider.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the crop in the preview when the inline image is cropped', () => {
    open({ url: 'https://x/a.png', crop: { x: 10, y: 20, w: 50, h: 25, shape: 'circle' } });

    const wrapper = required(document.body.querySelector<HTMLElement>('[data-role="lightbox-crop"]'), 'crop wrapper');
    const img = required(wrapper.querySelector<HTMLImageElement>('img'), 'img');

    expect(wrapper.style.overflow).toBe('hidden');
    expect(wrapper.style.aspectRatio).toBe('50 / 25');
    expect(wrapper.getAttribute('data-shape')).toBe('circle');
    expect(wrapper.style.borderRadius).toBe('50%');
    expect(img.style.display).toBe('block');
    expect(img.style.width).toBe('200%');
    expect(img.style.transform).toBe('translate(-10%, -20%)');
  });

  it('names the crop wrapper so it is both the display element and the crop box', () => {
    open({ url: 'https://x/a.png', crop: { x: 0, y: 0, w: 50, h: 25 } });

    const wrapper = required(document.body.querySelector<HTMLElement>('[data-role="lightbox-crop"]'), 'crop wrapper');
    const img = required(wrapper.querySelector<HTMLImageElement>('img'), 'img');

    expect(wrapper.className).toBe('blok-image-lightbox__image blok-image-lightbox__crop');
    expect(img.style.maxWidth).toBe('none');
  });

  it('rounds an ellipse crop in the preview', () => {
    open({ url: 'https://x/a.png', crop: { x: 0, y: 0, w: 50, h: 25, shape: 'ellipse' } });

    const wrapper = required(document.body.querySelector<HTMLElement>('[data-role="lightbox-crop"]'), 'crop wrapper');

    expect(wrapper.style.borderRadius).toBe('50%');
  });

  it('leaves a rect crop square in the preview', () => {
    open({ url: 'https://x/a.png', crop: { x: 0, y: 0, w: 50, h: 25, shape: 'rect' } });

    const wrapper = required(document.body.querySelector<HTMLElement>('[data-role="lightbox-crop"]'), 'crop wrapper');

    expect(wrapper.style.borderRadius).toBe('');
  });

  it('refines the preview crop aspect from the intrinsic pixels', () => {
    intrinsics.complete = true;
    intrinsics.naturalWidth = 200;
    intrinsics.naturalHeight = 100;

    open({ url: 'https://x/a.png', crop: { x: 0, y: 0, w: 4, h: 3 } });

    const wrapper = required(document.body.querySelector<HTMLElement>('[data-role="lightbox-crop"]'), 'crop wrapper');

    expect(wrapper.style.aspectRatio).toBe('800 / 300');
  });

  it('renders the preview image with an empty alt when the item carries none', () => {
    open({ url: 'https://x/a.png' });

    expect(displayEl().getAttribute('alt')).toBe('');
  });

  it('turns off native dragging on the preview image so the pan gesture owns it', () => {
    open({ url: 'https://x/a.png' });

    expect(displayEl().draggable).toBe(false);
  });

  it('applies the effective editor direction to the dialog', () => {
    open({ url: 'https://x/a.png', direction: 'rtl' });

    expect(dialogEl().getAttribute('dir')).toBe('rtl');
  });

  it('hides the tooltip before a toolbar action runs', () => {
    open({ url: 'https://x/a.png' });

    action(toolbarEl(), 'zoom-in').click();

    expect(hideMock).toHaveBeenCalled();
  });

  it('leaves data-shape off an uncropped-shape preview', () => {
    open({ url: 'https://x/a.png', crop: { x: 0, y: 0, w: 50, h: 25 } });

    const wrapper = required(document.body.querySelector<HTMLElement>('[data-role="lightbox-crop"]'), 'crop wrapper');

    expect(wrapper.hasAttribute('data-shape')).toBe(false);
  });

  it('downloads the file the preview is showing', () => {
    open({ url: 'https://x/a.png', fileName: 'a.png' });

    action(toolbarEl(), 'lightbox-download').click();

    expect(downloadMock).toHaveBeenCalledWith('https://x/a.png', 'a.png');
  });

  it('copies the url the preview is showing', () => {
    open({ url: 'https://x/a.png' });

    action(toolbarEl(), 'lightbox-copy-url').click();

    expect(writeText).toHaveBeenCalledWith('https://x/a.png');
  });

  it('survives a browser with no clipboard support', () => {
    Reflect.deleteProperty(navigator, 'clipboard');
    open({ url: 'https://x/a.png' });

    expect(() => action(toolbarEl(), 'lightbox-copy-url').click()).not.toThrow();
  });

  it('starts at identity transform', () => {
    open({ url: 'https://x/a.png' });

    expect(displayEl().style.transform).toBe('translate(0px, 0px) scale(1)');
  });

  it('disables zoom-out at the floor and zoom-in at the ceiling', () => {
    open({ url: 'https://x/a.png' });

    expect(action(toolbarEl(), 'zoom-out').disabled).toBe(false);
    expect(action(toolbarEl(), 'zoom-in').disabled).toBe(false);

    for (let i = 0; i < 20; i += 1) {
      action(toolbarEl(), 'zoom-out').click();
    }

    expect(action(toolbarEl(), 'zoom-out').disabled).toBe(true);
    expect(action(toolbarEl(), 'zoom-in').disabled).toBe(false);

    for (let i = 0; i < 40; i += 1) {
      action(toolbarEl(), 'zoom-in').click();
    }

    expect(action(toolbarEl(), 'zoom-in').disabled).toBe(true);
    expect(action(toolbarEl(), 'zoom-out').disabled).toBe(false);
  });

  it('reports the zoom level as a rounded percentage', () => {
    open({ url: 'https://x/a.png' });

    action(toolbarEl(), 'zoom-in').click();

    expect(action(toolbarEl(), 'zoom-reset').textContent).toBe('125%');

    action(toolbarEl(), 'zoom-reset').click();

    expect(action(toolbarEl(), 'zoom-reset').textContent).toBe('100%');
  });

  it('recentres the image when zoom is applied from a button', () => {
    planDisplayRect({ width: 800, height: 600 });
    open({ url: 'https://x/a.png' });

    const dialog = dialogEl();

    dialog.dispatchEvent(pointer('pointerdown', 0, 0));
    dialog.dispatchEvent(pointer('pointermove', 60, 0));
    dialog.dispatchEvent(pointer('pointerup', 60, 0));

    expect(displayEl().style.transform).toBe('translate(60px, 0px) scale(1)');

    action(toolbarEl(), 'zoom-in').click();

    expect(displayEl().style.transform).toBe('translate(0px, 0px) scale(1.25)');
  });

  it('keeps toolbar clicks off the editor underneath', () => {
    const outer = vi.fn();

    open({ url: 'https://x/a.png' });
    document.body.addEventListener('click', outer);
    simulateClick(toolbarEl());
    document.body.removeEventListener('click', outer);

    expect(outer).not.toHaveBeenCalled();
  });

  it('keeps navigation clicks off the editor underneath', () => {
    const outer = vi.fn();

    open({
      url: 'https://x/a.png',
      navigation: { items: [{ url: 'https://x/a.png' }, { url: 'https://x/b.png' }], startIndex: 0 },
    });
    document.body.addEventListener('click', outer);
    simulateClick(navEl());
    document.body.removeEventListener('click', outer);

    expect(outer).not.toHaveBeenCalled();
  });

  it('keeps a mousedown on the image from starting a block selection behind the dialog', () => {
    const outer = vi.fn();

    open({ url: 'https://x/a.png' });
    document.body.addEventListener('mousedown', outer);
    simulateMousedown(displayEl());
    document.body.removeEventListener('mousedown', outer);

    expect(outer).not.toHaveBeenCalled();
  });
});

describe('openLightbox open animation', () => {
  function openWithOrigin(): HTMLElement {
    const origin = document.createElement('div');

    document.body.appendChild(origin);
    planRect((el) => el === origin, { left: 100, top: 200, width: 50, height: 40 });
    planDisplayRect({ left: 0, top: 0, width: 500, height: 400 });
    open({ url: 'https://x/a.png', origin });

    return origin;
  }

  it('morphs the preview out of the thumbnail it was opened from', () => {
    openWithOrigin();

    expect(firstAnimationFor(displayEl()).keyframes).toStrictEqual([
      { transform: 'translate(-125px, 20px) scale(0.1, 0.1)' },
      { transform: 'translate(0px, 0px) scale(1)' },
    ]);
  });

  it('runs the morph with the open timing', () => {
    openWithOrigin();

    expect(firstAnimationFor(displayEl()).options).toStrictEqual({
      duration: 360,
      easing: OPEN_EASING,
      fill: 'backwards',
    });
  });

  it('hides the thumbnail while the preview stands in for it', () => {
    const origin = openWithOrigin();

    expect(origin.style.opacity).toBe('0');
  });

  it('restores the thumbnail when the preview closes', () => {
    const origin = document.createElement('div');

    origin.style.opacity = '0.4';
    document.body.appendChild(origin);
    planRect((el) => el === origin, { left: 100, top: 200, width: 50, height: 40 });
    planDisplayRect({ left: 0, top: 0, width: 500, height: 400 });

    const close = open({ url: 'https://x/a.png', origin });

    close();
    flushAnimations();

    expect(origin.style.opacity).toBe('0.4');
  });

  it('skips the morph when the thumbnail has no measurable width', () => {
    const origin = document.createElement('div');

    document.body.appendChild(origin);
    planRect((el) => el === origin, { width: 0, height: 40 });
    planDisplayRect({ width: 500, height: 400 });
    open({ url: 'https://x/a.png', origin });

    expect(animationsFor(displayEl())).toHaveLength(0);
  });

  it('skips the morph when the thumbnail has no measurable height', () => {
    const origin = document.createElement('div');

    document.body.appendChild(origin);
    planRect((el) => el === origin, { width: 50, height: 0 });
    planDisplayRect({ width: 500, height: 400 });
    open({ url: 'https://x/a.png', origin });

    expect(animationsFor(displayEl())).toHaveLength(0);
  });

  it('skips the morph when the preview has no measurable width', () => {
    const origin = document.createElement('div');

    document.body.appendChild(origin);
    planRect((el) => el === origin, { width: 50, height: 40 });
    planDisplayRect({ width: 0, height: 400 });
    open({ url: 'https://x/a.png', origin });

    expect(animationsFor(displayEl())).toHaveLength(0);
  });

  it('skips the morph when the preview has no measurable height', () => {
    const origin = document.createElement('div');

    document.body.appendChild(origin);
    planRect((el) => el === origin, { width: 50, height: 40 });
    planDisplayRect({ width: 500, height: 0 });
    open({ url: 'https://x/a.png', origin });

    expect(animationsFor(displayEl())).toHaveLength(0);
  });

  it('ignores a thumbnail that is not in the document', () => {
    const origin = document.createElement('div');

    planRect((el) => el === origin, { width: 50, height: 40 });
    planDisplayRect({ width: 500, height: 400 });
    open({ url: 'https://x/a.png', origin });

    expect(animationsFor(displayEl())).toHaveLength(0);
    expect(origin.style.opacity).toBe('');
  });

  it('fades the backdrop in', () => {
    open({ url: 'https://x/a.png' });

    const anim = firstAnimationFor(backdropEl());

    expect(anim.keyframes).toStrictEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(anim.options).toStrictEqual({ duration: 260, easing: 'linear', fill: 'backwards' });
  });

  it('slides the toolbar up into place', () => {
    open({ url: 'https://x/a.png' });

    const anim = firstAnimationFor(toolbarEl());

    expect(anim.keyframes).toStrictEqual([
      { opacity: 0, transform: 'translate(-50%, 12px)' },
      { opacity: 1, transform: 'translate(-50%, 0px)' },
    ]);
    expect(anim.options).toStrictEqual({ duration: 320, delay: 140, easing: OPEN_EASING, fill: 'both' });
  });

  it('slides the navigation in from the side', () => {
    open({
      url: 'https://x/a.png',
      navigation: { items: [{ url: 'https://x/a.png' }, { url: 'https://x/b.png' }], startIndex: 0 },
    });

    const anim = firstAnimationFor(navEl());

    expect(anim.keyframes).toStrictEqual([
      { opacity: 0, transform: 'translate(-12px, -50%)' },
      { opacity: 1, transform: 'translate(0px, -50%)' },
    ]);
    expect(anim.options).toStrictEqual({ duration: 320, delay: 140, easing: OPEN_EASING, fill: 'both' });
  });
});

describe('openLightbox close animation', () => {
  function openMorphed(): { origin: HTMLElement; close: () => void } {
    const origin = document.createElement('div');

    document.body.appendChild(origin);
    planRect((el) => el === origin, { left: 100, top: 200, width: 50, height: 40 });
    planDisplayRect({ left: 0, top: 0, width: 500, height: 400 });

    const close = open({ url: 'https://x/a.png', origin });

    return { origin, close };
  }

  it('morphs back into the thumbnail from wherever the image currently sits', () => {
    const { close } = openMorphed();
    const display = displayEl();

    action(toolbarEl(), 'zoom-in').click();
    animations.length = 0;
    close();

    expect(firstAnimationFor(display).keyframes).toStrictEqual([
      { transform: 'translate(0px, 0px) scale(1.25)' },
      { transform: 'translate(-125px, 20px) scale(0.1, 0.1)' },
    ]);
  });

  it('runs the reverse morph with the close timing and locks the final state inline', () => {
    const { close } = openMorphed();
    const display = displayEl();

    animations.length = 0;
    close();

    expect(firstAnimationFor(display).options).toStrictEqual({
      duration: 280,
      easing: CLOSE_EASING,
      fill: 'forwards',
    });
    expect(display.style.transition).toBe('none');
    expect(display.style.transform).toBe('translate(-125px, 20px) scale(0.1, 0.1)');
  });

  it('falls back to scale 1 when the preview measures zero at close time', () => {
    const origin = document.createElement('div');

    document.body.appendChild(origin);
    planRect((el) => el === origin, { left: 0, top: 0, width: 100, height: 100 });
    planDisplayRect({ width: 100, height: 100 });

    const close = open({ url: 'https://x/a.png', origin });
    const display = displayEl();

    planDisplayRect({ width: 0, height: 0 });
    animations.length = 0;
    close();

    expect(firstAnimationFor(display).keyframes).toStrictEqual([
      { transform: 'translate(0px, 0px) scale(1)' },
      { transform: 'translate(50px, 50px) scale(1, 1)' },
    ]);
  });

  it('tears the dialog down without a morph when the thumbnail has gone', () => {
    const origin = document.createElement('div');

    document.body.appendChild(origin);
    planRect((el) => el === origin, { width: 0, height: 0 });

    const close = open({ url: 'https://x/a.png', origin });

    close();

    expect(document.body.querySelector('.blok-image-lightbox')).toBeNull();
  });

  it('skips the reverse morph when the thumbnail has collapsed to zero width', () => {
    const origin = document.createElement('div');

    document.body.appendChild(origin);
    planRect((el) => el === origin, { width: 0, height: 10 });
    planDisplayRect({ width: 500, height: 400 });

    const close = open({ url: 'https://x/a.png', origin });

    close();

    expect(document.body.querySelector('.blok-image-lightbox')).toBeNull();
  });

  it('skips the reverse morph when the thumbnail has collapsed to zero height', () => {
    const origin = document.createElement('div');

    document.body.appendChild(origin);
    planRect((el) => el === origin, { width: 10, height: 0 });
    planDisplayRect({ width: 500, height: 400 });

    const close = open({ url: 'https://x/a.png', origin });

    close();

    expect(document.body.querySelector('.blok-image-lightbox')).toBeNull();
  });

  it('fades out and waits for the fade before removing a dialog with no thumbnail', () => {
    const close = open({ url: 'https://x/a.png' });

    animations.length = 0;
    close();

    const anim = firstAnimationFor(backdropEl());

    expect(anim.keyframes).toStrictEqual([{ opacity: 1 }, { opacity: 0 }]);
    expect(anim.options).toStrictEqual({ duration: 180, easing: 'linear', fill: 'forwards' });
    expect(document.body.querySelector('.blok-image-lightbox')).not.toBeNull();

    flushAnimations();

    expect(document.body.querySelector('.blok-image-lightbox')).toBeNull();
  });

  it('slides the toolbar back down on close', () => {
    const close = open({ url: 'https://x/a.png' });
    const toolbar = toolbarEl();

    animations.length = 0;
    close();

    const anim = firstAnimationFor(toolbar);

    expect(anim.keyframes).toStrictEqual([
      { opacity: 1, transform: 'translate(-50%, 0px)' },
      { opacity: 0, transform: 'translate(-50%, 12px)' },
    ]);
    expect(anim.options).toStrictEqual({ duration: 180, easing: CLOSE_EASING, fill: 'forwards' });
  });

  it('slides the navigation back out on close', () => {
    const close = open({
      url: 'https://x/a.png',
      navigation: { items: [{ url: 'https://x/a.png' }, { url: 'https://x/b.png' }], startIndex: 0 },
    });
    const nav = navEl();

    animations.length = 0;
    close();

    const anim = firstAnimationFor(nav);

    expect(anim.keyframes).toStrictEqual([
      { opacity: 1, transform: 'translate(0px, -50%)' },
      { opacity: 0, transform: 'translate(-12px, -50%)' },
    ]);
    expect(anim.options).toStrictEqual({ duration: 180, easing: CLOSE_EASING, fill: 'forwards' });
  });

  it('fades the backdrop out on the morph timing rather than the fade-only timing', () => {
    const { close } = openMorphed();
    const backdrop = backdropEl();

    animations.length = 0;
    close();

    const anim = firstAnimationFor(backdrop);

    expect(anim.keyframes).toStrictEqual([{ opacity: 1 }, { opacity: 0 }]);
    // The morph path runs 280ms; the no-thumbnail fade runs 180ms.
    expect(anim.options).toStrictEqual({ duration: 280, easing: 'linear', fill: 'forwards' });
  });

  it('slides the toolbar and the navigation out on a morphing close', () => {
    const origin = document.createElement('div');

    document.body.appendChild(origin);
    planRect((el) => el === origin, { left: 100, top: 200, width: 50, height: 40 });
    planDisplayRect({ left: 0, top: 0, width: 500, height: 400 });

    const close = open({
      url: 'https://x/a.png',
      origin,
      navigation: { items: [{ url: 'https://x/a.png' }, { url: 'https://x/b.png' }], startIndex: 0 },
    });
    const toolbar = toolbarEl();
    const nav = navEl();

    animations.length = 0;
    close();

    const toolbarAnim = firstAnimationFor(toolbar);
    const navAnim = firstAnimationFor(nav);

    expect(toolbarAnim.keyframes).toStrictEqual([
      { opacity: 1, transform: 'translate(-50%, 0px)' },
      { opacity: 0, transform: 'translate(-50%, 12px)' },
    ]);
    expect(toolbarAnim.options).toStrictEqual({ duration: 200, easing: CLOSE_EASING, fill: 'forwards' });
    expect(navAnim.keyframes).toStrictEqual([
      { opacity: 1, transform: 'translate(0px, -50%)' },
      { opacity: 0, transform: 'translate(-12px, -50%)' },
    ]);
    expect(navAnim.options).toStrictEqual({ duration: 200, easing: CLOSE_EASING, fill: 'forwards' });
  });

  it('cancels the in-flight open animation before starting the close', () => {
    const { close } = openMorphed();
    const openAnim = firstAnimationFor(displayEl());

    close();

    expect(openAnim.cancelled).toBe(true);
  });

  it('ignores a second close so the exit animation is not restarted', () => {
    const { close } = openMorphed();
    const display = displayEl();

    animations.length = 0;
    close();
    close();

    expect(animationsFor(display)).toHaveLength(1);
  });

  it('stops listening for keys once the dialog is gone', () => {
    const close = open({ url: 'https://x/a.png' });
    const display = displayEl();

    close();
    flushAnimations();
    simulateKeydown(document, '+');

    expect(display.style.transform).toBe('translate(0px, 0px) scale(1)');
  });

  it('returns focus to whatever was focused before the preview opened', () => {
    const trigger = document.createElement('button');

    document.body.appendChild(trigger);
    trigger.focus();

    const close = open({ url: 'https://x/a.png' });

    close();
    flushAnimations();

    expect(trigger).toHaveFocus();
  });

  it('closes on a click on the backdrop', () => {
    const close = open({ url: 'https://x/a.png' });

    simulateClick(dialogEl());
    flushAnimations();
    close();

    expect(document.body.querySelector('.blok-image-lightbox')).toBeNull();
  });
});

describe('openLightbox navigation', () => {
  const items = [
    { url: 'https://x/a.png', fileName: 'a.png', alt: 'first' },
    { url: 'https://x/b.png', fileName: 'b.png', alt: 'second' },
    { url: 'https://x/c.png', fileName: 'c.png', alt: 'third' },
  ];

  function openNav(startIndex: number): () => void {
    return open({ url: items[startIndex].url, navigation: { items, startIndex } });
  }

  it('opens on the requested item', () => {
    openNav(1);

    expect(action(navEl(), 'lightbox-prev').disabled).toBe(false);
    expect(action(navEl(), 'lightbox-next').disabled).toBe(false);
  });

  it('clamps a start index past the end onto the last item', () => {
    open({ url: items[0].url, navigation: { items, startIndex: 5 } });

    expect(action(navEl(), 'lightbox-next').disabled).toBe(true);
    expect(action(navEl(), 'lightbox-prev').disabled).toBe(false);
  });

  it('clamps a start index past the end onto the last item, not past it', () => {
    open({ url: items[0].url, navigation: { items, startIndex: 5 } });

    action(navEl(), 'lightbox-prev').click();

    expect(displayEl().getAttribute('src')).toBe('https://x/b.png');
  });

  it('starts at the first item when no start index is given', () => {
    open({ url: items[0].url, navigation: { items, startIndex: undefined as unknown as number } });

    expect(action(navEl(), 'lightbox-prev').disabled).toBe(true);
  });

  it('shows the next image on next', () => {
    openNav(0);

    action(navEl(), 'lightbox-next').click();

    expect(displayEl().getAttribute('src')).toBe('https://x/b.png');
    expect(displayEl().getAttribute('alt')).toBe('second');
  });

  it('shows the previous image on prev', () => {
    openNav(1);

    action(navEl(), 'lightbox-prev').click();

    expect(displayEl().getAttribute('src')).toBe('https://x/a.png');
  });

  it('refuses to walk past the last item', () => {
    openNav(2);

    action(navEl(), 'lightbox-next').click();

    expect(displayEl().getAttribute('src')).toBe('https://x/c.png');
  });

  it('refuses to walk past the first item', () => {
    openNav(0);

    action(navEl(), 'lightbox-prev').click();

    expect(displayEl().getAttribute('src')).toBe('https://x/a.png');
  });

  it('disables prev on the first item and next on the last', () => {
    openNav(1);

    action(navEl(), 'lightbox-prev').click();
    expect(action(navEl(), 'lightbox-prev').disabled).toBe(true);

    action(navEl(), 'lightbox-next').click();
    action(navEl(), 'lightbox-next').click();
    expect(action(navEl(), 'lightbox-next').disabled).toBe(true);
  });

  it('downloads the navigated-to file, not the one the preview opened on', () => {
    openNav(0);

    action(navEl(), 'lightbox-next').click();
    action(toolbarEl(), 'lightbox-download').click();

    expect(downloadMock).toHaveBeenCalledWith('https://x/b.png', 'b.png');
  });

  it('copies the navigated-to url, not the one the preview opened on', () => {
    openNav(0);

    action(navEl(), 'lightbox-next').click();
    action(toolbarEl(), 'lightbox-copy-url').click();

    expect(writeText).toHaveBeenCalledWith('https://x/b.png');
  });

  it('resets zoom, pan and the zoom readout for the new image', () => {
    planDisplayRect({ width: 800, height: 600 });
    openNav(0);

    action(toolbarEl(), 'zoom-in').click();
    action(navEl(), 'lightbox-next').click();

    expect(displayEl().style.transform).toBe('translate(0px, 0px) scale(1)');
    expect(action(toolbarEl(), 'zoom-reset').textContent).toBe('100%');
  });

  it('re-enables the zoom buttons for the new image', () => {
    openNav(0);

    for (let i = 0; i < 20; i += 1) {
      action(toolbarEl(), 'zoom-out').click();
    }
    expect(action(toolbarEl(), 'zoom-out').disabled).toBe(true);

    action(navEl(), 'lightbox-next').click();

    expect(action(toolbarEl(), 'zoom-out').disabled).toBe(false);
  });

  it('slides the next image in from the right', () => {
    openNav(0);
    animations.length = 0;

    action(navEl(), 'lightbox-next').click();

    const anim = firstAnimationFor(displayEl());

    expect(anim.keyframes).toStrictEqual([
      { opacity: 0, transform: 'translate(160px, 0px) scale(0.92)' },
      { opacity: 1, transform: 'translate(0px, 0px) scale(1)' },
    ]);
    expect(anim.options).toStrictEqual({ duration: 380, easing: OPEN_EASING, fill: 'backwards' });
  });

  it('slides the previous image in from the left', () => {
    openNav(1);
    animations.length = 0;

    action(navEl(), 'lightbox-prev').click();

    expect(firstAnimationFor(displayEl()).keyframes).toStrictEqual([
      { opacity: 0, transform: 'translate(-160px, 0px) scale(0.92)' },
      { opacity: 1, transform: 'translate(0px, 0px) scale(1)' },
    ]);
  });

  it('bounces the button that was clicked', () => {
    openNav(0);
    const next = action(navEl(), 'lightbox-next');

    animations.length = 0;
    next.click();

    const anim = firstAnimationFor(next);

    expect(anim.keyframes).toStrictEqual([
      { transform: 'scale(1)' },
      { transform: 'scale(0.92)', offset: 0.5 },
      { transform: 'scale(1)' },
    ]);
    expect(anim.options).toStrictEqual({ duration: 160, easing: OPEN_EASING });
    expect(animationsFor(action(navEl(), 'lightbox-prev'))).toHaveLength(0);
  });

  it('nudges the button sideways when the keyboard drove the move', () => {
    openNav(0);
    const next = action(navEl(), 'lightbox-next');

    animations.length = 0;
    simulateKeydown(document, 'ArrowRight');

    const anim = firstAnimationFor(next);

    expect(anim.keyframes).toStrictEqual([
      { transform: 'translateX(0) scale(1)' },
      { transform: 'translateX(6px) scale(0.78)', offset: 0.4 },
      { transform: 'translateX(0) scale(1)' },
    ]);
    expect(anim.options).toStrictEqual({ duration: 320, easing: OPEN_EASING });
  });

  it('nudges the previous button the other way on the left arrow', () => {
    openNav(1);
    const prev = action(navEl(), 'lightbox-prev');

    animations.length = 0;
    simulateKeydown(document, 'ArrowLeft');

    expect(firstAnimationFor(prev).keyframes).toStrictEqual([
      { transform: 'translateX(0) scale(1)' },
      { transform: 'translateX(-6px) scale(0.78)', offset: 0.4 },
      { transform: 'translateX(0) scale(1)' },
    ]);
  });

  it('adopts a thumbnail on navigation even when the preview opened without one', () => {
    const second = document.createElement('div');

    second.style.opacity = '0.3';
    document.body.appendChild(second);
    planRect((el) => el === second, { left: 0, top: 0, width: 20, height: 20 });

    open({
      url: items[0].url,
      navigation: {
        items: [items[0], { ...items[1], origin: second }],
        startIndex: 0,
      },
    });

    expect(() => action(navEl(), 'lightbox-next').click()).not.toThrow();
    expect(second.style.opacity).toBe('0');
  });

  it('releases the thumbnail when the next image has none', () => {
    const first = document.createElement('div');

    first.style.opacity = '0.6';
    document.body.appendChild(first);
    planRect((el) => el === first, { left: 0, top: 0, width: 10, height: 10 });

    open({
      url: items[0].url,
      origin: first,
      navigation: {
        items: [{ ...items[0], origin: first }, items[1]],
        startIndex: 0,
      },
    });

    expect(() => action(navEl(), 'lightbox-next').click()).not.toThrow();
    expect(first.style.opacity).toBe('0.6');
  });

  it('re-points the close morph at the thumbnail of the image now on screen', () => {
    const first = document.createElement('div');
    const second = document.createElement('div');

    first.style.opacity = '0.7';
    document.body.append(first, second);
    planRect((el) => el === first, { left: 0, top: 0, width: 10, height: 10 });
    planRect((el) => el === second, { left: 0, top: 0, width: 20, height: 20 });
    planDisplayRect({ left: 0, top: 0, width: 500, height: 400 });

    open({
      url: items[0].url,
      origin: first,
      navigation: {
        items: [
          { ...items[0], origin: first },
          { ...items[1], origin: second },
        ],
        startIndex: 0,
      },
    });

    expect(first.style.opacity).toBe('0');

    action(navEl(), 'lightbox-next').click();

    expect(first.style.opacity).toBe('0.7');
    expect(second.style.opacity).toBe('0');
  });
});

describe('openLightbox keyboard', () => {
  function keydown(key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

    document.dispatchEvent(event);

    return event;
  }

  it('closes on Escape and claims the key', () => {
    open({ url: 'https://x/a.png' });

    const event = keydown('Escape');

    flushAnimations();

    expect(event.defaultPrevented).toBe(true);
    expect(document.body.querySelector('.blok-image-lightbox')).toBeNull();
  });

  it('closes on Space and claims the key', () => {
    open({ url: 'https://x/a.png' });

    const event = keydown(' ');

    flushAnimations();

    expect(event.defaultPrevented).toBe(true);
    expect(document.body.querySelector('.blok-image-lightbox')).toBeNull();
  });

  it('zooms in on both plus keys', () => {
    open({ url: 'https://x/a.png' });

    expect(keydown('+').defaultPrevented).toBe(true);
    expect(action(toolbarEl(), 'zoom-reset').textContent).toBe('125%');

    keydown('=');

    expect(action(toolbarEl(), 'zoom-reset').textContent).toBe('150%');
  });

  it('zooms out on minus', () => {
    open({ url: 'https://x/a.png' });

    expect(keydown('-').defaultPrevented).toBe(true);
    expect(action(toolbarEl(), 'zoom-reset').textContent).toBe('75%');
  });

  it('leaves the arrows to the page when there is nothing to navigate', () => {
    open({ url: 'https://x/a.png' });

    expect(keydown('ArrowRight').defaultPrevented).toBe(false);
    expect(keydown('ArrowLeft').defaultPrevented).toBe(false);
  });

  it('claims the arrows and moves when navigation is available', () => {
    open({
      url: 'https://x/a.png',
      navigation: { items: [{ url: 'https://x/a.png' }, { url: 'https://x/b.png' }], startIndex: 0 },
    });

    expect(keydown('ArrowRight').defaultPrevented).toBe(true);
    expect(displayEl().getAttribute('src')).toBe('https://x/b.png');

    expect(keydown('ArrowLeft').defaultPrevented).toBe(true);
    expect(displayEl().getAttribute('src')).toBe('https://x/a.png');
  });

  it('ignores keys it does not own', () => {
    open({ url: 'https://x/a.png' });

    expect(keydown('a').defaultPrevented).toBe(false);
    expect(document.body.querySelector('.blok-image-lightbox')).not.toBeNull();
  });

  it('does not navigate on a key that is not an arrow', () => {
    open({
      url: 'https://x/b.png',
      navigation: { items: [{ url: 'https://x/a.png' }, { url: 'https://x/b.png' }], startIndex: 1 },
    });

    expect(keydown('a').defaultPrevented).toBe(false);
    expect(displayEl().getAttribute('src')).toBe('https://x/b.png');
  });
});

describe('openLightbox drag to pan', () => {
  function openForDrag(): HTMLElement {
    planDisplayRect({ width: 800, height: 600 });
    open({ url: 'https://x/a.png' });

    return dialogEl();
  }

  it('ignores a drag shorter than the threshold', () => {
    const dialog = openForDrag();

    dialog.dispatchEvent(pointer('pointerdown', 100, 100));
    dialog.dispatchEvent(pointer('pointermove', 102, 102));

    expect(displayEl().style.transform).toBe('translate(0px, 0px) scale(1)');
    expect(dialog.classList.contains('is-dragging')).toBe(false);
  });

  it('does not drag at exactly the threshold distance', () => {
    const dialog = openForDrag();

    dialog.dispatchEvent(pointer('pointerdown', 100, 100));
    dialog.dispatchEvent(pointer('pointermove', 103, 100));

    expect(dialog.classList.contains('is-dragging')).toBe(false);
    expect(displayEl().style.transform).toBe('translate(0px, 0px) scale(1)');
  });

  it('stops panning once the pointer is released', () => {
    const dialog = openForDrag();

    dialog.dispatchEvent(pointer('pointerdown', 0, 0));
    dialog.dispatchEvent(pointer('pointermove', 60, 0));
    dialog.dispatchEvent(pointer('pointerup', 60, 0));
    dialog.dispatchEvent(pointer('pointermove', 120, 0));

    expect(displayEl().style.transform).toBe('translate(60px, 0px) scale(1)');
  });

  it('ignores a pointer press that started on the toolbar', () => {
    const dialog = openForDrag();

    action(toolbarEl(), 'zoom-in').dispatchEvent(pointer('pointerdown', 0, 0));
    dialog.dispatchEvent(pointer('pointermove', 200, 0));

    expect(displayEl().style.transform).toBe('translate(0px, 0px) scale(1)');
  });

  it('pans down when the pointer moves down', () => {
    const dialog = openForDrag();

    dialog.dispatchEvent(pointer('pointerdown', 0, 0));
    dialog.dispatchEvent(pointer('pointermove', 0, 60));
    dialog.dispatchEvent(pointer('pointerup', 0, 60));

    expect(displayEl().style.transform).toBe('translate(0px, 60px) scale(1)');
  });

  it('clamps a leftward drag to the pan limit', () => {
    const dialog = openForDrag();

    dialog.dispatchEvent(pointer('pointerdown', 0, 0));
    dialog.dispatchEvent(pointer('pointermove', -1000, 0));
    dialog.dispatchEvent(pointer('pointerup', -1000, 0));

    expect(displayEl().style.transform).toBe('translate(-400px, 0px) scale(1)');
  });

  it('lets a toolbar mousedown reach the page below', () => {
    const outer = vi.fn();

    openForDrag();
    document.body.addEventListener('mousedown', outer);
    simulateMousedown(action(toolbarEl(), 'zoom-in'));
    document.body.removeEventListener('mousedown', outer);

    expect(outer).toHaveBeenCalledTimes(1);
  });

  it('starts dragging once the pointer passes the threshold', () => {
    const dialog = openForDrag();

    dialog.dispatchEvent(pointer('pointerdown', 100, 100));
    dialog.dispatchEvent(pointer('pointermove', 104, 100));

    expect(dialog.classList.contains('is-dragging')).toBe(true);
    expect(displayEl().style.transform).toBe('translate(4px, 0px) scale(1)');
  });

  it('ignores pointer movement that never started on the dialog', () => {
    const dialog = openForDrag();

    dialog.dispatchEvent(pointer('pointermove', 400, 400));

    expect(displayEl().style.transform).toBe('translate(0px, 0px) scale(1)');
  });

  it('pans from where the previous drag left off', () => {
    const dialog = openForDrag();

    dialog.dispatchEvent(pointer('pointerdown', 0, 0));
    dialog.dispatchEvent(pointer('pointermove', 50, 40));
    dialog.dispatchEvent(pointer('pointerup', 50, 40));
    dialog.dispatchEvent(pointer('pointerdown', 0, 0));
    dialog.dispatchEvent(pointer('pointermove', 30, 20));

    expect(displayEl().style.transform).toBe('translate(80px, 60px) scale(1)');
  });

  it('rubber-bands past the pan limit and springs back on release', () => {
    const dialog = openForDrag();

    dialog.dispatchEvent(pointer('pointerdown', 0, 0));
    dialog.dispatchEvent(pointer('pointermove', 1000, 0));

    expect(displayEl().style.transform).toBe('translate(633.6283185840708px, 0px) scale(1)');

    dialog.dispatchEvent(pointer('pointerup', 1000, 0));

    expect(displayEl().style.transform).toBe('translate(400px, 0px) scale(1)');
    expect(dialog.classList.contains('is-dragging')).toBe(false);
  });

  it('clamps a drag past the vertical limit too', () => {
    const dialog = openForDrag();

    dialog.dispatchEvent(pointer('pointerdown', 0, 0));
    dialog.dispatchEvent(pointer('pointermove', 0, -1000));
    dialog.dispatchEvent(pointer('pointerup', 0, -1000));

    expect(displayEl().style.transform).toBe('translate(0px, -300px) scale(1)');
  });

  it('abandons the pan on pointercancel', () => {
    const dialog = openForDrag();

    dialog.dispatchEvent(pointer('pointerdown', 0, 0));
    dialog.dispatchEvent(pointer('pointermove', 1000, 0));
    dialog.dispatchEvent(pointer('pointercancel', 1000, 0));

    expect(dialog.classList.contains('is-dragging')).toBe(false);
    expect(displayEl().style.transform).toBe('translate(400px, 0px) scale(1)');
  });

  it('swallows only the click that ends a drag, so the next click still closes', () => {
    const dialog = openForDrag();

    dialog.dispatchEvent(pointer('pointerdown', 0, 0));
    dialog.dispatchEvent(pointer('pointermove', 60, 0));
    dialog.dispatchEvent(pointer('pointerup', 60, 0));

    simulateClick(dialog);
    expect(document.body.querySelector('.blok-image-lightbox')).not.toBeNull();

    simulateClick(dialog);
    flushAnimations();
    expect(document.body.querySelector('.blok-image-lightbox')).toBeNull();
  });

  it('lets a navigation button work on the first click after a drag', () => {
    planDisplayRect({ width: 800, height: 600 });
    open({
      url: 'https://x/a.png',
      navigation: { items: [{ url: 'https://x/a.png' }, { url: 'https://x/b.png' }], startIndex: 0 },
    });

    const dialog = dialogEl();

    dialog.dispatchEvent(pointer('pointerdown', 0, 0));
    dialog.dispatchEvent(pointer('pointermove', 60, 0));
    dialog.dispatchEvent(pointer('pointerup', 60, 0));
    action(navEl(), 'lightbox-next').click();

    expect(displayEl().getAttribute('src')).toBe('https://x/b.png');
  });

  it('lets a toolbar button work on the first click after a drag', () => {
    const dialog = openForDrag();

    dialog.dispatchEvent(pointer('pointerdown', 0, 0));
    dialog.dispatchEvent(pointer('pointermove', 60, 0));
    dialog.dispatchEvent(pointer('pointerup', 60, 0));

    action(toolbarEl(), 'zoom-in').click();

    expect(action(toolbarEl(), 'zoom-reset').textContent).toBe('125%');
  });

  it('closes on a plain click that never became a drag', () => {
    const dialog = openForDrag();

    dialog.dispatchEvent(pointer('pointerdown', 100, 100));
    dialog.dispatchEvent(pointer('pointermove', 101, 101));
    dialog.dispatchEvent(pointer('pointerup', 101, 101));
    simulateClick(dialog);
    flushAnimations();

    expect(document.body.querySelector('.blok-image-lightbox')).toBeNull();
  });
});

describe('openLightbox wheel zoom', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function openForWheel(): HTMLElement {
    planRect((el) => el.classList.contains('blok-image-lightbox'), { left: 0, top: 0, width: 1000, height: 800 });
    planDisplayRect({ width: 800, height: 600 });
    open({ url: 'https://x/a.png' });

    return dialogEl();
  }

  it('zooms around the cursor rather than the centre', () => {
    const dialog = openForWheel();

    dialog.dispatchEvent(wheel(-100, { clientX: 700, clientY: 600 }));

    expect(displayEl().style.transform).toBe('translate(-50px, -50px) scale(1.25)');
  });

  it('zooms out when the wheel scrolls down', () => {
    const dialog = openForWheel();

    dialog.dispatchEvent(wheel(100, { clientX: 500, clientY: 400 }));

    expect(action(toolbarEl(), 'zoom-reset').textContent).toBe('80%');
  });

  it('claims the wheel so the page behind does not scroll', () => {
    const dialog = openForWheel();
    const event = wheel(-100, { clientX: 500, clientY: 400 });

    dialog.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('stops at the zoom ceiling', () => {
    const dialog = openForWheel();

    dialog.dispatchEvent(wheel(-10000, { clientX: 500, clientY: 400 }));

    expect(action(toolbarEl(), 'zoom-reset').textContent).toBe('400%');
    expect(action(toolbarEl(), 'zoom-in').disabled).toBe(true);
  });

  it('stops at the zoom floor', () => {
    const dialog = openForWheel();

    dialog.dispatchEvent(wheel(10000, { clientX: 500, clientY: 400 }));

    expect(action(toolbarEl(), 'zoom-reset').textContent).toBe('25%');
    expect(action(toolbarEl(), 'zoom-out').disabled).toBe(true);
  });

  it('suppresses the spring transition while the wheel is moving and restores it when it stops', () => {
    const dialog = openForWheel();

    dialog.dispatchEvent(wheel(-100, { clientX: 500, clientY: 400 }));
    expect(dialog.classList.contains('is-wheel-zooming')).toBe(true);

    vi.advanceTimersByTime(119);
    expect(dialog.classList.contains('is-wheel-zooming')).toBe(true);

    vi.advanceTimersByTime(1);
    expect(dialog.classList.contains('is-wheel-zooming')).toBe(false);
  });

  it('restarts the idle timer on every tick so a continuous scroll stays transition-free', () => {
    const dialog = openForWheel();

    dialog.dispatchEvent(wheel(-100, { clientX: 500, clientY: 400 }));
    vi.advanceTimersByTime(100);
    dialog.dispatchEvent(wheel(-100, { clientX: 500, clientY: 400 }));
    vi.advanceTimersByTime(100);

    expect(dialog.classList.contains('is-wheel-zooming')).toBe(true);

    vi.advanceTimersByTime(20);

    expect(dialog.classList.contains('is-wheel-zooming')).toBe(false);
  });

  it('keeps the pan the wheel computed instead of recentring the image', () => {
    const dialog = openForWheel();

    dialog.dispatchEvent(wheel(-100, { clientX: 700, clientY: 600 }));
    dialog.dispatchEvent(wheel(-100, { clientX: 700, clientY: 600 }));

    expect(displayEl().style.transform).not.toBe('translate(0px, 0px) scale(1.5625)');
  });
});
