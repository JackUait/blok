import { IconCopy, IconGlobe } from '../icons';

import { promoteToTopLayer, removeFromTopLayer } from './top-layer';
import { twJoin } from './tw';

/**
 * Grace period (ms) between the pointer leaving the anchor/card and the card
 * hiding. Gives the pointer time to travel from the link onto the (hoverable)
 * card without it vanishing — the same "hoverable" affordance the tooltip uses
 * (WCAG 1.4.13).
 */
const GRACE_HIDE_DURATION = 100;

/**
 * Vertical gap (px) between the anchor and the card placed below it.
 */
const OFFSET_TOP = 6;

/**
 * Shared chrome for the two trailing action buttons (copy / edit). Kept in one
 * const so both stay visually identical. `appearance-none border-0 bg-transparent`
 * + `font-[inherit]` neutralize any host-page global `button {}` styling (e.g.
 * the docs demo page paints a border on every button) so the card renders the
 * same everywhere.
 */
const ACTION_BUTTON_BASE = twJoin(
  'appearance-none border-0 bg-transparent m-0 box-border font-[inherit] cursor-pointer',
  'inline-flex items-center justify-center h-7 rounded-md select-none',
  'text-gray-text transition-colors',
  'can-hover:hover:bg-item-hover-bg can-hover:hover:text-text-primary'
);

interface LinkHoverCardLabels {
  /**
   * Accessible label for the copy-URL button.
   */
  copy: string;
  /**
   * Text of the edit button.
   */
  edit: string;
}

interface LinkHoverCardCallbacks {
  /**
   * Called with the anchor href when the URL itself is activated (opens it).
   */
  onOpen: (href: string) => void;
  /**
   * Called with the anchor href when the copy button is activated.
   */
  onCopy: (href: string) => void;
  /**
   * Called with the anchor when the edit button is activated.
   */
  onEdit: (anchor: HTMLAnchorElement) => void;
}

interface LinkHoverCardOptions {
  labels: LinkHoverCardLabels;
  callbacks: LinkHoverCardCallbacks;
  /**
   * Whether the edit affordance should be shown. Returns false in read-only
   * mode, where editing the href is not possible.
   */
  canEdit: () => boolean;
}

/**
 * A compact, hoverable card shown when the pointer rests on a link inside the
 * editor. Mirrors the read-only "clickable link" affordance while editing:
 * surfaces the destination URL (clickable — opens the link) plus copy / edit
 * actions, without forcing the caret into the anchor.
 *
 * Styled to match Blok's own floating chrome (`bg-popover-bg`, the popover
 * hairline border and overlay shadow, `bg-item-hover-bg` hovers) so it reads as
 * a native control. Promoted to the CSS Top Layer so it renders above host-page
 * content, and stays open while the pointer is over it (grace-hide) so its
 * buttons remain reachable.
 */
export class LinkHoverCard {
  /**
   * Card DOM nodes.
   */
  private nodes: {
    wrapper: HTMLElement;
    url: HTMLButtonElement;
    editButton: HTMLButtonElement;
  };

  /**
   * The anchor the card currently describes.
   */
  private currentAnchor: HTMLAnchorElement | null = null;

  /**
   * Deferred-hide timer armed when the pointer leaves the anchor or the card.
   */
  private graceHideTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Pending entrance-animation frame, cancelled on hide/destroy.
   */
  private enterFrame: number | null = null;

  /**
   * Whether the card is currently visible.
   */
  private shown = false;

  private readonly labels: LinkHoverCardLabels;

  private readonly callbacks: LinkHoverCardCallbacks;

  private readonly canEdit: () => boolean;

  constructor(options: LinkHoverCardOptions) {
    this.labels = options.labels;
    this.callbacks = options.callbacks;
    this.canEdit = options.canEdit;
    this.nodes = this.build();
  }

  /**
   * Show the card for the given anchor, positioned below it.
   * @param anchor - the link the pointer is hovering
   */
  public show(anchor: HTMLAnchorElement): void {
    this.cancelHide();
    this.currentAnchor = anchor;

    const href = anchor.getAttribute('href') ?? anchor.href;

    this.nodes.url.textContent = href;
    this.nodes.url.title = href;
    this.nodes.editButton.hidden = !this.canEdit();

    if (!this.nodes.wrapper.isConnected) {
      document.body.appendChild(this.nodes.wrapper);
    }

    this.shown = true;
    promoteToTopLayer(this.nodes.wrapper);
    this.position(anchor);

    // Entrance: fade + rise once positioned. Guarded so re-showing over the
    // same target doesn't restart the animation mid-hover.
    this.cancelEnterFrame();
    this.enterFrame = requestAnimationFrame(() => {
      this.enterFrame = null;
      this.nodes.wrapper.setAttribute('data-state', 'open');
    });
  }

  /**
   * Arm the grace timer that hides the card after {@link GRACE_HIDE_DURATION}.
   * Called when the pointer leaves the anchor, so it has time to travel onto
   * the card without the card vanishing.
   */
  public scheduleHide(): void {
    this.cancelHide();
    this.graceHideTimeout = setTimeout(() => {
      this.graceHideTimeout = null;
      this.hide();
    }, GRACE_HIDE_DURATION);
  }

  /**
   * Cancel a pending grace hide (e.g. the pointer reached the card in time).
   */
  public cancelHide(): void {
    if (this.graceHideTimeout !== null) {
      clearTimeout(this.graceHideTimeout);
      this.graceHideTimeout = null;
    }
  }

  /**
   * Hide the card immediately.
   */
  public hide(): void {
    this.cancelHide();
    this.cancelEnterFrame();

    if (!this.shown) {
      return;
    }

    this.shown = false;
    this.currentAnchor = null;
    this.nodes.wrapper.setAttribute('data-state', 'closed');
    removeFromTopLayer(this.nodes.wrapper);
    this.nodes.wrapper.remove();
  }

  /**
   * The anchor the card currently describes, if visible.
   */
  public get anchor(): HTMLAnchorElement | null {
    return this.shown ? this.currentAnchor : null;
  }

  /**
   * Release DOM and pending timers.
   */
  public destroy(): void {
    this.cancelHide();
    this.cancelEnterFrame();
    removeFromTopLayer(this.nodes.wrapper);
    this.nodes.wrapper.remove();
    this.currentAnchor = null;
    this.shown = false;
  }

  /**
   * Place the card below the anchor, left-aligned, clamped to the viewport.
   * @param anchor - the anchor to position against
   */
  private position(anchor: HTMLAnchorElement): void {
    const rect = anchor.getBoundingClientRect();
    const width = this.nodes.wrapper.offsetWidth;
    const left = Math.max(4, Math.min(rect.left, window.innerWidth - width - 4));
    const top = rect.bottom + OFFSET_TOP;

    this.nodes.wrapper.style.left = `${left}px`;
    this.nodes.wrapper.style.top = `${top}px`;
  }

  /**
   * Cancel a pending entrance frame.
   */
  private cancelEnterFrame(): void {
    if (this.enterFrame !== null) {
      cancelAnimationFrame(this.enterFrame);
      this.enterFrame = null;
    }
  }

  /**
   * Build the card DOM once.
   */
  private build(): LinkHoverCard['nodes'] {
    const wrapper = document.createElement('div');

    wrapper.className = twJoin(
      'fixed z-overlay top-0 left-0',
      'flex items-center h-9 pl-3 pr-1.5',
      'bg-popover-bg rounded-xl',
      'shadow-[0_1px_2px_rgba(13,20,33,0.04),0_8px_22px_-8px_rgba(13,20,33,0.12)]',
      'text-sm leading-none text-text-primary',
      // Entrance: hidden + nudged down until data-state="open" (set next frame).
      'opacity-0 translate-y-[-2px] transition-[opacity,transform] duration-100 ease-out',
      'data-[state=open]:opacity-100 data-[state=open]:translate-y-0',
      'mobile:hidden'
    );
    // Border is applied inline, not via a `border` utility: Blok's stylesheet is
    // prepended to <head> (lowest priority), so a host page's own CSS reset
    // (e.g. Tailwind preflight zeroing border-width) would otherwise win and the
    // border would vanish. Inline styles beat host author stylesheets. The color
    // stays theme-aware by resolving the token, which is re-declared on
    // [data-blok-top-layer] where this promoted card lives.
    wrapper.style.borderWidth = '1px';
    wrapper.style.borderStyle = 'solid';
    wrapper.style.borderColor = 'color-mix(in srgb, var(--color-gray-text) 30%, transparent)';
    wrapper.setAttribute('data-state', 'closed');
    wrapper.setAttribute('data-blok-testid', 'link-hover-card');

    const globe = document.createElement('span');

    globe.className = 'shrink-0 flex items-center mr-2 text-gray-text [&>svg]:size-4';
    globe.innerHTML = IconGlobe;

    const url = document.createElement('button');

    url.type = 'button';
    url.className = twJoin(
      'appearance-none border-0 bg-transparent m-0 p-0 font-[inherit] cursor-pointer',
      'min-w-0 max-w-[280px] truncate text-left font-medium text-text-primary',
      'underline-offset-2 can-hover:hover:underline'
    );
    url.setAttribute('data-blok-testid', 'link-hover-card-url');
    url.addEventListener('click', this.handleOpen);

    const copyButton = document.createElement('button');

    copyButton.type = 'button';
    copyButton.className = twJoin(ACTION_BUTTON_BASE, 'ml-2 w-7 [&>svg]:size-4');
    copyButton.setAttribute('aria-label', this.labels.copy);
    copyButton.setAttribute('data-blok-testid', 'link-hover-card-copy');
    copyButton.innerHTML = IconCopy;
    copyButton.addEventListener('click', this.handleCopy);

    const editButton = document.createElement('button');

    editButton.type = 'button';
    editButton.className = twJoin(ACTION_BUTTON_BASE, 'px-2 font-medium text-text-primary');
    editButton.setAttribute('data-blok-testid', 'link-hover-card-edit');
    editButton.textContent = this.labels.edit;
    editButton.addEventListener('click', this.handleEdit);

    wrapper.append(globe, url, copyButton, editButton);

    // Hoverable card: keep it open while the pointer is over it.
    wrapper.addEventListener('mouseenter', () => this.cancelHide());
    wrapper.addEventListener('mouseleave', () => this.scheduleHide());

    document.body.appendChild(wrapper);

    return { wrapper, url, editButton };
  }

  /**
   * URL click handler — opens the destination then hides the card.
   */
  private handleOpen = (): void => {
    const href = this.hrefOf(this.currentAnchor);

    this.hide();

    if (href) {
      this.callbacks.onOpen(href);
    }
  };

  /**
   * Copy button handler — forwards the href to the caller then hides the card.
   */
  private handleCopy = (): void => {
    const href = this.hrefOf(this.currentAnchor);

    if (href) {
      this.callbacks.onCopy(href);
    }
    this.hide();
  };

  /**
   * Edit button handler — forwards the anchor to the caller then hides the card.
   */
  private handleEdit = (): void => {
    const anchor = this.currentAnchor;

    this.hide();

    if (anchor) {
      this.callbacks.onEdit(anchor);
    }
  };

  /**
   * Resolve an anchor's href, preferring the raw attribute over the resolved
   * property so internal/relative links surface as authored.
   * @param anchor - the anchor to read
   */
  private hrefOf(anchor: HTMLAnchorElement | null): string | undefined {
    return anchor?.getAttribute('href') ?? anchor?.href;
  }
}
