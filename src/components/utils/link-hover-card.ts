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
 * A light, hoverable card shown when the pointer rests on a link inside the
 * editor. Mirrors the read-only "clickable link" affordance while editing:
 * surfaces the destination URL and offers copy / edit actions without forcing
 * the caret into the anchor.
 *
 * The card is promoted to the CSS Top Layer so it renders above host-page
 * content, and stays open while the pointer is over it (grace-hide) so its
 * buttons remain reachable.
 */
export class LinkHoverCard {
  /**
   * Card DOM nodes.
   */
  private nodes: {
    wrapper: HTMLElement;
    url: HTMLElement;
    copyButton: HTMLButtonElement;
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
    this.nodes.editButton.hidden = !this.canEdit();

    if (!this.nodes.wrapper.isConnected) {
      document.body.appendChild(this.nodes.wrapper);
    }

    this.nodes.wrapper.style.visibility = 'hidden';
    this.shown = true;
    promoteToTopLayer(this.nodes.wrapper);
    this.position(anchor);
    this.nodes.wrapper.style.visibility = 'visible';
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

    if (!this.shown) {
      return;
    }

    this.shown = false;
    this.currentAnchor = null;
    removeFromTopLayer(this.nodes.wrapper);
    this.nodes.wrapper.style.visibility = 'hidden';
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
   * Build the card DOM once.
   */
  private build(): LinkHoverCard['nodes'] {
    const wrapper = document.createElement('div');

    wrapper.className = twJoin(
      'fixed z-overlay top-0 left-0',
      'flex items-center gap-1.5 max-w-[360px]',
      'pl-2.5 pr-1.5 py-1',
      'bg-popover-bg rounded-xl shadow-tooltip',
      'text-sm text-text-primary',
      'mobile:hidden'
    );
    wrapper.style.visibility = 'hidden';
    wrapper.setAttribute('data-blok-testid', 'link-hover-card');

    const globe = document.createElement('span');

    globe.className = 'shrink-0 flex text-gray-text [&>svg]:size-4';
    globe.innerHTML = IconGlobe;

    const url = document.createElement('span');

    url.className = 'min-w-0 truncate font-medium';
    url.setAttribute('data-blok-testid', 'link-hover-card-url');

    const copyButton = document.createElement('button');

    copyButton.type = 'button';
    copyButton.className = twJoin(
      'shrink-0 flex items-center justify-center size-7 rounded-lg',
      'text-gray-text can-hover:hover:bg-item-hover-bg transition-colors',
      '[&>svg]:size-4'
    );
    copyButton.setAttribute('aria-label', this.labels.copy);
    copyButton.setAttribute('data-blok-testid', 'link-hover-card-copy');
    copyButton.innerHTML = IconCopy;
    copyButton.addEventListener('click', this.handleCopy);

    const editButton = document.createElement('button');

    editButton.type = 'button';
    editButton.className = twJoin(
      'shrink-0 px-2 h-7 rounded-lg font-medium',
      'text-text-primary can-hover:hover:bg-item-hover-bg transition-colors'
    );
    editButton.textContent = this.labels.edit;
    editButton.setAttribute('data-blok-testid', 'link-hover-card-edit');
    editButton.addEventListener('click', this.handleEdit);

    wrapper.append(globe, url, copyButton, editButton);

    // Hoverable card: keep it open while the pointer is over it.
    wrapper.addEventListener('mouseenter', () => this.cancelHide());
    wrapper.addEventListener('mouseleave', () => this.scheduleHide());

    document.body.appendChild(wrapper);

    return { wrapper, url, copyButton, editButton };
  }

  /**
   * Copy button handler — forwards the href to the caller then hides the card.
   */
  private handleCopy = (): void => {
    const href = this.currentAnchor?.getAttribute('href') ?? this.currentAnchor?.href;

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
}
