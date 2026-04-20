import type { ImageAlignment, ImageData, ImageSize } from '../../../types/tools/image';

const ALIGNMENT_TO_TEXT_ALIGN: Record<ImageAlignment, string> = {
  left: 'left',
  center: 'center',
  right: 'right',
};

const ALIGNMENT_ICON: Record<ImageAlignment, string> = {
  left:   '<path d="M21 6H3"/><path d="M15 12H3"/><path d="M17 18H3"/>',
  center: '<path d="M21 6H3"/><path d="M17 12H7"/><path d="M19 18H5"/>',
  right:  '<path d="M21 6H3"/><path d="M21 12H9"/><path d="M21 18H7"/>',
};

const ALIGNMENT_LABEL: Record<ImageAlignment, string> = {
  left: 'Align left',
  center: 'Align center',
  right: 'Align right',
};

export function renderImage(
  data: Partial<ImageData> & { url: string }
): HTMLElement {
  const alignment = data.alignment ?? 'center';
  const figure = document.createElement('figure');
  figure.className = 'blok-image-inner';
  figure.style.margin = '0';
  figure.style.textAlign = ALIGNMENT_TO_TEXT_ALIGN[alignment];
  figure.style.position = 'relative';
  if (data.width !== undefined) {
    figure.style.width = `${data.width}%`;
  }

  const img = document.createElement('img');
  img.setAttribute('src', data.url);
  img.setAttribute('alt', data.alt ?? '');
  img.draggable = false;

  figure.appendChild(img);

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
}

export function renderCaptionRow(opts: CaptionRowOptions): HTMLElement {
  const row = document.createElement('div');
  row.className = 'blok-image-caption-row';
  row.appendChild(renderCaption(opts.caption));

  if (opts.onAlt) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'blok-image-caption-row__alt';
    btn.setAttribute('data-action', 'alt-edit');
    btn.setAttribute('aria-label', 'Edit alt text');
    btn.setAttribute('title', 'Edit alt text');
    btn.setAttribute('aria-pressed', opts.hasAlt ? 'true' : 'false');
    btn.textContent = 'Alt';
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
}

export function openLightbox(opts: LightboxOptions): () => void {
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Image preview');
  Object.assign(dialog.style, {
    position: 'fixed',
    inset: '0',
    background: 'rgba(0,0,0,0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: '9999',
    cursor: 'zoom-out',
  } satisfies Partial<CSSStyleDeclaration>);

  const img = document.createElement('img');
  img.setAttribute('src', opts.url);
  img.setAttribute('alt', opts.alt ?? '');
  Object.assign(img.style, {
    maxWidth: '95vw',
    maxHeight: '95vh',
    objectFit: 'contain',
  } satisfies Partial<CSSStyleDeclaration>);

  dialog.appendChild(img);
  document.body.appendChild(dialog);

  const close = (): void => {
    document.removeEventListener('keydown', onKey);
    dialog.remove();
    previousFocus?.focus?.();
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' || event.key === ' ') {
      event.preventDefault();
      close();
    }
  };

  dialog.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  dialog.focus();

  return close;
}

export interface OverlayState {
  alignment: ImageAlignment;
  captionVisible: boolean;
  size: ImageSize;
}

export interface OverlayOptions {
  state: OverlayState;
  onAlign(next: ImageAlignment): void;
  onSize(next: ImageSize): void;
  onReplace(): void;
  onDelete(): void;
  onDownload(): void;
  onFullscreen(): void;
  onCopyUrl(): void;
  onToggleCaption(): void;
}

/**
 * Data-action naming stays stable for test & user-code targeting.
 * Additional visual-only elements carry their own class names.
 */
export function renderOverlay(opts: OverlayOptions): HTMLElement {
  const root = document.createElement('div');
  root.setAttribute('data-role', 'image-overlay');
  root.className = 'blok-image-toolbar';

  appendAlignmentControl(root, opts);

  appendDivider(root);

  appendSimpleButton(root, {
    action: 'caption-toggle',
    label: 'Toggle caption',
    pressed: opts.state.captionVisible,
    svg: '<rect x="3" y="3.5" width="18" height="12" rx="2.5"/><path d="M5 19h14"/><path d="M8 22h8"/>',
    onClick: opts.onToggleCaption,
  });
  appendSimpleButton(root, {
    action: 'replace',
    label: 'Replace image',
    svg: '<path d="M4 7h15"/><path d="m15 3 4 4-4 4"/><path d="M20 17H5"/><path d="m9 13-4 4 4 4"/>',
    onClick: opts.onReplace,
  });
  appendSimpleButton(root, {
    action: 'fullscreen',
    label: 'View fullscreen',
    svg: '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/>',
    onClick: opts.onFullscreen,
  });
  appendSimpleButton(root, {
    action: 'download',
    label: 'Download original',
    svg: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    onClick: opts.onDownload,
  });

  appendDivider(root);

  const more = document.createElement('button');
  more.type = 'button';
  more.setAttribute('data-action', 'more');
  more.setAttribute('aria-label', 'More options');
  more.setAttribute('aria-haspopup', 'menu');
  more.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>';
  root.appendChild(more);

  // Delete is reachable from the popover; expose an invisible legacy button for consumers/tests.
  const deleteAlias = document.createElement('button');
  deleteAlias.type = 'button';
  deleteAlias.setAttribute('data-action', 'delete');
  deleteAlias.setAttribute('aria-label', 'Delete');
  deleteAlias.className = 'blok-image-toolbar__alias is-danger';
  deleteAlias.style.display = 'none';
  deleteAlias.addEventListener('click', (event) => {
    event.stopPropagation();
    opts.onDelete();
  });
  root.appendChild(deleteAlias);

  return root;
}

function appendAlignmentControl(root: HTMLElement, opts: OverlayOptions): void {
  const wrapper = document.createElement('div');
  wrapper.className = 'blok-image-toolbar__align';
  wrapper.style.position = 'relative';

  const current = opts.state.alignment;

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.setAttribute('data-action', 'align-trigger');
  trigger.setAttribute('data-current', current);
  trigger.setAttribute('aria-label', 'Alignment');
  trigger.setAttribute('title', 'Alignment');
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML = alignmentIconSvg(current);
  wrapper.appendChild(trigger);

  const popover = document.createElement('div');
  popover.setAttribute('data-role', 'align-popover');
  popover.setAttribute('role', 'group');
  popover.setAttribute('aria-label', 'Alignment');
  popover.className = 'blok-image-toolbar__align-popover';
  popover.hidden = true;

  for (const value of ['left', 'center', 'right'] as ImageAlignment[]) {
    const option = document.createElement('button');
    option.type = 'button';
    option.setAttribute('data-action', `align-${value}`);
    option.setAttribute('aria-label', ALIGNMENT_LABEL[value]);
    option.setAttribute('title', ALIGNMENT_LABEL[value]);
    option.setAttribute('aria-pressed', current === value ? 'true' : 'false');
    option.innerHTML = alignmentIconSvg(value);
    option.addEventListener('click', (event) => {
      event.stopPropagation();
      opts.onAlign(value);
      closePopover();
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

  const openPopover = (): void => {
    if (!popover.hidden) return;
    popover.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onOutside);
  };

  function closePopover(): void {
    if (popover.hidden) return;
    popover.hidden = true;
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

function alignmentIconSvg(value: ImageAlignment): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ALIGNMENT_ICON[value]}</svg>`;
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
  svg: string;
  onClick(): void;
  pressed?: boolean;
}

function appendSimpleButton(parent: HTMLElement, spec: SimpleButtonSpec): void {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('aria-label', spec.label);
  btn.setAttribute('title', spec.label);
  btn.setAttribute('data-action', spec.action);
  if (spec.pressed !== undefined) {
    btn.setAttribute('aria-pressed', spec.pressed ? 'true' : 'false');
  }
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${spec.svg}</svg>`;
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    spec.onClick();
  });
  parent.appendChild(btn);
}

