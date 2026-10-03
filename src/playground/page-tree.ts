import type { OutputBlockData } from '../../types';
import { IconChevronRight, IconCross, IconPage } from '../components/icons';
import type { PageRecord, RootRecord } from './page-host';
import './page-tree.css';

/**
 * The playground's page sidebar: every page as a tree under the root
 * document, in a drawer on the left that stays closed until asked for.
 */

export interface PageTreeNode {
  /** null = the root document. */
  id: string | null;
  title: string;
  icon?: string;
  children: PageTreeNode[];
}

/** What the tree reads from the page registry. */
export interface PageTreeSource {
  root(): RootRecord;
  get(pageId: string): PageRecord | undefined;
}

const untitled = (title: string): string => (title.trim() === '' ? 'Untitled' : title);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

interface PageLink {
  pageId: string;
  title: string;
  icon?: string;
}

/** The page blocks in `blocks`, with the title and icon each one caches. */
const pageLinks = (blocks: OutputBlockData[]): PageLink[] => blocks.flatMap((block) => {
  const pageId: unknown = block.type === 'page' ? block.data?.pageId : undefined;

  if (typeof pageId !== 'string' || pageId === '') {
    return [];
  }

  const cache: unknown = block.data?.cache;
  const title = isRecord(cache) && typeof cache.title === 'string' ? cache.title : '';
  const icon = isRecord(cache) && isRecord(cache.icon) && typeof cache.icon.value === 'string' ? cache.icon.value : undefined;

  return [{ pageId, title, ...(icon !== undefined && { icon }) }];
});

/** The page whose blocks link to `pageId`, with the link's cached title and icon; null when no page block points at it. */
export const findPageLink = (
  blocksOf: (pageId: string | null) => OutputBlockData[] | undefined,
  pageId: string
): { parentId: string | null; title: string; icon?: string } | null => {
  const seen = new Set<string | null>();

  const search = (parentId: string | null): { parentId: string | null; title: string; icon?: string } | null => {
    // Pages linking each other would search forever.
    if (seen.has(parentId)) {
      return null;
    }
    seen.add(parentId);

    const links = pageLinks(blocksOf(parentId) ?? []);
    const link = links.find((candidate) => candidate.pageId === pageId);

    if (link !== undefined) {
      return { parentId, title: link.title, ...(link.icon !== undefined && { icon: link.icon }) };
    }

    for (const child of links) {
      const found = search(child.pageId);

      if (found !== null) {
        return found;
      }
    }

    return null;
  };

  return search(null);
};

/**
 * The tree follows the page blocks, like Notion's sidebar: a page sits where
 * its block sits, in block order. Page records live in this browser only, so a
 * page made elsewhere (another browser, a peer, before a reset) has none; its
 * block's cache names it then. A record still wins, as the cache can lag a rename.
 */
export const buildPageTree = (
  pages: PageTreeSource,
  blocksOf: (pageId: string | null) => OutputBlockData[] | undefined
): PageTreeNode => {
  const seen = new Set<string>();

  const grow = (parentId: string | null): PageTreeNode[] => pageLinks(blocksOf(parentId) ?? []).flatMap((link) => {
    const record = pages.get(link.pageId);

    // One page linked twice, or pages linking each other, would repeat forever.
    if (seen.has(link.pageId) || record?.trashed === true) {
      return [];
    }
    seen.add(link.pageId);

    const icon = record === undefined ? link.icon : record.icon;

    return [{
      id: link.pageId,
      title: untitled(record?.title ?? link.title),
      ...(icon !== undefined && { icon }),
      children: grow(link.pageId),
    }];
  });

  const root = pages.root();

  return {
    id: null,
    title: untitled(root.title),
    ...(root.icon !== undefined && { icon: root.icon }),
    children: grow(null),
  };
};

/** The pages from the top down to `pageId`, the root document and the page itself left out; null when it is not in the tree. */
const ancestorsIn = (node: PageTreeNode, pageId: string, above: string[] = []): string[] | null => {
  if (node.id === pageId) {
    return above;
  }

  const path = node.id === null ? above : [...above, node.id];

  for (const child of node.children) {
    const found = ancestorsIn(child, pageId, path);

    if (found !== null) {
      return found;
    }
  }

  return null;
};

/* ------------------------------------------------------------------ drawer */

export interface PageTreeOptions {
  pages: PageTreeSource;
  blocksOf: (pageId: string | null) => OutputBlockData[] | undefined;
  currentPageId: () => string | null;
  href: (pageId: string | null) => string;
  /** `link` is the clicked row: the page opens from it. */
  navigate: (pageId: string | null, link: HTMLElement) => void;
}

export interface PageTree {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  /** Redraws from the registry: titles, icons, pages added or trashed, the open page. */
  refresh(): void;
  /** The drawer belongs to the editor page only. */
  setAvailable(available: boolean): void;
  destroy(): void;
}

const EXPANDED_STORAGE_KEY = 'blok-playground-page-tree-expanded';

const readExpanded = (): Set<string> => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(EXPANDED_STORAGE_KEY) ?? '[]');

    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
};

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);

  node.className = className;

  return node;
};

export const mountPageTree = (options: PageTreeOptions): PageTree => {
  const expanded = readExpanded();
  const state: { opened: boolean; available: boolean; lastCurrent?: string | null } = { opened: false, available: true };

  const tab = element('button', 'pg-pages-tab');

  tab.id = 'pg-pages-tab';
  tab.type = 'button';
  tab.title = 'Pages (⌥P / Alt+P)';
  tab.setAttribute('aria-label', 'Open pages panel (Alt + P)');
  tab.setAttribute('aria-controls', 'pg-pages-panel');
  tab.setAttribute('aria-expanded', 'false');

  const tabLabel = element('span', 'pg-pages-tab__label');
  const tabKey = element('span', 'pg-pages-tab__key');

  tabKey.textContent = '⌥P';
  tabLabel.append('Pages', tabKey);
  tab.append(tabLabel);

  const panel = element('aside', 'pg-pages-panel');

  panel.id = 'pg-pages-panel';
  panel.setAttribute('aria-label', 'Pages');

  const head = element('div', 'pg-pages-head');
  const title = element('span', 'pg-pages-title');
  const kbd = element('kbd', 'settings-kbd');
  const close = element('button', 'pg-pages-close');

  title.textContent = 'Pages';
  kbd.textContent = '⌥P';
  close.type = 'button';
  close.title = 'Close (Esc)';
  close.setAttribute('aria-label', 'Close pages panel');
  close.innerHTML = IconCross;
  head.append(title, kbd, close);

  const nav = element('nav', 'pg-pages-nav');
  const list = element('ul', 'pg-tree');

  nav.setAttribute('aria-label', 'Page tree');
  nav.append(list);
  panel.append(head, nav);
  document.body.append(tab, panel);

  const persistExpanded = (): void => {
    try {
      localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify([...expanded]));
    } catch {
      // Blocked storage: the tree still folds for this tab.
    }
  };

  const setOpen = (next: boolean): void => {
    state.opened = next;
    panel.classList.toggle('is-open', next);
    panel.inert = !next;
    if (next) {
      panel.removeAttribute('aria-hidden');
    } else {
      panel.setAttribute('aria-hidden', 'true');
    }
    tab.classList.toggle('is-covered', next);
    tab.setAttribute('aria-expanded', String(next));
  };

  const renderNode = (node: PageTreeNode, depth: number, current: string | null): HTMLLIElement => {
    const item = element('li', 'pg-tree-item');
    const row = element('div', 'pg-tree-row');
    const link = element('a', 'pg-tree-link');
    const icon = element('span', 'pg-tree-icon');
    const label = element('span', 'pg-tree-title');

    row.style.setProperty('--pg-tree-depth', String(depth));
    link.href = options.href(node.id);
    link.setAttribute('data-pg-tree-focus', `link:${node.id ?? ''}`);
    if (node.id === current) {
      link.setAttribute('aria-current', 'page');
    }
    if (node.icon === undefined) {
      icon.innerHTML = IconPage;
    } else {
      icon.textContent = node.icon;
    }
    label.textContent = node.title;
    link.append(icon, label);
    link.addEventListener('click', (event) => {
      // Cmd/Ctrl/Shift/middle click opens the href in a new tab or window.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      event.preventDefault();
      options.navigate(node.id, link);
    });
    row.append(link);
    item.append(row);

    if (node.children.length === 0) {
      return item;
    }

    const group = element('ul', 'pg-tree-group');

    // The root's pages start the indent: the root row has no toggle to clear.
    const childDepth = node.id === null ? 0 : depth + 1;

    node.children.forEach((child) => group.append(renderNode(child, childDepth, current)));
    item.append(group);

    // The root document is always open: it is the top of the tree.
    if (node.id === null) {
      return item;
    }

    const id = node.id;
    const toggle = element('button', 'pg-tree-toggle');
    const sync = (): void => {
      const isOpen = expanded.has(id);

      group.hidden = !isOpen;
      toggle.setAttribute('aria-expanded', String(isOpen));
      toggle.setAttribute('aria-label', `${isOpen ? 'Collapse' : 'Expand'} ${node.title}`);
    };

    toggle.type = 'button';
    toggle.setAttribute('data-pg-tree-focus', `toggle:${id}`);
    toggle.innerHTML = IconChevronRight;
    toggle.addEventListener('click', () => {
      if (expanded.has(id)) {
        expanded.delete(id);
      } else {
        expanded.add(id);
      }
      persistExpanded();
      sync();
    });
    row.append(toggle);
    sync();

    return item;
  };

  const refresh = (): void => {
    const current = options.currentPageId();
    const root = buildPageTree(options.pages, options.blocksOf);

    // Once per page, so a branch the user folded stays folded. A shared
    // document loads late, so the page may not be in the tree yet.
    const ancestors = current === null || current === state.lastCurrent ? null : ancestorsIn(root, current);

    if (ancestors !== null) {
      ancestors.forEach((id) => expanded.add(id));
      persistExpanded();
    }
    if (current === null || ancestors !== null) {
      state.lastCurrent = current;
    }

    // A redraw mid-keyboard-walk must not drop focus to <body>.
    const focused = document.activeElement instanceof HTMLElement && list.contains(document.activeElement)
      ? document.activeElement.dataset.pgTreeFocus
      : undefined;

    list.replaceChildren(renderNode(root, 0, current));

    if (focused !== undefined) {
      [...list.querySelectorAll<HTMLElement>('[data-pg-tree-focus]')].find((node) => node.dataset.pgTreeFocus === focused)?.focus();
    }
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && state.opened && !event.defaultPrevented) {
      event.preventDefault();
      setOpen(false);
    }
  };

  const open = (): void => {
    if (!state.available) {
      return;
    }
    refresh();
    setOpen(true);
  };

  tab.addEventListener('click', open);
  close.addEventListener('click', () => setOpen(false));
  // On window, so it runs after every document listener: the settings drawer
  // and the editor each take their Escape first.
  window.addEventListener('keydown', onKeydown);

  setOpen(false);
  refresh();

  return {
    open,
    close: () => setOpen(false),
    toggle: () => (state.opened ? setOpen(false) : open()),
    isOpen: () => state.opened,
    refresh,
    setAvailable: (next) => {
      state.available = next;
      if (!next) {
        setOpen(false);
      }
      tab.hidden = !next;
    },
    destroy: () => {
      window.removeEventListener('keydown', onKeydown);
      tab.remove();
      panel.remove();
    },
  };
};
