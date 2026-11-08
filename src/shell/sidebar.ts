/**
 * Host page tree. The editor never owns navigation: a page row opens a
 * document, and the plus button asks the host to create one.
 */

export interface ShellPage {
  id: string;
  title: string;
  icon?: string;
  parentId: string | null;
}

export interface PageFrame {
  element: HTMLElement;
  canvas: HTMLElement;
  setPages: (pages: ShellPage[], activeId: string) => void;
}

export interface PageFrameOptions {
  pages: ShellPage[];
  activeId: string;
  onOpen: (id: string) => void;
  onCreate: (parentId: string | null) => void;
}

const minWidth = 220;
const maxWidth = 420;

function svg(paths: string[]): SVGSVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', '0 0 16 16');
  node.setAttribute('width', '16');
  node.setAttribute('height', '16');
  node.setAttribute('aria-hidden', 'true');
  paths.forEach((d) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    node.append(path);
  });
  return node;
}

const chevron = () => svg(['M6 4.5 10 8 6 11.5']);
const plus = () => svg(['M8 3.5v9', 'M3.5 8h9']);
const search = () => svg(['M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z', 'M10.5 10.5 13 13']);

function childrenOf(pages: ShellPage[], parentId: string | null): ShellPage[] {
  return pages.filter((page) => page.parentId === parentId);
}

function matches(pages: ShellPage[], page: ShellPage, needle: string): boolean {
  if (page.title.toLocaleLowerCase().includes(needle)) return true;
  return childrenOf(pages, page.id).some((child) => matches(pages, child, needle));
}

export function createPageFrame(options: PageFrameOptions): PageFrame {
  let pages = options.pages;
  let activeId = options.activeId;
  let query = '';
  const closed = new Set<string>();

  const shell = document.createElement('div');
  shell.setAttribute('data-blok-interface', 'blok');
  shell.setAttribute('data-blok-shell', '');

  const sidebar = document.createElement('aside');
  sidebar.setAttribute('data-blok-sidebar', '');
  sidebar.setAttribute('data-blok-testid', 'sidebar');

  const header = document.createElement('div');
  header.setAttribute('data-blok-sidebar-header', '');
  const title = document.createElement('span');
  title.textContent = 'Pages';
  const create = document.createElement('button');
  create.type = 'button';
  create.setAttribute('data-blok-sidebar-icon', '');
  create.setAttribute('aria-label', 'Nouvelle page');
  create.append(plus());
  create.addEventListener('click', () => options.onCreate(null));
  header.append(title, create);

  const searchLabel = document.createElement('label');
  searchLabel.setAttribute('data-blok-sidebar-search', '');
  searchLabel.append(search());
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = 'Rechercher';
  searchInput.setAttribute('aria-label', 'Rechercher une page');
  searchInput.addEventListener('input', () => {
    query = searchInput.value.trim().toLocaleLowerCase();
    paint();
  });
  searchLabel.append(searchInput);

  const tree = document.createElement('nav');
  tree.setAttribute('data-blok-sidebar-tree', '');
  tree.setAttribute('aria-label', 'Pages');

  const resize = document.createElement('button');
  resize.type = 'button';
  resize.setAttribute('data-blok-sidebar-resize', '');
  resize.setAttribute('aria-label', 'Largeur de la barre');
  resize.addEventListener('pointerdown', (event) => {
    resize.setPointerCapture(event.pointerId);
    resize.setAttribute('data-resizing', '');
    const move = (next: PointerEvent) => {
      const width = Math.min(maxWidth, Math.max(minWidth, next.clientX - shell.getBoundingClientRect().left));
      sidebar.style.width = `${width}px`;
    };
    const stop = () => {
      resize.removeAttribute('data-resizing');
      resize.removeEventListener('pointermove', move);
      resize.removeEventListener('pointerup', stop);
    };
    resize.addEventListener('pointermove', move);
    resize.addEventListener('pointerup', stop);
  });

  sidebar.append(header, searchLabel, tree, resize);

  const canvas = document.createElement('main');
  canvas.setAttribute('data-blok-sidebar-canvas', '');
  shell.append(sidebar, canvas);

  function paint(): void {
    tree.replaceChildren();
    const needle = query;
    const roots = childrenOf(pages, null).filter((page) => needle === '' || matches(pages, page, needle));
    if (roots.length === 0) {
      const empty = document.createElement('p');
      empty.setAttribute('data-blok-sidebar-empty', '');
      empty.textContent = 'Aucune page';
      tree.append(empty);
      return;
    }
    roots.forEach((page) => tree.append(...rows(page, 0, needle !== '')));
  }

  function rows(page: ShellPage, depth: number, forceOpen: boolean): HTMLElement[] {
    const visibleChildren = query === ''
      ? childrenOf(pages, page.id)
      : childrenOf(pages, page.id).filter((child) => matches(pages, child, query));
    const open = forceOpen || !closed.has(page.id);
    const row = document.createElement('div');
    row.setAttribute('data-blok-sidebar-row', '');
    if (page.id === activeId) row.setAttribute('data-active', '');
    row.style.paddingInlineStart = `${8 + depth * 14}px`;

    const twist = document.createElement('button');
    twist.type = 'button';
    twist.setAttribute('data-blok-sidebar-twist', '');
    twist.setAttribute('aria-label', open ? 'Replier' : 'Déplier');
    if (visibleChildren.length === 0) {
      twist.setAttribute('data-leaf', '');
      twist.disabled = true;
    } else if (open) {
      twist.setAttribute('data-open', '');
    }
    twist.append(chevron());
    twist.addEventListener('click', () => {
      if (closed.has(page.id)) closed.delete(page.id);
      else closed.add(page.id);
      paint();
    });

    const link = document.createElement('button');
    link.type = 'button';
    link.setAttribute('data-blok-sidebar-link', '');
    if (page.id === activeId) link.setAttribute('aria-current', 'page');
    const glyph = document.createElement('span');
    glyph.setAttribute('data-blok-sidebar-glyph', '');
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = page.icon || '·';
    const label = document.createElement('span');
    label.textContent = page.title;
    link.append(glyph, label);
    link.addEventListener('click', () => options.onOpen(page.id));

    const add = document.createElement('button');
    add.type = 'button';
    add.setAttribute('data-blok-sidebar-add', '');
    add.setAttribute('aria-label', `Page dans ${page.title}`);
    add.append(plus());
    add.addEventListener('click', () => {
      closed.delete(page.id);
      options.onCreate(page.id);
    });

    row.append(twist, link, add);
    const nested = open ? visibleChildren.flatMap((child) => rows(child, depth + 1, forceOpen)) : [];
    return [row, ...nested];
  }

  paint();

  return {
    element: shell,
    canvas,
    setPages(next, nextActive) {
      pages = next;
      activeId = nextActive;
      paint();
    },
  };
}
