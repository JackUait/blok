import { syncPortalDirection } from '../utils/portal-direction';
import { promoteToTopLayer, removeFromTopLayer } from '../utils/top-layer';

import type { ToolboxPreviewConfig } from '@/types';

/** Must match the card width in block-preview.css; placement math uses it before layout. */
export const PREVIEW_CARD_WIDTH = 248;

/** How long the pointer rests on a row before the first card opens. */
export const PREVIEW_OPEN_DELAY = 320;

/** After a close, the next card opens without the delay for this long (moving between rows). */
const WARM_WINDOW = 400;

const GAP = 8;
const VIEWPORT_MARGIN = 8;

export interface ToolboxPreviewShowParams {
  /** The row the card describes; the card lines up with its top. */
  item: HTMLElement;
  /** The menu surface; the card sits beside it, never over it. */
  surface: HTMLElement;
  config: ToolboxPreviewConfig;
  source: 'pointer' | 'keyboard';
}

interface ToolboxPreviewOptions {
  translate: (key: string, params?: Record<string, string | number>) => string;
}

/**
 * The card's own DOM, shared with the playground gallery.
 */
export const createPreviewCard = (): { card: HTMLElement; paper: HTMLElement; caption: HTMLElement } => {
  const card = document.createElement('div');
  const paper = document.createElement('div');
  const caption = document.createElement('div');

  card.setAttribute('data-blok-preview-card', '');
  paper.setAttribute('data-blok-preview-paper', '');
  caption.setAttribute('data-blok-preview-caption', '');
  card.append(paper, caption);

  return { card, paper, caption };
};

/**
 * Notion-style card beside the toolbox: a small drawing of the hovered block
 * and a one-line caption. Purely visual — hidden from assistive tech and inert.
 */
export class ToolboxPreview {
  private root: HTMLElement | null = null;
  private paper: HTMLElement | null = null;
  private caption: HTMLElement | null = null;
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private warmUntil = 0;
  private visible = false;
  private current: ToolboxPreviewShowParams | null = null;

  constructor(private readonly options: ToolboxPreviewOptions) {}

  public show(params: ToolboxPreviewShowParams): void {
    this.cancelOpen();

    if (this.visible || params.source === 'keyboard' || Date.now() < this.warmUntil) {
      this.open(params);

      return;
    }

    this.openTimer = setTimeout(() => {
      this.openTimer = null;
      this.open(params);
    }, PREVIEW_OPEN_DELAY);
  }

  public hide(): void {
    this.cancelOpen();

    if (!this.visible || this.root === null) {
      return;
    }

    this.visible = false;
    this.current = null;
    this.warmUntil = Date.now() + WARM_WINDOW;
    this.root.hidden = true;
    this.root.removeAttribute('data-state');
    removeFromTopLayer(this.root);
    document.removeEventListener('scroll', this.onScroll, { capture: true });
  }

  public destroy(): void {
    this.hide();
    this.root?.remove();
    this.root = null;
    this.paper = null;
    this.caption = null;
  }

  private open(params: ToolboxPreviewShowParams): void {
    const { root, paper, caption } = this.ensureRoot();
    const drawing = params.config.render();

    paper.replaceChildren(drawing);
    caption.textContent = this.describe(params.config);

    const direction = syncPortalDirection(root, { source: params.surface }) ?? 'ltr';
    const left = this.resolveLeft(params.surface.getBoundingClientRect(), direction);

    if (left === null) {
      this.hide();

      return;
    }

    root.style.left = `${left}px`;

    const wasVisible = this.visible;

    root.hidden = false;

    if (!wasVisible) {
      // Promote after the menu so the card stacks above it in the top layer.
      promoteToTopLayer(root);
      document.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
    }

    this.current = params;
    root.style.top = this.resolveTop(root, params.item);
    root.setAttribute('data-state', 'open');
    root.setAttribute('data-blok-preview-side', left < params.surface.getBoundingClientRect().left ? 'left' : 'right');
    this.visible = true;
  }

  private resolveTop(root: HTMLElement, item: HTMLElement): string {
    const maxTop = window.innerHeight - VIEWPORT_MARGIN - root.getBoundingClientRect().height;

    return `${Math.max(VIEWPORT_MARGIN, Math.min(item.getBoundingClientRect().top, maxTop))}px`;
  }

  /**
   * Beside the menu on its inline-end side (left in RTL), flipping when that side has no room.
   */
  private resolveLeft(surface: DOMRect, direction: 'ltr' | 'rtl'): number | null {
    const right = surface.right + GAP;
    const left = surface.left - GAP - PREVIEW_CARD_WIDTH;
    const fitsRight = right + PREVIEW_CARD_WIDTH <= window.innerWidth - VIEWPORT_MARGIN;
    const fitsLeft = left >= VIEWPORT_MARGIN;
    const [preferred, fitsPreferred, alternate, fitsAlternate] = direction === 'rtl'
      ? [left, fitsLeft, right, fitsRight]
      : [right, fitsRight, left, fitsLeft];

    if (fitsPreferred) {
      return preferred;
    }

    return fitsAlternate ? alternate : null;
  }

  private describe(config: ToolboxPreviewConfig): string {
    if (config.descriptionKey !== undefined) {
      return this.options.translate(config.descriptionKey, config.descriptionParams);
    }

    return config.description ?? '';
  }

  private ensureRoot(): { root: HTMLElement; paper: HTMLElement; caption: HTMLElement } {
    if (this.root !== null && this.paper !== null && this.caption !== null) {
      return { root: this.root, paper: this.paper, caption: this.caption };
    }

    const root = document.createElement('div');
    const { card, paper, caption } = createPreviewCard();

    // Body-mounted: the scope attribute carries utilities, preflight and theme tokens.
    root.setAttribute('data-blok-interface', 'block-preview');
    root.setAttribute('data-blok-testid', 'toolbox-preview');
    root.setAttribute('aria-hidden', 'true');
    root.inert = true;
    root.style.pointerEvents = 'none';
    root.hidden = true;
    root.appendChild(card);
    document.body.appendChild(root);

    this.root = root;
    this.paper = paper;
    this.caption = caption;

    return { root, paper, caption };
  }

  private cancelOpen(): void {
    if (this.openTimer !== null) {
      clearTimeout(this.openTimer);
      this.openTimer = null;
    }
  }

  private onScroll = (event: Event): void => {
    // Arrow keys scroll the menu's own list to reveal the focused row: follow the row.
    if (this.current !== null && this.root !== null && event.target instanceof Node && this.current.surface.contains(event.target)) {
      this.root.style.top = this.resolveTop(this.root, this.current.item);

      return;
    }

    this.hide();
  };
}
