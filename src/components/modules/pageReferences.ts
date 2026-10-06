import type { PageConfig, PageIcon, PageInfo } from '../../tools/page/types';
import { pageIconNode } from '../../tools/page/icon-node';
import { PAGE_REFERENCE_ATTR } from '../../shared/page-reference';
import {
  PAGE_REFERENCE_ARROW_CLASSES,
  PAGE_REFERENCE_CLASSES,
  PAGE_REFERENCE_ICON_CLASSES,
  PAGE_REFERENCE_INK_CLASSES,
  PAGE_REFERENCE_MUTED_CLASSES,
  PAGE_REFERENCE_TITLE_CLASSES,
} from '../../shared/tool-classes/page';
import { PAGE_REFERENCE_ARROW_HOVER_CLASSES, PAGE_REFERENCE_HOVER_CLASSES } from '../../tools/page/constants';
import { IconArrowDiagonal } from '../icons';
import { Module } from '../__module';
import { DATA_ATTR } from '../constants/data-attributes';
import { safeHref } from '../utils/sanitize-url';

const ICON_TESTID = 'page-reference-icon';
const TITLE_TESTID = 'page-reference-title';
const EMOJI_ATTR = 'data-blok-emoji';

/** Which icon an anchor shows, so a repaint rebuilds it only on change. */
const iconKeys = new WeakMap<HTMLElement, string>();

const iconKey = (icon: PageIcon | undefined): string => {
  if (icon === undefined) {
    return 'page';
  }

  return icon.type === 'emoji' ? `emoji:${icon.value}` : `image:${icon.url}`;
};

/**
 * The icon constants are indented markup. Their blank text nodes would join the
 * reference's text, which caret offsets and find read.
 */
const dropBlankText = (root: HTMLElement): void => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Node[] = [];

  while (walker.nextNode() !== null) {
    texts.push(walker.currentNode);
  }
  texts.filter((node) => node.textContent?.trim() === '').forEach((node) => node.parentNode?.removeChild(node));
};

const buildArrow = (): HTMLElement => {
  const arrow = document.createElement('span');

  arrow.className = [...PAGE_REFERENCE_ARROW_CLASSES, PAGE_REFERENCE_ARROW_HOVER_CLASSES].join(' ');
  arrow.setAttribute(DATA_ATTR.testid, 'page-reference-arrow');
  // A trusted constant from the icon module, not user input.
  arrow.innerHTML = IconArrowDiagonal;

  return arrow;
};

const paintIcon = (slot: HTMLElement, icon: PageIcon | undefined): void => {
  const key = iconKey(icon);

  if (iconKeys.get(slot) === key) {
    return;
  }
  iconKeys.set(slot, key);

  if (icon?.type === 'emoji') {
    slot.setAttribute(EMOJI_ATTR, icon.value);
    slot.replaceChildren(buildArrow());
    dropBlankText(slot);

    return;
  }

  slot.removeAttribute(EMOJI_ATTR);
  slot.replaceChildren(pageIconNode(icon), buildArrow());
  dropBlankText(slot);
};

interface PageEntry {
  anchors: Set<HTMLAnchorElement>;
  info: PageInfo | null | undefined;
  request: number;
  unsubscribe?: () => void;
}

/** Derived labels and links for inline page references in one editor. */
export class PageReferences extends Module {
  private readonly entries = new Map<string, PageEntry>();
  private observer: MutationObserver | null = null;
  private page: PageConfig | null = null;

  public prepare(): void {
    const wrapper = this.Blok.UI.nodes.wrapper;

    this.page = this.Blok.Tools.blockTools.get('page')?.settings as PageConfig | undefined ?? null;
    this.observer = new MutationObserver(() => this.sync());
    this.observer.observe(wrapper, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [PAGE_REFERENCE_ATTR],
    });
    this.listeners.on(wrapper, 'click', this.onClick, true);
    this.listeners.on(wrapper, 'keydown', this.onKeydown, true);
    this.sync();
  }

  public ownsTarget(target: EventTarget | null): boolean {
    const anchor = this.anchorOf(target);

    if (anchor === null) {
      return false;
    }

    const pageId = anchor.getAttribute(PAGE_REFERENCE_ATTR);

    return pageId !== null && this.entries.get(pageId)?.anchors.has(anchor) === true;
  }

  public destroy(): void {
    this.observer?.disconnect();
    this.observer = null;
    for (const entry of this.entries.values()) {
      ++entry.request;
      entry.unsubscribe?.();
    }
    this.entries.clear();
  }

  private sync(): void {
    if (this.isDestroyed) {
      return;
    }

    const grouped = new Map<string, Set<HTMLAnchorElement>>();
    const wrapper = this.Blok.UI.nodes.wrapper;

    for (const anchor of wrapper.querySelectorAll<HTMLAnchorElement>(`a[${PAGE_REFERENCE_ATTR}]`)) {
      if (anchor.closest(`[${DATA_ATTR.editor}]`) !== wrapper) {
        continue;
      }
      const pageId = anchor.getAttribute(PAGE_REFERENCE_ATTR);

      if (pageId === null || pageId === '') {
        continue;
      }

      const group = grouped.get(pageId) ?? new Set<HTMLAnchorElement>();

      group.add(anchor);
      grouped.set(pageId, group);
    }

    for (const [pageId, entry] of this.entries) {
      if (grouped.has(pageId)) {
        continue;
      }

      ++entry.request;
      entry.unsubscribe?.();
      this.entries.delete(pageId);
    }

    for (const [pageId, group] of grouped) {
      this.syncEntry(pageId, group);
    }
  }

  private syncEntry(pageId: string, group: Set<HTMLAnchorElement>): void {
    const existingEntry = this.entries.get(pageId);
    const entry: PageEntry = existingEntry ?? { anchors: new Set<HTMLAnchorElement>(), info: undefined, request: 0 };

    if (existingEntry === undefined) {
      this.entries.set(pageId, entry);
    }

    for (const anchor of group) {
      if (!entry.anchors.has(anchor)) {
        this.paint(entry, anchor, pageId);
      }
    }
    entry.anchors = group;

    if (existingEntry === undefined) {
      const stop = this.page?.subscribe?.(pageId, () => {
        if (this.entries.get(pageId) === entry) {
          void this.refresh(pageId, entry);
        }
      });

      entry.unsubscribe = typeof stop === 'function' ? stop : undefined;
      void this.refresh(pageId, entry);
    }
  }

  private async refresh(pageId: string, pageEntry: PageEntry): Promise<PageInfo | null | undefined> {
    const entry = pageEntry;
    const request = ++entry.request;

    entry.info = undefined;
    for (const anchor of entry.anchors) {
      this.paint(entry, anchor, pageId);
    }

    const page = this.page;

    if (page?.resolve === undefined) {
      return undefined;
    }

    const info = await Promise.resolve()
      .then(() => page.resolve?.(pageId))
      .catch((): undefined => undefined);

    if (this.isDestroyed || this.entries.get(pageId) !== entry || request !== entry.request) {
      return undefined;
    }

    entry.info = info;
    for (const anchor of entry.anchors) {
      this.paint(entry, anchor, pageId);
    }

    return info;
  }

  private paint(entry: PageEntry, pageAnchor: HTMLAnchorElement, pageId: string): void {
    const anchor = pageAnchor;

    anchor.setAttribute(DATA_ATTR.mutationFree, 'true');
    anchor.setAttribute('contenteditable', 'false');
    anchor.setAttribute(DATA_ATTR.linkOwner, '');
    anchor.tabIndex = 0;
    anchor.draggable = false;

    const info = entry.info;
    const allowed = info !== null && info !== undefined && info.access !== 'none';
    const visibleTitle = allowed && typeof info.title === 'string' && info.title.trim() !== ''
      ? info.title
      : this.Blok.I18n.t('tools.page.unresolved');
    const title = info?.access === 'none'
      ? this.Blok.I18n.t('tools.page.noAccess')
      : visibleTitle;

    const { icon, label } = this.parts(anchor);

    paintIcon(icon, allowed && info.icon !== undefined ? info.icon : undefined);
    if (label.textContent !== title) {
      label.textContent = title;
    }
    anchor.className = [
      ...PAGE_REFERENCE_CLASSES,
      ...(allowed ? PAGE_REFERENCE_INK_CLASSES : PAGE_REFERENCE_MUTED_CLASSES),
      PAGE_REFERENCE_HOVER_CLASSES,
    ].join(' ');

    anchor.removeAttribute('href');
    anchor.removeAttribute('role');
    anchor.removeAttribute('aria-disabled');

    if (!allowed) {
      anchor.setAttribute('aria-disabled', 'true');
      return;
    }

    const href = this.href(pageId);

    if (href !== null) {
      anchor.setAttribute('href', href);
    } else {
      anchor.setAttribute('role', 'link');
    }
  }

  /** The icon and title slots, built on first paint over the saved fallback text. */
  private parts(anchor: HTMLAnchorElement): { icon: HTMLElement; label: HTMLElement } {
    const icon = anchor.querySelector<HTMLElement>(`:scope > [${DATA_ATTR.testid}="${ICON_TESTID}"]`);
    const label = anchor.querySelector<HTMLElement>(`:scope > [${DATA_ATTR.testid}="${TITLE_TESTID}"]`);

    if (icon !== null && label !== null) {
      return { icon, label };
    }

    const newIcon = document.createElement('span');
    const newLabel = document.createElement('span');

    newIcon.className = PAGE_REFERENCE_ICON_CLASSES.join(' ');
    newIcon.setAttribute(DATA_ATTR.testid, ICON_TESTID);
    newIcon.setAttribute('aria-hidden', 'true');
    newLabel.className = PAGE_REFERENCE_TITLE_CLASSES.join(' ');
    newLabel.setAttribute(DATA_ATTR.testid, TITLE_TESTID);
    anchor.replaceChildren(newIcon, newLabel);

    return { icon: newIcon, label: newLabel };
  }

  private href(pageId: string): string | null {
    try {
      const url = this.page?.href?.(pageId);

      return typeof url === 'string' && url !== '' ? safeHref(url) : null;
    } catch {
      return null;
    }
  }

  private anchorOf(target: EventTarget | null): HTMLAnchorElement | null {
    const anchor = target instanceof Element ? target.closest(`a[${PAGE_REFERENCE_ATTR}]`) : null;

    return anchor instanceof HTMLAnchorElement && anchor.closest(`[${DATA_ATTR.editor}]`) === this.Blok.UI.nodes.wrapper
      ? anchor
      : null;
  }

  private readonly onClick = (event: Event): void => {
    if (!(event instanceof MouseEvent) || !this.ownsTarget(event.target)) {
      return;
    }

    const modified = event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

    if (modified && this.anchorOf(event.target)?.hasAttribute('href')) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    if (!modified) {
      void this.activate(event);
    }
  };

  private readonly onKeydown = (event: Event): void => {
    if (!(event instanceof KeyboardEvent) || event.key !== 'Enter' || !this.ownsTarget(event.target)) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    void this.activate(event);
  };

  private async activate(event: MouseEvent | KeyboardEvent): Promise<void> {
    const anchor = this.anchorOf(event.target);

    if (anchor === null) {
      return;
    }

    const pageId = anchor.getAttribute(PAGE_REFERENCE_ATTR);

    if (pageId === null) {
      return;
    }

    const entry = this.entries.get(pageId);

    if (entry === undefined || !entry.anchors.has(anchor)) {
      return;
    }

    const info = await this.refresh(pageId, entry);

    if (info === null || info === undefined || info.access === 'none' ||
      this.isDestroyed || !entry.anchors.has(anchor)) {
      return;
    }

    if (this.page?.open !== undefined) {
      this.page.open(pageId, { event });
      return;
    }

    const href = this.href(pageId);

    if (href !== null) {
      if (event.metaKey || event.ctrlKey || event.shiftKey) {
        window.open(href, '_blank', 'noopener');
      } else {
        window.location.assign(href);
      }
    }
  }
}
