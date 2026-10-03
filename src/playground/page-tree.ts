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
  children(parentId: string | null): Array<PageRecord & { id: string }>;
  trail(pageId: string): Array<PageRecord & { id: string }>;
}

const untitled = (title: string): string => (title.trim() === '' ? 'Untitled' : title);

const pointerOrder = (blocks: OutputBlockData[]): string[] =>
  blocks.flatMap((block) => (block.type === 'page' && typeof block.data?.pageId === 'string' ? [block.data.pageId] : []));

/**
 * Sub-pages sit in the order of their blocks in the parent, like Notion's
 * sidebar. A page with no block there is left out: the root document forgets
 * its edits on reload, so its old pages stay in the registry unlinked.
 * Trashed pages drop out with their whole subtree.
 */
export const buildPageTree = (
  pages: PageTreeSource,
  blocksOf: (pageId: string | null) => OutputBlockData[] | undefined
): PageTreeNode => {
  const seen = new Set<string>();

  const grow = (parentId: string | null): PageTreeNode[] => {
    const order = pointerOrder(blocksOf(parentId) ?? []);

    return pages.children(parentId)
      .filter((page) => page.trashed !== true && !seen.has(page.id) && order.includes(page.id))
      .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
      .map((page) => {
        seen.add(page.id);

        return {
          id: page.id,
          title: untitled(page.title),
          ...(page.icon !== undefined && { icon: page.icon }),
          children: grow(page.id),
        };
      });
  };

  const root = pages.root();

  return {
    id: null,
    title: untitled(root.title),
    ...(root.icon !== undefined && { icon: root.icon }),
    children: grow(null),
  };
};

/* ------------------------------------------------------------------ drawer */

export interface PageTreeOptions {
  pages: PageTreeSource;
  blocksOf: (pageId: string | null) => OutputBlockData[] | undefined;
  currentPageId: () => string | null;
  href: (pageId: string | null) => string;
  navigate: (pageId: string | null) => void;
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
      options.navigate(node.id);
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

    // Only on a page change, so a branch the user folded stays folded.
    if (current !== state.lastCurrent && current !== null) {
      options.pages.trail(current).slice(0, -1).forEach((page) => expanded.add(page.id));
      persistExpanded();
    }
    state.lastCurrent = current;

    // A redraw mid-keyboard-walk must not drop focus to <body>.
    const focused = document.activeElement instanceof HTMLElement && list.contains(document.activeElement)
      ? document.activeElement.dataset.pgTreeFocus
      : undefined;

    list.replaceChildren(renderNode(buildPageTree(options.pages, options.blocksOf), 0, current));

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
