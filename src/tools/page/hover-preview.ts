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

/** One line of the page's opening content. */
export interface PagePreviewLine {
  text: string;
  heading: boolean;
}

/** Notion draws about this many lines before the fade (measured: three 27px rows in 76px). */
const MAX_LINES = 6;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Markup to text through an inert template: nothing loads and no handler runs. */
const toText = (html: string): string => {
  const template = document.createElement('template');

  template.innerHTML = html;

  return (template.content.textContent ?? '').replace(/\s+/g, ' ').trim();
};

/**
 * The page's opening blocks as plain lines: any block with a `text` field,
 * a heading for a numeric `level`, a marker for a list `style`. Blocks
 * without text (images, dividers) are skipped.
 */
const textOf = (block: unknown): { text: string; data: Record<string, unknown> | null } => {
  const data = isRecord(block) && isRecord(block.data) ? block.data : null;

  return { data, text: data !== null && typeof data.text === 'string' ? toText(data.text) : '' };
};

const listMarker = (data: Record<string, unknown> | null, position: number): string => {
  switch (data?.style) {
    case 'ordered':
      return `${position}. `;
    case 'checklist':
      return data.checked === true ? '☑ ' : '☐ ';
    case 'unordered':
      return '• ';
    default:
      return '';
  }
};

export const previewLines = (blocks: unknown): PagePreviewLine[] => {
  if (!Array.isArray(blocks)) {
    return [];
  }

  const read = blocks.map(textOf);
  // An ordered item's number counts the ordered items right before it.
  const positions = read.reduce<number[]>((acc, { data }, index) => [
    ...acc,
    data?.style === 'ordered' ? (acc[index - 1] ?? 0) + 1 : 0,
  ], []);

  return read
    .map(({ data, text }, index) => ({ data, text, marker: listMarker(data, positions[index]) }))
    .filter(({ text }) => text !== '')
    .slice(0, MAX_LINES)
    .map(({ data, text, marker }) => ({
      text: marker + text,
      heading: marker === '' && typeof data?.level === 'number',
    }));
};

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

  /** The page's opening content, asked for when a hover starts. */
  private body: Promise<PagePreviewLine[]> | null = null;

  /**
   * `content` returns null when the page has nothing to preview. `loadBody`
   * returns the page's opening lines, or null when the host gives none.
   */
  constructor(
    private readonly content: () => PageHoverContent | null,
    private readonly loadBody: () => Promise<PagePreviewLine[]> | null = () => null
  ) {}

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
    // Asked now, so the lines are there when the card appears.
    this.body = this.loadBody()?.catch((): PagePreviewLine[] => []) ?? null;
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
    void this.body?.then((lines) => {
      if (this.link === link && lines.length > 0) {
        card.append(this.buildBody(lines));
      }
    });
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

  /** Small lines clipped under a fade, like Notion's shrunken page. */
  private buildBody(lines: PagePreviewLine[]): HTMLElement {
    const body = document.createElement('div');

    body.className = 'relative w-full mt-2 max-h-[76px] overflow-hidden';
    body.setAttribute(DATA_ATTR.testid, 'page-hover-preview-content');
    body.setAttribute('aria-hidden', 'true');
    body.append(...lines.map((line) => {
      const row = document.createElement('div');

      row.className = line.heading
        ? 'truncate px-1 py-1.5 text-[10px] leading-[14px] font-semibold'
        : 'truncate px-1 py-1.5 text-[8px] leading-[12px]';
      row.setAttribute(DATA_ATTR.testid, 'page-hover-preview-line');
      if (line.heading) {
        row.setAttribute('data-blok-preview-heading', 'true');
      }
      row.textContent = line.text;

      return row;
    }));

    const fade = document.createElement('div');

    fade.className = 'pointer-events-none absolute inset-x-0 bottom-0 h-11 bg-linear-to-b from-transparent to-popover-bg';
    body.append(fade);

    return body;
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
