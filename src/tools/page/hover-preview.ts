import { DATA_ATTR } from '../../components/constants/data-attributes';
import { IconPage } from '../../components/icons';
import { createPositionTracker, positionFixedAnchored, type PositionTracker } from '../../components/utils/popover/anchored-position';
import { syncPortalDirection } from '../../components/utils/portal-direction';
import { safeImageSrc } from '../../components/utils/sanitize-url';
import { promoteToTopLayer, removeFromTopLayer } from '../../components/utils/top-layer';
import { twJoin } from '../../components/utils/tw';
import type { PageIcon } from './types';

/** Notion shows its page preview about 400ms into a hover (measured). */
const SHOW_DELAY = 400;

/** Time for the pointer to cross the gap from the link onto the card. */
const HIDE_GRACE = 250;

/** Notion's page preview card width (measured). */
const CARD_WIDTH = 260;

export interface PageHoverContent {
  icon?: PageIcon;
  title: string;
  /** Titles above the page, top first. */
  path: string[];
}

/** The icon's content: an emoji, a safe image, or the page glyph. */
export const pageIconNode = (icon: PageIcon | undefined): Node => {
  if (icon?.type === 'emoji') {
    return document.createTextNode(icon.value);
  }

  const src = icon?.type === 'image' ? safeImageSrc(icon.url) : null;

  if (src !== null) {
    const img = document.createElement('img');

    img.src = src;
    img.alt = '';

    return img;
  }

  const glyph = document.createElement('template');

  // A trusted constant from the icon module, not user input.
  glyph.innerHTML = IconPage;

  return glyph.content;
};

const CARD_CLASSES = twJoin(
  'fixed z-overlay top-0 left-0 flex flex-col items-start',
  // The link hover card's surface: this card takes its place on a page link.
  'bg-popover-bg rounded-(--blok-radius-surface) text-text-primary',
  'shadow-[0_1px_2px_rgba(13,20,33,0.04),0_8px_22px_-8px_rgba(13,20,33,0.12)]',
  'mobile:hidden'
);

const ICON_CLASSES = twJoin(
  'flex items-center justify-start mb-2 h-7 text-[26px] leading-none text-gray-text',
  '[&_svg]:size-6 [&_img]:size-7 [&_img]:object-cover [&_img]:rounded-(--blok-radius-control-sm)'
);

/**
 * The page block's hover card: icon, path and title, like Notion's page
 * preview. One per page block, built on first show.
 */
export class PageHoverPreview {
  private card: HTMLElement | null = null;
  private link: HTMLElement | null = null;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private tracker: PositionTracker | null = null;

  /** `content` returns null when the page has nothing to preview. */
  constructor(private readonly content: () => PageHoverContent | null) {}

  public attach(link: HTMLElement): void {
    link.addEventListener('mouseenter', () => this.queueShow(link));
    link.addEventListener('mouseleave', () => this.queueHide());
    // Pressing the link opens or selects the page: the preview is in the way.
    link.addEventListener('mousedown', () => this.hide());
  }

  public hide(): void {
    this.clearTimers();
    this.tracker?.detach();
    this.tracker = null;
    this.link = null;
    if (this.card !== null) {
      removeFromTopLayer(this.card);
      this.card.remove();
    }
  }

  private queueShow(link: HTMLElement): void {
    this.clearTimers();
    if (this.link === link && this.card?.isConnected === true) {
      return;
    }
    this.showTimer = setTimeout(() => {
      this.showTimer = null;
      this.show(link);
    }, SHOW_DELAY);
  }

  private queueHide(): void {
    if (this.showTimer !== null) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }
    if (this.hideTimer !== null) {
      return;
    }
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      this.hide();
    }, HIDE_GRACE);
  }

  private clearTimers(): void {
    if (this.showTimer !== null) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  private show(link: HTMLElement): void {
    const content = this.content();

    if (content === null || !link.isConnected) {
      return;
    }

    const card = this.card ?? this.build();

    this.card = card;
    this.link = link;
    this.fill(card, content);
    if (!card.isConnected) {
      document.body.appendChild(card);
    }
    syncPortalDirection(card, { source: link });
    promoteToTopLayer(card);

    const place = (): void => {
      if (link.isConnected) {
        positionFixedAnchored(card, link, { side: 'bottom', align: 'start', offset: 4 });
      }
    };

    place();
    this.tracker?.detach();
    this.tracker = createPositionTracker(card, place);
    this.tracker.attach();
  }

  private build(): HTMLElement {
    const card = document.createElement('div');

    card.className = CARD_CLASSES;
    card.setAttribute(DATA_ATTR.testid, 'page-hover-preview');
    card.setAttribute('role', 'tooltip');
    // Blok's utilities and tokens apply only inside an interface root.
    card.setAttribute(DATA_ATTR.interface, 'page-hover-preview');
    // Inline: the top-layer reset zeroes padding, border and width set by classes.
    card.style.boxSizing = 'border-box';
    card.style.width = `${CARD_WIDTH}px`;
    card.style.border = 'var(--blok-border-width-hairline) solid var(--blok-popover-border, rgba(13, 20, 33, 0.12))';
    card.style.padding = '16px';
    card.addEventListener('mouseenter', () => this.clearTimers());
    card.addEventListener('mouseleave', () => this.queueHide());

    return card;
  }

  private fill(card: HTMLElement, content: PageHoverContent): void {
    const icon = document.createElement('span');

    icon.className = ICON_CLASSES;
    icon.setAttribute(DATA_ATTR.testid, 'page-hover-preview-icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.replaceChildren(pageIconNode(content.icon));

    const parts: HTMLElement[] = [icon];

    if (content.path.length > 0) {
      const path = document.createElement('div');

      path.className = 'w-full truncate text-xs leading-[18px] text-text-secondary';
      path.setAttribute(DATA_ATTR.testid, 'page-hover-preview-path');
      path.textContent = content.path.join(' / ');
      parts.push(path);
    }

    const title = document.createElement('div');

    title.className = 'w-full truncate text-[13px] leading-[18px] font-semibold';
    title.setAttribute(DATA_ATTR.testid, 'page-hover-preview-title');
    title.textContent = content.title;
    parts.push(title);

    card.replaceChildren(...parts);
  }
}
