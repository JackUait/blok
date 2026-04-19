import type { ImageAlignment, ImageData, ImageSize } from '../../../types/tools/image';

const ALIGNMENT_TO_TEXT_ALIGN: Record<ImageAlignment, string> = {
  left: 'left',
  center: 'center',
  right: 'right',
};

const ALIGNMENT_ICON: Record<ImageAlignment, string> = {
  left:   '<path d="M3 6h18M3 12h10M3 18h14"/>',
  center: '<path d="M3 6h18M7 12h10M5 18h14"/>',
  right:  '<path d="M3 6h18M11 12h10M7 18h14"/>',
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
  hasAlt: boolean;
  size: ImageSize;
}

export interface OverlayOptions {
  state: OverlayState;
  onAlign(next: ImageAlignment): void;
  onSize(next: ImageSize): void;
  onReplace(): void;
  onAlt(): void;
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
    svg: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    onClick: opts.onToggleCaption,
  });
  appendSimpleButton(root, {
    action: 'alt',
    label: 'Edit alt text',
    pressed: opts.state.hasAlt,
    svg: '<path d="M4 4h16v14H5l-3 3V4z"/><path d="M8 11h8M8 7h8"/>',
    onClick: opts.onAlt,
  });
  appendSimpleButton(root, {
    action: 'replace',
    label: 'Replace image',
    svg: '<path d="M3 12a9 9 0 0115-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 01-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
    onClick: opts.onReplace,
  });
  appendSimpleButton(root, {
    action: 'fullscreen',
    label: 'View fullscreen',
    svg: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    onClick: opts.onFullscreen,
  });
  appendSimpleButton(root, {
    action: 'download',
    label: 'Download original',
    svg: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
    onClick: opts.onDownload,
  });

  appendDivider(root);

  const more = document.createElement('button');
  more.type = 'button';
  more.setAttribute('data-action', 'more');
  more.setAttribute('aria-label', 'More options');
  more.setAttribute('aria-haspopup', 'menu');
  more.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>';
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
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ALIGNMENT_ICON[value]}</svg>`;
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
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${spec.svg}</svg>`;
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    spec.onClick();
  });
  parent.appendChild(btn);
}

export interface MorePopoverOptions {
  size: ImageSize;
  onSize(next: ImageSize): void;
  onCopyUrl(): void;
  onDownload(): void;
  onDuplicate?(): void;
  onDelete(): void;
}

export function renderMorePopover(opts: MorePopoverOptions): HTMLElement {
  const root = document.createElement('div');
  root.className = 'blok-image-popover';
  root.setAttribute('role', 'menu');
  root.setAttribute('data-role', 'image-popover');

  const sizeLabel = document.createElement('div');
  sizeLabel.className = 'blok-image-popover__label';
  sizeLabel.textContent = 'Size';
  root.appendChild(sizeLabel);

  const sizes = document.createElement('div');
  sizes.className = 'blok-image-popover__sizes';
  const sizeDefs: { value: ImageSize; label: string }[] = [
    { value: 'sm',   label: 'Small' },
    { value: 'md',   label: 'Medium' },
    { value: 'lg',   label: 'Large' },
    { value: 'full', label: 'Full' },
  ];
  for (const s of sizeDefs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'blok-image-popover__size';
    btn.setAttribute('data-action', `size-${s.value}`);
    btn.setAttribute('aria-pressed', opts.size === s.value ? 'true' : 'false');
    btn.textContent = s.label;
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      opts.onSize(s.value);
    });
    sizes.appendChild(btn);
  }
  root.appendChild(sizes);

  appendSep(root);

  appendPopoverItem(root, {
    action: 'download',
    label: 'Download original',
    onClick: opts.onDownload,
  });
  appendPopoverItem(root, {
    action: 'copy-url',
    label: 'Copy URL',
    onClick: opts.onCopyUrl,
  });
  if (opts.onDuplicate) {
    appendPopoverItem(root, {
      action: 'duplicate',
      label: 'Duplicate',
      onClick: opts.onDuplicate,
    });
  }

  appendSep(root);

  appendPopoverItem(root, {
    action: 'delete',
    label: 'Delete',
    onClick: opts.onDelete,
    danger: true,
  });

  return root;
}

function appendSep(parent: HTMLElement): void {
  const s = document.createElement('div');
  s.className = 'blok-image-popover__sep';
  parent.appendChild(s);
}

interface PopoverItemSpec {
  action: string;
  label: string;
  onClick(): void;
  danger?: boolean;
}

function appendPopoverItem(parent: HTMLElement, spec: PopoverItemSpec): void {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = spec.danger
    ? 'blok-image-popover__item is-danger'
    : 'blok-image-popover__item';
  btn.setAttribute('role', 'menuitem');
  btn.setAttribute('data-action', spec.action);
  btn.textContent = spec.label;
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    spec.onClick();
  });
  parent.appendChild(btn);
}
