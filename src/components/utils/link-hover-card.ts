import { IconCopy, IconGlobe } from '../icons';

import { promoteToTopLayer, removeFromTopLayer } from './top-layer';
import { twJoin } from './tw';

/**
 * Grace period (ms) between the pointer leaving the anchor/card and the card
 * hiding. Gives the pointer time to travel from the link onto the (hoverable)
 * card without it vanishing — the same "hoverable" affordance the tooltip uses
 * (WCAG 1.4.13).
 */
const GRACE_HIDE_DURATION = 250;

/**
 * Delay (ms) before the card appears after the pointer rests on a link. A short
 * hover-intent gap so brushing past a link mid-sentence doesn't flash the card.
 */
const SHOW_DELAY = 350;

/**
 * Vertical gap (px) between the anchor and the card placed below it. Used by the
 * anchor-relative fallback when no cursor position is supplied.
 */
const OFFSET_TOP = 6;

/**
 * Vertical gap (px) between the link and the card. Anchored to the link's
 * bottom edge (not the pointer) so the gap stays consistent no matter where on
 * the link the pointer rests.
 */
const LINK_GAP_Y = 10;

/**
 * Minimum gap (px) kept between the card and the viewport edges when clamping.
 */
const VIEWPORT_MARGIN = 4;

/**
 * A pointer position in viewport coordinates.
 */
interface CursorPosition {
  x: number;
  y: number;
}

/**
 * Duration (ms) of the enter/leave fade+rise animation. MUST match the
 * `duration-150` transition on the wrapper: the leave animation sets the closed
 * state and removes the element only after this elapses, so the fade-out is
 * seen rather than clipped.
 */
const ANIMATION_DURATION = 150;

/**
 * Shared chrome for the two trailing action buttons (copy / edit). Kept in one
 * const so both stay visually identical. `appearance-none border-0 bg-transparent`
 * + `font-[inherit]` neutralize any host-page global `button {}` styling (e.g.
 * the docs demo page paints a border on every button) so the card renders the
 * same everywhere.
 */
const ACTION_BUTTON_BASE = twJoin(
  // `p-0` is load-bearing: the UA stylesheet gives every <button> ~1px/6px of
  // padding, and neither `appearance-none` nor the width/`px-*` utilities zero
  // it — so without this the copy icon is squeezed into an 8px content box and
  // any host-page `button {}` padding inflates the hover target. Reset it, then
  // let each button add back only the padding it wants.
  'appearance-none border-0 bg-transparent m-0 p-0 box-border font-[inherit] cursor-pointer',
  'inline-flex items-center justify-center h-5 rounded select-none',
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
   * Deferred-show timer armed when the pointer rests on an anchor, so the card
   * only appears after {@link SHOW_DELAY} (hover intent).
   */
  private showTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * The anchor a deferred show is queued for, before the card is visible.
   */
  private pendingAnchor: HTMLAnchorElement | null = null;

  /**
   * The pointer position captured when the show was queued, used to place the
   * card beside the cursor once it appears. Null when the caller positions the
   * card against the anchor instead (e.g. keyboard-driven shows, tests).
   */
  private pendingCursor: CursorPosition | null = null;

  /**
   * Pending entrance-animation frame, cancelled on hide/destroy.
   */
  private enterFrame: number | null = null;

  /**
   * Deferred-removal timer armed on hide so the leave animation plays before the
   * element is detached. Cancelled if the card is re-shown mid-fade.
   */
  private exitTimeout: ReturnType<typeof setTimeout> | null = null;

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
   * Queue the card for the given anchor. Cancels any pending hide and, after a
   * short {@link SHOW_DELAY} (hover intent), shows it. Re-queuing for the same
   * anchor is a no-op so the timer isn't restarted.
   * @param anchor - the link the pointer is hovering
   * @param cursor - the pointer position, so the card can be placed beside the
   * cursor; omit to fall back to anchor-relative placement
   */
  public show(anchor: HTMLAnchorElement, cursor?: CursorPosition): void {
    this.cancelHide();

    // Already visible for this anchor, or already queued for it: nothing to do.
    if (this.currentAnchor === anchor || this.pendingAnchor === anchor) {
      return;
    }

    this.cancelShow();
    this.pendingAnchor = anchor;
    this.pendingCursor = cursor ?? null;
    this.showTimeout = setTimeout(() => {
      this.showTimeout = null;
      this.pendingAnchor = null;
      this.showNow(anchor, this.pendingCursor);
      this.pendingCursor = null;
    }, SHOW_DELAY);
  }

  /**
   * Show the card for the given anchor immediately, positioned beside the cursor
   * (or below the anchor when no cursor is supplied).
   * @param anchor - the link the pointer is hovering
   * @param cursor - the pointer position, or null for anchor-relative placement
   */
  private showNow(anchor: HTMLAnchorElement, cursor: CursorPosition | null): void {
    this.cancelHide();
    // Re-shown while still fading out: keep the (still-connected) element and
    // cancel its scheduled removal so it animates straight back in.
    this.cancelExit();
    this.currentAnchor = anchor;

    const href = anchor.getAttribute('href') ?? anchor.href;

    this.nodes.url.textContent = href;
    this.nodes.url.title = href;

    // In read-only mode the href can't be edited, so drop the edit affordance.
    // The `hidden` attribute alone doesn't hide it: the button's `inline-flex`
    // utility (same specificity as the UA `[hidden] { display: none }` rule)
    // wins, so also force `display` inline — an inline style beats the class.
    const canEdit = this.canEdit();

    this.nodes.editButton.hidden = !canEdit;
    this.nodes.editButton.style.display = canEdit ? '' : 'none';

    if (!this.nodes.wrapper.isConnected) {
      document.body.appendChild(this.nodes.wrapper);
    }

    this.shown = true;
    promoteToTopLayer(this.nodes.wrapper);
    this.position(anchor, cursor);

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

    // The pointer left before the card ever appeared: abort the queued show
    // rather than arming a hide for something that isn't visible.
    if (!this.shown) {
      this.cancelShow();

      return;
    }

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
   * Cancel a pending deferred show (e.g. the pointer left before it appeared).
   */
  public cancelShow(): void {
    if (this.showTimeout !== null) {
      clearTimeout(this.showTimeout);
      this.showTimeout = null;
    }
    this.pendingAnchor = null;
  }

  /**
   * Hide the card, playing the leave animation before detaching it.
   */
  public hide(): void {
    this.cancelHide();
    this.cancelShow();
    this.cancelEnterFrame();

    if (!this.shown) {
      return;
    }

    this.shown = false;
    this.currentAnchor = null;

    // Flip to the closed state so the fade+rise transition plays in reverse,
    // then detach only after it finishes. Kept in the Top Layer for the
    // duration so the animation is visible above host content.
    this.nodes.wrapper.setAttribute('data-state', 'closed');
    this.cancelExit();
    this.exitTimeout = setTimeout(() => {
      this.exitTimeout = null;
      removeFromTopLayer(this.nodes.wrapper);
      this.nodes.wrapper.remove();
    }, ANIMATION_DURATION);
  }

  /**
   * Cancel a pending deferred removal (e.g. the card is re-shown mid-fade-out).
   */
  private cancelExit(): void {
    if (this.exitTimeout !== null) {
      clearTimeout(this.exitTimeout);
      this.exitTimeout = null;
    }
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
    this.cancelShow();
    this.cancelEnterFrame();
    this.cancelExit();
    removeFromTopLayer(this.nodes.wrapper);
    this.nodes.wrapper.remove();
    this.currentAnchor = null;
    this.shown = false;
  }

  /**
   * Place the card centered horizontally under the cursor, shifting left or
   * right only when centering would push it past a viewport edge. Falls back to
   * below the anchor when no cursor is supplied. Clamped to the viewport in both
   * axes.
   * @param anchor - the anchor to position against (fallback)
   * @param cursor - the pointer position, or null for anchor-relative placement
   */
  private position(anchor: HTMLAnchorElement, cursor: CursorPosition | null): void {
    const width = this.nodes.wrapper.offsetWidth;

    if (cursor) {
      const height = this.nodes.wrapper.offsetHeight;
      const rect = anchor.getBoundingClientRect();

      // Center on the cursor; the clamp shifts it left or right when a viewport
      // edge is too close to keep it centered.
      const centeredLeft = cursor.x - width / 2;
      const left = Math.max(VIEWPORT_MARGIN, Math.min(centeredLeft, window.innerWidth - width - VIEWPORT_MARGIN));

      // Keep a fixed gap between the link and the card by anchoring vertically to
      // the link's bottom edge; flip above the link when it would spill past the
      // bottom edge of the viewport.
      const belowPlacement = rect.bottom + LINK_GAP_Y;
      const overflowsBottom = belowPlacement + height > window.innerHeight - VIEWPORT_MARGIN;
      const desiredTop = overflowsBottom ? rect.top - LINK_GAP_Y - height : belowPlacement;
      const top = Math.max(VIEWPORT_MARGIN, desiredTop);

      this.nodes.wrapper.style.left = `${left}px`;
      this.nodes.wrapper.style.top = `${top}px`;

      return;
    }

    const rect = anchor.getBoundingClientRect();
    const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN));
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
      // NOTE: no `h-*` here on purpose. The Top-Layer reset (see below) forces
      // `height: auto`, so any height utility is dead — the card's height comes
      // entirely from its content plus the inline vertical padding set below.
      'flex items-center',
      'bg-popover-bg rounded-lg',
      'shadow-[0_1px_2px_rgba(13,20,33,0.04),0_8px_22px_-8px_rgba(13,20,33,0.12)]',
      'text-sm leading-none text-text-primary',
      // Enter/leave: fade + very subtle rise. Base (closed) state is hidden and
      // nudged up 1px; data-state="open" (set a frame after mount) animates it
      // in, and hide() flips back to closed so the transition plays in reverse.
      'opacity-0 translate-y-[-1px] transition-[opacity,transform] duration-150 ease-out',
      'data-[state=open]:opacity-100 data-[state=open]:translate-y-0',
      'mobile:hidden'
    );
    // Border and padding are applied inline, not via utilities: this card is
    // promoted to the Top Layer, and the `[data-blok-top-layer][popover]` reset
    // in isolation.css (specificity 0,2,0) zeroes `border`, `padding` AND
    // `height` on the promoted element, overriding any Tailwind utility (0,1,0).
    // Inline styles beat that reset. The vertical padding is load-bearing: with
    // `height` reset to auto the card is exactly as tall as its content, so
    // without it the action buttons' hover background fills the card top-to-
    // bottom edge-to-edge. This padding gives the buttons vertical breathing
    // room so the hover reads as a snug pill, not a full-height block.
    wrapper.style.borderWidth = '1px';
    wrapper.style.borderStyle = 'solid';
    wrapper.style.borderColor = 'var(--blok-popover-border, rgba(13, 20, 33, 0.12))';
    wrapper.style.paddingTop = '0.25rem';
    wrapper.style.paddingBottom = '0.25rem';
    wrapper.style.paddingLeft = '0.625rem';
    wrapper.style.paddingRight = '0.375rem';
    wrapper.setAttribute('data-state', 'closed');
    wrapper.setAttribute('data-blok-testid', 'link-hover-card');
    // The card is body-mounted, outside the editor root. Compiled Tailwind
    // utilities and the preflight reset are scoped to
    // `[data-blok-interface]`/`[data-blok-popover]` roots, so without this
    // attribute EVERY utility above silently dies in consumer apps (the
    // playground's own unscoped Tailwind masks it). It also resolves the
    // popover color tokens (bg-popover-bg, dark theme) from colors.css.
    // `data-blok-interface` deliberately, NOT `data-blok-popover`: the latter
    // is also the Popover COMPONENT's styling hook, whose isolation rules
    // (`font-size: initial`; `background: transparent` once [popover]-promoted)
    // would clobber this card's root-level `text-sm` and `bg-popover-bg`.
    // Enforced by body-mount-scope-law.test.ts.
    wrapper.setAttribute('data-blok-interface', 'link-hover-card');

    const globe = document.createElement('span');

    globe.className = 'shrink-0 flex items-center mr-2 text-gray-text [&>svg]:size-4';
    globe.innerHTML = IconGlobe;

    const url = document.createElement('button');

    url.type = 'button';
    url.className = twJoin(
      'appearance-none border-0 bg-transparent m-0 p-0 font-[inherit] cursor-pointer',
      'min-w-0 max-w-[280px] truncate text-left text-gray-text',
      'underline-offset-2 can-hover:hover:underline can-hover:hover:text-text-primary'
    );
    url.setAttribute('data-blok-testid', 'link-hover-card-url');
    url.addEventListener('click', this.handleOpen);

    const copyButton = document.createElement('button');

    copyButton.type = 'button';
    copyButton.className = twJoin(ACTION_BUTTON_BASE, 'ml-2 w-5 [&>svg]:size-4');
    copyButton.setAttribute('aria-label', this.labels.copy);
    copyButton.setAttribute('data-blok-testid', 'link-hover-card-copy');
    copyButton.innerHTML = IconCopy;
    copyButton.addEventListener('click', this.handleCopy);

    const editButton = document.createElement('button');

    editButton.type = 'button';
    editButton.className = twJoin(ACTION_BUTTON_BASE, 'ml-1 px-1');
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
