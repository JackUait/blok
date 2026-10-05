import type {
  API,
  BlockAPI,
  BlockTool,
  BlockToolConstructorOptions,
  MenuConfig,
  SanitizerConfig,
  ToolboxConfig,
} from '../../../types';
import type { TableOfContentsData } from './types';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import { IconTableOfContents } from '../../components/icons';
import { applyBlockColor, buildBlockColorTunes, BLOCK_COLOR_SANITIZE, type BlockColorData } from '../../components/shared/block-color';
import { COLOR_PRESETS } from '../../components/shared/color-presets';
import { outlineDepths } from '../../shared/outline-depths';
import { collectHeadings, type TocHeading } from './headings';
import { renderTableOfContentsPreview } from './preview';

const COLOR_NAMES = new Set(COLOR_PRESETS.map((preset) => preset.name));

/** How far down the viewport a heading must scroll before its section counts as the one being read. */
const READING_LINE = 0.25;

/** Only a preset name reaches a style: a raw value could carry CSS. */
const readColors = (data: Partial<TableOfContentsData> | undefined): BlockColorData => {
  const colors: BlockColorData = {};

  if (typeof data?.textColor === 'string' && COLOR_NAMES.has(data.textColor)) {
    colors.textColor = data.textColor;
  }
  if (typeof data?.backgroundColor === 'string' && COLOR_NAMES.has(data.backgroundColor)) {
    colors.backgroundColor = data.backgroundColor;
  }

  return colors;
};

const signature = (headings: TocHeading[]): string => JSON.stringify(headings);

/**
 * Table of contents block — Notion's outline of the page's headings.
 *
 * The list is derived, never saved: it is read from the editor's DOM whenever a
 * block changes, so renames, moves and deletions show up at once. Each entry is
 * a real `#<block id>` link, so copying or opening it in a new tab still works.
 */
export class TableOfContentsTool implements BlockTool {
  private readonly api: API;
  private readonly block: BlockAPI | undefined;
  private readonly isProbe: boolean;
  private data: BlockColorData;
  private root: HTMLElement | null = null;
  private list: HTMLOListElement | null = null;
  private thumb: HTMLElement | null = null;
  private empty: HTMLElement | null = null;
  private outline = '';
  private started = false;
  private frame: number | null = null;
  private activeId: string | null = null;

  constructor(options: BlockToolConstructorOptions<TableOfContentsData>) {
    this.api = options.api;
    this.block = options.block;
    this.data = readColors(options.data);
    this.isProbe = options.origin === 'probe';
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }

  /** The outline is the page's; a child block here would have nowhere to go. */
  public static get acceptsChildren(): boolean {
    return false;
  }

  public static get sanitize(): SanitizerConfig {
    return { ...BLOCK_COLOR_SANITIZE };
  }

  public static get toolbox(): ToolboxConfig {
    return {
      icon: IconTableOfContents,
      titleKey: 'tableOfContents',
      searchTerms: ['toc', 'table of contents', 'contents', 'outline', 'headings', 'navigation'],
      section: 'advanced',
      preview: { render: renderTableOfContentsPreview, descriptionKey: 'toolbox.preview.tableOfContents' },
    };
  }

  public render(): HTMLElement {
    const root = document.createElement('nav');
    const list = document.createElement('ol');
    const thumb = document.createElement('span');
    const empty = document.createElement('p');

    root.setAttribute(DATA_ATTR.tool, 'table_of_contents');
    root.setAttribute(DATA_ATTR.mutationFree, 'true');
    root.setAttribute(DATA_ATTR.linkOwner, '');
    root.setAttribute(DATA_ATTR.keyboardOwner, '');
    root.setAttribute('aria-label', this.api.i18n.t('toolNames.tableOfContents'));
    root.setAttribute('data-blok-toc', '');

    list.setAttribute('data-blok-toc-list', '');
    thumb.setAttribute('data-blok-toc-thumb', '');
    thumb.setAttribute('aria-hidden', 'true');
    empty.setAttribute('data-blok-toc-empty', '');
    empty.textContent = this.api.i18n.t('tools.tableOfContents.empty');

    root.append(thumb, list, empty);
    root.addEventListener('click', this.onClick);
    root.addEventListener('keydown', this.onKeydown);

    this.root = root;
    this.list = list;
    this.thumb = thumb;
    this.empty = empty;
    this.paint();
    this.showEmpty(true);

    return root;
  }

  public rendered(): void {
    if (this.started || this.isProbe) {
      return;
    }
    this.started = true;
    this.api.events.on('block changed', this.schedule);
    this.api.events.on('blocks:rendered', this.schedule);
    document.addEventListener('scroll', this.onViewportChange, { capture: true, passive: true });
    window.addEventListener('resize', this.onViewportChange, { passive: true });
    this.refresh();
  }

  public save(): TableOfContentsData {
    return { ...this.data };
  }

  public validate(_data: TableOfContentsData): boolean {
    return true;
  }

  public setData(data: TableOfContentsData): boolean {
    this.data = readColors(data);
    this.paint();

    return true;
  }

  public setReadOnly(_state: boolean): void {}

  public renderSettings(): MenuConfig {
    return buildBlockColorTunes({
      data: this.data,
      i18n: this.api.i18n,
      onPick: (field, value): void => {
        const { [field]: _old, ...rest } = this.data;

        this.setData(value === undefined ? rest : { ...rest, [field]: value });
        this.block?.dispatchChange();
      },
    });
  }

  public removed(): void {
    if (!this.started) {
      return;
    }
    this.started = false;
    this.api.events.off('block changed', this.schedule);
    this.api.events.off('blocks:rendered', this.schedule);
    document.removeEventListener('scroll', this.onViewportChange, { capture: true });
    window.removeEventListener('resize', this.onViewportChange);
    if (this.frame !== null) {
      window.cancelAnimationFrame(this.frame);
      this.frame = null;
    }
  }

  public destroy(): void {
    this.removed();
  }

  /** Many blocks change per gesture (a paste, an undo); rebuild once per frame. */
  private readonly schedule = (): void => {
    if (this.frame !== null) {
      return;
    }
    this.frame = window.requestAnimationFrame(() => {
      this.frame = null;
      this.refresh();
    });
  };

  private readonly onViewportChange = (): void => {
    this.markActive();
  };

  private get redactor(): Element | null {
    return this.root?.closest(`[${DATA_ATTR.redactor}]`) ?? null;
  }

  private refresh(): void {
    const redactor = this.redactor;

    if (redactor === null || this.list === null) {
      return;
    }

    const headings = collectHeadings(redactor);
    const next = signature(headings);

    if (next !== this.outline) {
      this.renderEntries(headings, this.outline === '');
      this.outline = next;
    }
    this.markActive();
  }

  private renderEntries(headings: TocHeading[], first: boolean): void {
    if (this.list === null) {
      return;
    }

    const known = new Set(Array.from(this.list.querySelectorAll('a'), (a) => a.hash.slice(1)));
    const depths = outlineDepths(headings.map((heading) => heading.level));

    this.list.replaceChildren(...headings.map((heading, index) => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      const label = document.createElement('span');

      item.setAttribute('data-depth', String(depths[index]));
      item.style.setProperty('--blok-toc-depth', String(depths[index]));
      item.style.setProperty('--blok-toc-index', String(index));
      if (first) {
        item.setAttribute('data-revealing', '');
      } else if (!known.has(heading.id)) {
        item.setAttribute('data-entering', '');
      }

      label.textContent = heading.text;
      link.href = `#${heading.id}`;
      link.setAttribute('data-blok-toc-link', '');
      link.appendChild(label);
      item.appendChild(link);

      return item;
    }));
    this.activeId = null;
    this.showEmpty(headings.length === 0);
  }

  /** A text colour replaces the gray ink, so hover and the current entry stop switching to primary ink. */
  private paint(): void {
    if (this.root === null) {
      return;
    }
    applyBlockColor(this.root, this.data);
    this.root.toggleAttribute('data-tinted', this.data.textColor !== undefined);
  }

  private showEmpty(isEmpty: boolean): void {
    this.empty?.toggleAttribute('hidden', !isEmpty);
    this.list?.toggleAttribute('hidden', isEmpty);
    this.root?.toggleAttribute('data-empty', isEmpty);
  }

  /** The section being read: the last heading above a line a quarter of the way down the viewport. */
  private markActive(): void {
    const redactor = this.redactor;

    if (redactor === null || this.list === null) {
      return;
    }

    const line = window.innerHeight * READING_LINE;
    const links = Array.from(this.list.querySelectorAll<HTMLAnchorElement>('a'));
    const passed = links.filter((link) => {
      const holder = redactor.querySelector(`[${DATA_ATTR.id}="${CSS.escape(link.hash.slice(1))}"]`);

      return holder !== null && holder.getBoundingClientRect().top <= line;
    });
    const active = passed.length > 0 ? passed[passed.length - 1] : null;
    const activeId = active?.hash.slice(1) ?? null;

    if (activeId === this.activeId) {
      return;
    }
    this.activeId = activeId;
    const activeIndex = active === null ? -1 : links.indexOf(active);

    links.forEach((link, index) => {
      if (link === active) {
        link.setAttribute('aria-current', 'location');
      } else {
        link.removeAttribute('aria-current');
      }
      link.parentElement?.toggleAttribute('data-read', index < activeIndex);
    });
    this.moveThumb(active);
  }

  private moveThumb(active: HTMLAnchorElement | null): void {
    if (this.thumb === null) {
      return;
    }
    if (active === null) {
      this.thumb.removeAttribute('data-visible');

      return;
    }
    const row = active.parentElement;

    if (row === null) {
      return;
    }
    // The row is the positioned box, so its offsetTop is relative to the nav.
    this.thumb.style.setProperty('--blok-toc-thumb-y', `${row.offsetTop + row.offsetHeight / 2}px`);
    this.thumb.style.setProperty('--blok-toc-thumb-depth', row.getAttribute('data-depth') ?? '0');
    this.thumb.setAttribute('data-visible', '');
  }

  private readonly onClick = (event: MouseEvent): void => {
    const link = event.target instanceof Element ? event.target.closest('a') : null;

    if (link === null || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    this.api.blocks.scrollToBlock?.(link.hash.slice(1));
    // scrollToBlock selects the heading. WebKit leaves focus on <body> after a link click,
    // where Backspace deletes a selected block; inside this keyboard-owned nav it does nothing.
    link.focus({ preventScroll: true });
  };

  private readonly onKeydown = (event: KeyboardEvent): void => {
    const links = Array.from(this.list?.querySelectorAll<HTMLAnchorElement>('a') ?? []);
    const index = links.findIndex((link) => link === document.activeElement);

    if (index === -1) {
      return;
    }

    const targets: Record<string, number> = {
      ArrowDown: Math.min(links.length - 1, index + 1),
      ArrowUp: Math.max(0, index - 1),
      Home: 0,
      End: links.length - 1,
    };
    const target = targets[event.key];

    if (target === undefined) {
      return;
    }
    event.preventDefault();
    links[target].focus();
  };
}
