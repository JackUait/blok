import {
  IconCaptionImage,
  IconImageAlignCenter,
  IconImageAlignLeft,
  IconImageAlignRight,
  IconLinkExternal,
  IconMoreHorizontal,
} from '../../../components/icons';

export type EmbedAlignment = 'left' | 'center' | 'right';

export interface EmbedOverlayI18n {
  t(key: string): string;
}

export interface EmbedOverlayOptions {
  alignment: EmbedAlignment;
  captionVisible: boolean;
  /** Source URL the "open original" control links to. */
  source: string;
  i18n: EmbedOverlayI18n;
  onAlign(next: EmbedAlignment): void;
  onToggleCaption(): void;
}

const ALIGN_ICON: Record<EmbedAlignment, string> = {
  left: IconImageAlignLeft,
  center: IconImageAlignCenter,
  right: IconImageAlignRight,
};

const ALIGN_ARIA_KEY: Record<EmbedAlignment, string> = {
  left: 'tools.image.alignmentLeftAria',
  center: 'tools.image.alignmentCenterAria',
  right: 'tools.image.alignmentRightAria',
};

const ALIGN_ORDER: EmbedAlignment[] = ['left', 'center', 'right'];

/**
 * Hover toolbar for an iframe embed — alignment, caption toggle, "open original"
 * and a "more" button. Modeled on the image overlay and scoped to the embed tool.
 * Pure builder: it wires the provided callbacks. The "more" button only carries
 * the trigger markup; the tool wires it to the shared block-tunes popover.
 */
export function renderEmbedOverlay(opts: EmbedOverlayOptions): HTMLElement {
  const root = document.createElement('div');

  root.setAttribute('data-role', 'embed-overlay');
  root.className = 'blok-embed-toolbar';

  appendAlignControl(root, opts);
  appendDivider(root);
  appendIconButton(root, {
    action: 'caption-toggle',
    label: opts.i18n.t('tools.image.toggleCaption'),
    icon: IconCaptionImage,
    pressed: opts.captionVisible,
    onClick: opts.onToggleCaption,
  });
  appendOpenOriginal(root, opts);
  appendDivider(root);
  appendMoreButton(root, opts);

  return root;
}

function appendAlignControl(root: HTMLElement, opts: EmbedOverlayOptions): void {
  const wrapper = document.createElement('div');

  wrapper.className = 'blok-embed-toolbar__align';
  wrapper.style.position = 'relative';

  const label = opts.i18n.t('tools.image.alignment');
  const trigger = document.createElement('button');

  trigger.type = 'button';
  trigger.setAttribute('data-action', 'align-trigger');
  trigger.setAttribute('data-current', opts.alignment);
  trigger.setAttribute('aria-label', label);
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML = ALIGN_ICON[opts.alignment];
  wrapper.appendChild(trigger);

  const popover = document.createElement('div');

  popover.setAttribute('data-role', 'align-popover');
  popover.setAttribute('role', 'group');
  popover.setAttribute('aria-label', label);
  popover.className = 'blok-embed-toolbar__align-popover';
  popover.hidden = true;

  const toggle = bindPopover(trigger, popover);

  for (const value of ALIGN_ORDER) {
    const option = document.createElement('button');

    option.type = 'button';
    option.setAttribute('data-action', `align-${value}`);
    option.setAttribute('aria-label', opts.i18n.t(ALIGN_ARIA_KEY[value]));
    option.setAttribute('aria-pressed', opts.alignment === value ? 'true' : 'false');
    option.innerHTML = ALIGN_ICON[value];
    option.addEventListener('click', (event) => {
      event.stopPropagation();
      toggle(false);
      opts.onAlign(value);
    });
    popover.appendChild(option);
  }

  wrapper.appendChild(popover);
  root.appendChild(wrapper);
}

function appendOpenOriginal(root: HTMLElement, opts: EmbedOverlayOptions): void {
  const anchor = document.createElement('a');

  anchor.setAttribute('data-action', 'open-original');
  anchor.className = 'blok-embed-toolbar__btn';
  anchor.href = opts.source;
  anchor.target = '_blank';
  anchor.rel = 'noreferrer nofollow';
  anchor.setAttribute('aria-label', opts.i18n.t('tools.embed.openOriginal'));
  anchor.innerHTML = IconLinkExternal;
  anchor.addEventListener('click', (event) => event.stopPropagation());
  root.appendChild(anchor);
}

/**
 * "More options" trigger. Carries only the markup — the embed tool attaches the
 * click handler that opens the shared block-tunes popover, so the rich menu
 * (search, sections, shortcuts, footer) is identical to the image block's.
 */
function appendMoreButton(root: HTMLElement, opts: EmbedOverlayOptions): void {
  const trigger = document.createElement('button');

  trigger.type = 'button';
  trigger.className = 'blok-embed-toolbar__btn';
  trigger.setAttribute('data-action', 'more');
  trigger.setAttribute('aria-label', opts.i18n.t('tools.image.moreOptions'));
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML = IconMoreHorizontal;
  root.appendChild(trigger);
}

interface IconButtonSpec {
  action: string;
  label: string;
  icon: string;
  pressed?: boolean;
  onClick(): void;
}

function appendIconButton(parent: HTMLElement, spec: IconButtonSpec): void {
  const btn = document.createElement('button');

  btn.type = 'button';
  btn.className = 'blok-embed-toolbar__btn';
  btn.setAttribute('data-action', spec.action);
  btn.setAttribute('aria-label', spec.label);
  if (spec.pressed !== undefined) {
    btn.setAttribute('aria-pressed', spec.pressed ? 'true' : 'false');
  }
  btn.innerHTML = spec.icon;
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    spec.onClick();
  });
  parent.appendChild(btn);
}

function appendDivider(parent: HTMLElement): void {
  const divider = document.createElement('div');

  divider.className = 'blok-embed-toolbar__divider';
  divider.setAttribute('aria-hidden', 'true');
  parent.appendChild(divider);
}

/**
 * Wires a trigger button to its popover with open/close, Escape and
 * outside-click dismissal. Returns a `toggle(next?)` to drive it programmatically.
 */
function bindPopover(trigger: HTMLElement, popover: HTMLElement): (next?: boolean) => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !popover.hidden) {
      event.stopPropagation();
      toggle(false);
    }
  };

  const onOutside = (event: MouseEvent): void => {
    if (popover.hidden) {
      return;
    }
    const target = event.target as Node | null;

    if (target && (popover.contains(target) || trigger.contains(target))) {
      return;
    }
    toggle(false);
  };

  function toggle(next?: boolean): void {
    const open = next ?? popover.hidden;

    popover.toggleAttribute('hidden', !open);
    trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      document.addEventListener('keydown', onKeyDown);
      document.addEventListener('mousedown', onOutside);
    } else {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onOutside);
    }
  }

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    toggle();
  });

  return toggle;
}
