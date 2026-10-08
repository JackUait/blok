import { describeTableOfContents } from '../../shared/tool-descriptions/table-of-contents';
import { tableOfContentsSanitize } from '../../shared/tool-descriptions/sanitize/blocks';
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
import { applyBlockColor, buildBlockColorTunes, type BlockColorData } from '../../components/shared/block-color';
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

/** The raw block id: `link.hash` is percent-encoded. */
const TARGET = 'data-blok-toc-target';

const targetOf = (link: Element): string => link.getAttribute(TARGET) ?? '';

/**
 * Table of contents block — Notion's outline of the page's headings.
 *
 * The list is derived, never saved: it is read from the editor's DOM whenever a
 * block changes, so renames, moves and deletions show up at once. Each entry is
 * a real `#<block id>` link, so copying or opening it in a new tab still works.
 */
export class TableOfContentsTool implements BlockTool {
  public static describe = describeTableOfContents;

  private readonly api: API;
  private readonly block: BlockAPI | undefined;
  private readonly isProbe: boolean;
  private data: BlockColorData;
  private root: HTMLElement | null = null;
  private list: HTMLOListElement | null = null;
  private empty: HTMLElement | null = null;
  private outline = '';
  private started = false;
  private frame: number | null = null;
  private viewportFrame: number | null = null;
  private activeId: string | null = null;
  /** Each entry's heading holder, looked up once per outline instead of on every scroll. */
  private targets: Array<{ link: HTMLAnchorElement; holder: Element | null }> = [];

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
    return tableOfContentsSanitize();
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
    const empty = document.createElement('p');

    root.setAttribute(DATA_ATTR.tool, 'table_of_contents');
    root.setAttribute(DATA_ATTR.mutationFree, 'true');
    root.setAttribute(DATA_ATTR.linkOwner, '');
    root.setAttribute(DATA_ATTR.keyboardOwner, '');
    root.setAttribute('aria-label', this.api.i18n.t('toolNames.tableOfContents'));
    root.setAttribute('data-blok-toc', '');

    list.setAttribute('data-blok-toc-list', '');
    // `list-style: none` drops list semantics in WebKit.
    list.setAttribute('role', 'list');
    empty.setAttribute('data-blok-toc-empty', '');
    empty.textContent = this.api.i18n.t('tools.tableOfContents.empty');

    root.append(list, empty);
    root.addEventListener('click', this.onClick);
    root.addEventListener('keydown', this.onKeydown);
    root.addEventListener('animationend', this.onAnimationEnd);

    this.root = root;
    this.list = list;
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
    document.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
    window.addEventListener('resize', this.onResize, { passive: true });
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
    document.removeEventListener('scroll', this.onScroll, { capture: true });
    window.removeEventListener('resize', this.onResize);
    [this.frame, this.viewportFrame].forEach((frame) => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    });
    this.frame = null;
    this.viewportFrame = null;
  }

  /** Enter on the selected block (block navigation) moves focus into the outline. */
  public onNavigationEnter(): boolean {
    const links = this.targets.map((target) => target.link);
    const link = links.find((candidate) => candidate.hasAttribute('aria-current')) ?? links[0];

    if (link === undefined) {
      return false;
    }
    link.focus();

    return true;
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

  /** Scrolls inside a popover or a code block cannot move the page's headings. */
  private readonly onScroll = (event: Event): void => {
    const redactor = this.redactor;

    if (event.target instanceof Element && redactor !== null && !event.target.contains(redactor)) {
      return;
    }
    this.scheduleViewport();
  };

  private readonly onResize = (): void => {
    this.scheduleViewport();
  };

  private scheduleViewport(): void {
    if (this.viewportFrame !== null) {
      return;
    }
    this.viewportFrame = window.requestAnimationFrame(() => {
      this.viewportFrame = null;
      this.markActive();
    });
  }

  private readonly onAnimationEnd = (event: AnimationEvent): void => {
    const row = event.target instanceof Element ? event.target.closest('li') : null;

    row?.removeAttribute('data-revealing');
    row?.removeAttribute('data-entering');
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
    // Holders are replaced when a block is re-rendered, so look them up again on every change.
    this.targets = Array.from(this.list.querySelectorAll<HTMLAnchorElement>('a'), (link) => ({
      link,
      holder: redactor.querySelector(`[${DATA_ATTR.id}="${CSS.escape(targetOf(link))}"]`),
    }));
    this.markActive();
  }

  private renderEntries(headings: TocHeading[], first: boolean): void {
    if (this.list === null) {
      return;
    }

    const known = new Set(this.targets.map((target) => targetOf(target.link)));
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
      link.href = `#${encodeURIComponent(heading.id)}`;
      link.setAttribute(TARGET, heading.id);
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
    this.root.toggleAttribute('data-filled', this.data.backgroundColor !== undefined);
  }

  private showEmpty(isEmpty: boolean): void {
    this.empty?.toggleAttribute('hidden', !isEmpty);
    this.list?.toggleAttribute('hidden', isEmpty);
    this.root?.toggleAttribute('data-empty', isEmpty);
  }

  /** The section being read: the last heading above a line a quarter of the way down the viewport. */
  private markActive(): void {
    const line = window.innerHeight * READING_LINE;
    const links = this.targets.map((target) => target.link);
    const passed = this.targets.filter(({ holder }) => holder !== null && holder.getBoundingClientRect().top <= line);
    const active = passed.length > 0 ? passed[passed.length - 1].link : null;
    const activeId = active === null ? null : targetOf(active);

    if (activeId === this.activeId) {
      return;
    }
    this.activeId = activeId;
    links.forEach((link) => {
      if (link === active) {
        link.setAttribute('aria-current', 'location');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  }

  private readonly onClick = (event: MouseEvent): void => {
    const link = event.target instanceof Element ? event.target.closest('a') : null;

    if (link === null || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    // A selected heading would be deleted by the next Backspace once focus leaves the outline.
    this.api.blocks.scrollToBlock?.(targetOf(link), { select: false });
    // WebKit does not focus a clicked link; keep the arrow keys working from here.
    link.focus({ preventScroll: true });
  };

  private readonly onKeydown = (event: KeyboardEvent): void => {
    const links = this.targets.map((target) => target.link);
    const index = links.findIndex((link) => link === document.activeElement);

    if (index === -1) {
      return;
    }

    const moves: Partial<Record<string, number>> = {
      ArrowDown: Math.min(links.length - 1, index + 1),
      ArrowUp: Math.max(0, index - 1),
      Home: 0,
      End: links.length - 1,
    };
    const target = moves[event.key];

    if (target === undefined) {
      return;
    }
    event.preventDefault();
    links[target].focus();
  };
}
