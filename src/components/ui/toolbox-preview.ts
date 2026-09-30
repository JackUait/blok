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

    const left = this.resolveLeft(params.surface.getBoundingClientRect());

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

    const height = root.getBoundingClientRect().height;
    const maxTop = window.innerHeight - VIEWPORT_MARGIN - height;

    root.style.top = `${Math.max(VIEWPORT_MARGIN, Math.min(params.item.getBoundingClientRect().top, maxTop))}px`;
    root.setAttribute('data-state', 'open');
    root.setAttribute('data-blok-preview-side', left < params.surface.getBoundingClientRect().left ? 'left' : 'right');
    this.visible = true;
  }

  private resolveLeft(surface: DOMRect): number | null {
    const right = surface.right + GAP;

    if (right + PREVIEW_CARD_WIDTH <= window.innerWidth - VIEWPORT_MARGIN) {
      return right;
    }

    const left = surface.left - GAP - PREVIEW_CARD_WIDTH;

    return left >= VIEWPORT_MARGIN ? left : null;
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

  private onScroll = (): void => {
    this.hide();
  };
}
