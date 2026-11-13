import { renderPageIcon } from './page-icon';
/**
 * Host page tree. The editor never owns navigation: a page row opens a
 * document, and the plus button asks the host to create one.
 */

import { onHover } from '../components/utils/tooltip';
import { isPromotedToTopLayer, promoteToTopLayer, removeFromTopLayer } from '../components/utils/top-layer';

export interface ShellPage {
  id: string;
  title: string;
  icon?: string;
  parentId: string | null;
  /** Toggled from the page menu. A filled star is the on state. */
  favorite?: boolean;
  /**
   * Section heading this page belongs under. Derived by the host from sharing
   * state and never stored: a page moves out of its section on its own when
   * someone is invited. Absent means one flat list, as before.
   */
  section?: string;
}

export interface PageFrame {
  element: HTMLElement;
  canvas: HTMLElement;
  setPages: (pages: ShellPage[], activeId: string) => void;
  toggleSidebar: () => void;
}

export type SidebarAction =
  | { id: string; type: 'rename'; title: string }
  | { id: string; type: 'duplicate' }
  | { id: string; type: 'delete' }
  | { id: string; type: 'offline'; on: boolean }
  | { id: string; type: 'move' }
  | { id: string; type: 'wiki' }
  | { id: string; type: 'open-tab' }
  | { id: string; type: 'open-window' }
  | { id: string; type: 'open-peek' };

export interface PageFrameOptions {
  /** L'espace courant, rendu comme une ligne sous « Espaces » plutôt qu'un titre. */
  teamspace?: { name: string };
  pages: ShellPage[];
  activeId: string;
  onOpen: (id: string) => void;
  onCreate: (parentId: string | null) => void;
  onAction?: (action: SidebarAction) => void;
  onFavorite?: (id: string, favorite: boolean) => void;
  onCreatePrivate?: () => void;
  onSearch?: (recentIds?: string[]) => void;
  recentIds?: string[];
  onRecentsChange?: (ids: string[]) => void;
  onTeamspaceMenu?: (anchor: HTMLButtonElement) => void;
  pageUrl?: (id: string) => string;
  availableActions?: SidebarAction['type'][];
  canEdit?: (id: string) => boolean;
  canCreate?: (parentId: string | null) => boolean;
}

const minWidth = 220;
const maxWidth = 420;

function svg(paths: readonly string[], filled = false): SVGSVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', '0 0 16 16');
  node.setAttribute('width', '16');
  node.setAttribute('height', '16');
  node.setAttribute('aria-hidden', 'true');
  paths.forEach((d) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', filled ? 'currentColor' : 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    node.append(path);
  });
  return node;
}

const ICONS = {
  page: ['M4 2.5h5l3 3v8H4z', 'M9 2.5v3h3'],
  star: ['M8 1.8 9.7 6.1l4.6.4-3.5 2.9 1.1 4.5L8 11.5 4.1 13.9l1.1-4.5L1.7 6.5l4.6-.4Z'],
  cloud: ['M4 11.2h8a2 2 0 0 0 .2-4 3.2 3.2 0 0 0-6.2-.8A2 2 0 0 0 4 11.2Z'],
  link: ['M6.8 9.2 5.4 10.6a1.9 1.9 0 0 1-2.7-2.7L4.1 6.5', 'M9.2 6.8 10.6 5.4a1.9 1.9 0 0 1 2.7 2.7L11.9 9.5', 'M6.5 9.5l3-3'],
  copy: ['M5.8 5.8h6.6v6.6H5.8Z', 'M3.6 9.2V3.6h5.6'],
  pencil: ['M2.8 11.4 11.2 3l1.8 1.8-8.4 8.4H2.8Z'],
  move: ['M4 12 12 4', 'M7 4h5v5'],
  trash: ['M3.5 4.5h9', 'M6 4.5V3h4v1.5', 'M5 4.5l.7 8.5h4.6L11 4.5'],
  wiki: ['M3 3.5h4c.6.9 1.4.9 2 0h4V12.5H9c-.6.9-1.4.9-2 0H3Z', 'M8 3.5v9'],
  tab: ['M5.5 5H3.5v7.5h7.5V10', 'M8 3.5h4.5V8', 'M12.2 3.8 7.2 8.8'],
  window: ['M3 4h10v8.5H3Z', 'M3 6.5h10'],
  peek: ['M3 3.5h10v9H3Z', 'M8.2 3.5v9'],
} as const;

const ADD_HINT = 'Ajouter une sous-page';
const MORE_HINT = 'Actions de la page';
const MENU_WIDTH = 248;

const dismissers = new Map<HTMLElement, (event: PointerEvent) => void>();

function closeMenu(menu: HTMLElement): void {
  const dismiss = dismissers.get(menu);
  if (dismiss !== undefined) {
    document.removeEventListener('pointerdown', dismiss, true);
    dismissers.delete(menu);
  }
  menu.parentElement?.querySelector('[data-blok-sidebar-more]')?.setAttribute('aria-expanded', 'false');
  removeFromTopLayer(menu);
}

function openMenu(menu: HTMLElement, anchor: HTMLElement): void {
  promoteToTopLayer(menu);
  anchor.setAttribute('aria-expanded', 'true');
  const dismiss = (event: PointerEvent): void => {
    const target = event.target;
    if (target instanceof Node && (menu.contains(target) || anchor.contains(target))) return;
    closeMenu(menu);
  };
  dismissers.set(menu, dismiss);
  document.addEventListener('pointerdown', dismiss, true);
}

function copyLink(id: string, pageUrl?: (id: string) => string): void {
  const clipboard = navigator.clipboard;
  if (clipboard === undefined || typeof clipboard.writeText !== 'function') return;
  const url = new URL(location.href);
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  url.searchParams.set('page', id);
  void Promise.resolve(clipboard.writeText(pageUrl?.(id) ?? url.href)).catch(() => undefined);
}

const chevron = () => svg(['M6 4.5 10 8 6 11.5']);
const plus = () => svg(['M8 3.5v9', 'M3.5 8h9']);
const search = () => svg(['M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z', 'M10.5 10.5 13 13']);

function dots(): SVGSVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', '0 0 16 16');
  node.setAttribute('width', '16');
  node.setAttribute('height', '16');
  node.setAttribute('aria-hidden', 'true');
  [3.5, 8, 12.5].forEach((cx) => {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', String(cx));
    circle.setAttribute('cy', '8');
    circle.setAttribute('r', '1.15');
    circle.setAttribute('fill', 'currentColor');
    node.append(circle);
  });
  return node;
}

function childrenOf(pages: ShellPage[], parentId: string | null): ShellPage[] {
  return pages.filter((page) => page.parentId === parentId);
}

function matches(pages: ShellPage[], page: ShellPage, needle: string): boolean {
  if (page.title.toLocaleLowerCase().includes(needle)) return true;
  return childrenOf(pages, page.id).some((child) => matches(pages, child, needle));
}

export function createPageFrame(options: PageFrameOptions): PageFrame {
  const view: { pages: ShellPage[]; activeId: string; query: string } = {
    pages: options.pages,
    activeId: options.activeId,
    query: '',
  };
  const closed = new Set<string>();
  const offline = new Set<string>();

  const shell = document.createElement('div');
  shell.setAttribute('data-blok-interface', 'shell');
  shell.setAttribute('data-blok-shell', '');

  const sidebar = document.createElement('aside');
  sidebar.setAttribute('data-blok-sidebar', '');
  sidebar.setAttribute('data-blok-testid', 'sidebar');

  const header = document.createElement('div');
  header.setAttribute('data-blok-sidebar-header', '');
  const collapse = document.createElement('button');
  collapse.type = 'button';
  collapse.setAttribute('data-blok-sidebar-icon', '');
  collapse.setAttribute('aria-label', 'Masquer la barre latérale');
  collapse.title = 'Masquer la barre latérale';
  collapse.append(svg(['M2 2.5h12v11H2z', 'M6 2.5v11']));
  collapse.addEventListener('click', () => setCollapsed(true));
  const create = document.createElement('button');
  create.type = 'button';
  create.setAttribute('data-blok-sidebar-icon', '');
  create.setAttribute('aria-label', 'Nouvelle page');
  create.title = 'Nouvelle page';
  create.append(svg(ICONS.pencil));
  create.addEventListener('click', () => options.onCreate(null));
  header.append(collapse, create);

  // Notion met « New page » sur une ligne de la barre, pas seulement derrière le
  // + de l'en-tête : c'est l'action la plus fréquente, elle mérite sa place.
  const shortcuts = document.createElement('div');
  shortcuts.setAttribute('data-blok-sidebar-shortcuts', '');
  const newPage = document.createElement('button');
  newPage.type = 'button';
  newPage.setAttribute('data-blok-sidebar-shortcut', '');
  newPage.append(svg(ICONS.pencil));
  const newPageLabel = document.createElement('span');
  newPageLabel.textContent = 'Nouvelle page';
  newPage.append(newPageLabel);
  newPage.addEventListener('click', () => options.onCreate(null));
  shortcuts.append(newPage);

  const searchLabel = document.createElement(options.onSearch ? 'button' : 'label');
  searchLabel.setAttribute('data-blok-sidebar-search', '');
  searchLabel.append(search());
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = 'Rechercher une page…';
  searchInput.setAttribute('aria-label', 'Rechercher une page');
  searchInput.addEventListener('input', () => {
    view.query = searchInput.value.trim().toLocaleLowerCase();
    paint();
  });
  if (searchLabel instanceof HTMLButtonElement) {
    searchLabel.type = 'button';
    searchLabel.setAttribute('aria-label', 'Rechercher une page');
    searchLabel.setAttribute('aria-haspopup', 'dialog');
    const label = document.createElement('span');
    label.textContent = 'Rechercher…';
    const shortcut = document.createElement('kbd');
    shortcut.textContent = /Mac/i.test(navigator.platform) ? '⌘K' : 'Ctrl K';
    searchLabel.append(label, shortcut);
    searchLabel.addEventListener('click', () => options.onSearch?.());
  } else searchLabel.append(searchInput);

  const tree = document.createElement('nav');
  tree.setAttribute('data-blok-sidebar-tree', '');
  tree.setAttribute('aria-label', 'Pages');

  const edge = document.createElement('div');
  edge.setAttribute('data-blok-sidebar-edge', '');
  const resize = document.createElement('div');
  resize.setAttribute('data-blok-sidebar-resize', '');
  resize.setAttribute('role', 'separator');
  resize.setAttribute('tabindex', '0');
  resize.setAttribute('aria-orientation', 'vertical');
  resize.setAttribute('aria-valuemin', '0');
  resize.setAttribute('aria-valuemax', '100');
  resize.setAttribute('aria-label', 'Redimensionner avec les flèches gauche et droite');
  const anchor = document.createElement('span');
  anchor.setAttribute('data-blok-sidebar-resize-anchor', '');
  resize.append(anchor);
  edge.append(resize);
  const hintAction = document.createElement('span');
  const hint = document.createElement('div');
  hint.setAttribute('data-blok-sidebar-resize-hint', '');
  const hintGesture = document.createElement('span');
  hintGesture.textContent = 'Clic ou ⌘\\';
  const hintResize = document.createElement('span');
  hintResize.textContent = 'Redimensionner';
  const hintDrag = document.createElement('span');
  hintDrag.textContent = 'Glisser';
  hint.append(hintAction, hintGesture, hintResize, hintDrag);
  const syncHint = (): void => {
    hintAction.textContent = sidebar.hasAttribute('data-collapsed') ? 'Ouvrir' : 'Fermer';
  };
  syncHint();
  onHover(resize, hint, { placement: 'right', anchor: () => anchor, gap: 12 });
  const placeHint = (clientY: number): void => {
    const rect = resize.getBoundingClientRect();
    anchor.style.top = `${Math.min(rect.height, Math.max(0, clientY - rect.top))}px`;
  };
  const widthState = { open: 260 };
  const syncValue = (): void => {
    const span = maxWidth - minWidth;
    const width = sidebar.getBoundingClientRect().width || widthState.open;
    const value = sidebar.hasAttribute('data-collapsed') || span === 0
      ? 0
      : Math.round(((width - minWidth) / span) * 100);
    resize.setAttribute('aria-valuenow', String(Math.min(100, Math.max(0, value))));
  };
  const setCollapsed = (collapsed: boolean): void => {
    tree.querySelectorAll<HTMLElement>('[data-blok-sidebar-menu]').forEach(closeMenu);
    if (collapsed) {
      widthState.open = sidebar.getBoundingClientRect().width || widthState.open;
      sidebar.setAttribute('data-collapsed', '');
      sidebar.style.width = '0px';
    } else {
      sidebar.removeAttribute('data-collapsed');
      sidebar.style.width = `${widthState.open}px`;
    }
    syncHint();
    syncValue();
  };
  syncValue();
  resize.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    resize.setPointerCapture(event.pointerId);
    const dragState = { dragged: false };
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (next: PointerEvent): void => {
      placeHint(next.clientY);
      if (!dragState.dragged && Math.hypot(next.clientX - startX, next.clientY - startY) < 4) return;
      dragState.dragged = true;
      resize.setAttribute('data-resizing', '');
      sidebar.removeAttribute('data-collapsed');
      const width = Math.min(maxWidth, Math.max(minWidth, next.clientX - shell.getBoundingClientRect().left));
      sidebar.style.width = `${width}px`;
      widthState.open = width;
      syncValue();
    };
    const stop = (): void => {
      resize.removeAttribute('data-resizing');
      if (!dragState.dragged) setCollapsed(!sidebar.hasAttribute('data-collapsed'));
      resize.removeEventListener('pointermove', move);
      resize.removeEventListener('pointerup', stop);
    };
    resize.addEventListener('pointermove', move);
    resize.addEventListener('pointerup', stop);
  });
  resize.addEventListener('pointermove', (event) => placeHint(event.clientY));
  resize.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 16 : -16;
    sidebar.removeAttribute('data-collapsed');
    const width = Math.min(maxWidth, Math.max(minWidth, (sidebar.getBoundingClientRect().width || widthState.open) + delta));
    sidebar.style.width = `${width}px`;
    widthState.open = width;
    syncHint();
    syncValue();
  });
  shell.addEventListener('keydown', (event) => {
    if (options.onSearch && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      options.onSearch();
      return;
    }
    if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key !== '\\') return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    event.preventDefault();
    setCollapsed(!sidebar.hasAttribute('data-collapsed'));
  });

  sidebar.append(header, searchLabel, shortcuts, tree, edge);

  const canvas = document.createElement('main');
  canvas.setAttribute('data-blok-sidebar-canvas', '');
  shell.append(sidebar, canvas);

  const collapsed = new Set<string>();
  // La barre latérale tient elle-même la liste des pages ouvertes : elle reçoit
  // déjà chaque changement de page active, et l'hôte n'a rien à lui transmettre.
  const recents: string[] = [...new Set(options.recentIds ?? [])].slice(0, 50);
  const remember = (id: string): void => {
    if (id === '') return;
    const seen = recents.indexOf(id);
    // Keep the five visible shortcuts stable while navigating between them.
    if (seen >= 0 && seen < 5) return;
    if (seen !== -1) recents.splice(seen, 1);
    recents.unshift(id);
    recents.splice(50);
    options.onRecentsChange?.([...recents]);
  };

  function paint(): void {
    tree.querySelectorAll('[data-blok-sidebar-menu]').forEach((node) => {
      if (node instanceof HTMLElement) closeMenu(node);
    });
    tree.replaceChildren();
    create.hidden = newPage.hidden = options.canCreate?.(null) === false;
    const needle = view.query;
    const roots = childrenOf(view.pages, null).filter((page) => needle === '' || matches(view.pages, page, needle));
    if (roots.length === 0) {
      const empty = document.createElement('p');
      empty.setAttribute('data-blok-sidebar-empty', '');
      empty.textContent = 'Aucune page';
      tree.append(empty);
      if (needle === '' && options.teamspace) openSection('workspace');
      if (needle === '' && options.onCreatePrivate) appendPrivateAdd(appendSection('Privé', 'Privé'));
      return;
    }
    // Favoris et Récents sont des raccourcis : une page y apparaît en plus de sa
    // place dans l'arbre, jamais à la place. Ils ne s'affichent qu'avec quelque
    // chose à montrer, comme chez Notion où Favoris naît du premier favori.
    const favorites = view.pages.filter((page) => page.favorite === true && (needle === '' || matches(view.pages, page, needle)));

    const recent = recents
      .map((id) => view.pages.find((page) => page.id === id))
      .filter((page): page is ShellPage => page !== undefined && (needle === '' || matches(view.pages, page, needle)));
    if (needle === '' && recent.length > 0) appendShortcutSection('Récents', 'recents', recent);
    if (needle === '' && favorites.length > 0) appendShortcutSection('Favoris', 'favorites', favorites);
    if (needle === '' && options.teamspace && !roots.some((page) => page.section === 'workspace')) openSection('workspace');

    // Les sections d'accès ne sont pas des conteneurs : les pages restent une
    // seule liste et conservent leur ordre. Un titre s'intercale quand la
    // section change, ce qui laisse le glisser-déposer et la hiérarchie intacts.
    // Un titre par section rencontrée, puis les pages dessous : l'ordre des
    // pages décide, la section n'est qu'un repère posé au changement.
    const opened = new Map<string, HTMLElement>();
    const order = ['workspace', 'Partagé', 'Privé'];
    roots.sort((a, b) => order.indexOf(a.section ?? '') - order.indexOf(b.section ?? ''));
    roots.forEach((page) => {
      const section = page.section ?? '';
      if (section === '') {
        tree.append(...rows(page, 0, needle !== ''));
        return;
      }
      const body = opened.get(section) ?? openSection(section);
      opened.set(section, body);
      if (collapsed.has(section)) return;
      body.append(...rows(page, 0, needle !== ''));
    });
    if (needle === '' && options.onCreatePrivate) {
      const group = opened.get('Privé') ?? appendSection('Privé', 'Privé');
      if (!collapsed.has('Privé')) appendPrivateAdd(group);
    }
  }

  /**
   * L'espace n'est pas un titre : chez Notion c'est une ligne avec son icône,
   * sous l'en-tête « Espaces », et ses pages sont indentées dessous. Les autres
   * sections restent de simples titres.
   */
  function openSection(section: string): HTMLElement {
    const teamspace = options.teamspace;
    if (section !== 'workspace' || !teamspace) return appendSection(section, section);
    const group = appendSection('Espaces d’équipe', 'workspace');
    if (collapsed.has('workspace')) return document.createElement('div');
    const row = document.createElement('div');
    row.setAttribute('data-blok-sidebar-teamspace', '');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(!collapsed.has('teamspace')));
    const mark = document.createElement('span');
    mark.setAttribute('data-blok-sidebar-teamspace-mark', '');
    mark.setAttribute('aria-hidden', 'true');
    mark.append(svg(['M2 7 8 2l6 5', 'M4 6v7h3V9h2v4h3V6']));
    const label = document.createElement('span');
    label.textContent = teamspace.name;
    const arrow = chevron();
    arrow.setAttribute('data-blok-sidebar-teamspace-chevron', '');
    mark.append(arrow);
    toggle.append(mark, label);
    toggle.addEventListener('click', () => {
      if (collapsed.has('teamspace')) collapsed.delete('teamspace');
      else collapsed.add('teamspace');
      paint();
    });
    row.append(toggle);
    if (options.canCreate?.(null) !== false) {
      const add = document.createElement('button');
      add.type = 'button';
      add.setAttribute('data-blok-sidebar-teamspace-add', '');
      add.setAttribute('aria-label', `Créer dans ${teamspace.name}`);
      add.append(plus());
      add.addEventListener('click', () => options.onCreate(null));
      row.append(add);
    }
    if (options.onTeamspaceMenu) {
      const more = document.createElement('button');
      more.type = 'button';
      more.setAttribute('data-blok-sidebar-teamspace-more', '');
      more.setAttribute('aria-label', `Paramètres de ${teamspace.name}`);
      more.setAttribute('aria-haspopup', 'menu');
      more.append(dots());
      more.addEventListener('click', () => options.onTeamspaceMenu?.(more));
      row.append(more);
    }
    group.append(row);
    if (collapsed.has('teamspace')) return document.createElement('div');
    const nested = document.createElement('div');
    nested.setAttribute('data-blok-sidebar-teamspace-pages', '');
    group.append(nested);
    return nested;
  }

  /** Un titre de section, repliable d'un clic comme chez Notion. */
  function appendSection(label: string, key: string): HTMLElement {
    const heading = document.createElement('button');
    heading.type = 'button';
    heading.setAttribute('data-blok-sidebar-section-label', '');
    heading.setAttribute('aria-expanded', String(!collapsed.has(key)));
    heading.textContent = label;
    heading.addEventListener('click', () => {
      if (collapsed.has(key)) collapsed.delete(key);
      else collapsed.add(key);
      paint();
    });
    const group = document.createElement('div');
    group.setAttribute('data-blok-sidebar-section', '');
    const sectionHeader = document.createElement('div');
    sectionHeader.setAttribute('data-blok-sidebar-section-header', '');
    sectionHeader.append(heading);
    if (key === 'Privé' && options.onCreatePrivate && options.canCreate?.(null) !== false) {
      const addPrivate = document.createElement('button');
      addPrivate.type = 'button';
      addPrivate.setAttribute('data-blok-sidebar-icon', '');
      addPrivate.setAttribute('data-blok-sidebar-create-private', '');
      addPrivate.setAttribute('aria-label', 'Créer une page privée');
      addPrivate.title = 'Créer une page privée';
      addPrivate.append(plus());
      addPrivate.addEventListener('click', () => { collapsed.delete('Privé'); options.onCreatePrivate?.(); });
      sectionHeader.append(addPrivate);
    }
    group.append(sectionHeader);
    tree.append(group);
    return group;
  }

  function appendShortcutSection(label: string, key: string, pages: ShellPage[]): void {
    const group = appendSection(label, key);
    group.setAttribute(`data-blok-sidebar-${key}`, '');
    if (collapsed.has(key)) return;
    // À plat : un raccourci n'a pas d'enfants à déployer.
    (key === 'recents' ? pages.slice(0, 5) : pages).forEach((page) => group.append(...rows(page, 0, false, true)));
    if (key === 'recents' && options.onSearch) {
      const all = document.createElement('button');
      all.type = 'button';
      all.setAttribute('data-blok-sidebar-shortcut', '');
      all.append(dots(), document.createTextNode('Tout voir'));
      all.addEventListener('click', () => options.onSearch?.([...recents]));
      group.append(all);
    }
  }

  function appendPrivateAdd(group: HTMLElement): void {
    if (options.canCreate?.(null) === false || collapsed.has('Privé')) return;
    const add = document.createElement('button');
    add.type = 'button';
    add.setAttribute('data-blok-sidebar-shortcut', '');
    add.setAttribute('data-blok-sidebar-private-add-row', '');
    add.append(plus(), document.createTextNode('Ajouter une page'));
    add.addEventListener('click', () => options.onCreatePrivate?.());
    group.append(add);
  }

  function rows(page: ShellPage, depth: number, forceOpen: boolean, shortcut = false): HTMLElement[] {
    const visibleChildren = shortcut ? [] : view.query === ''
      ? childrenOf(view.pages, page.id)
      : childrenOf(view.pages, page.id).filter((child) => matches(view.pages, child, view.query));
    const expanded = visibleChildren.length > 0 && (forceOpen || !closed.has(page.id));
    const row = document.createElement('div');
    row.setAttribute('data-blok-sidebar-row', '');
    if (page.id === view.activeId) row.setAttribute('data-active', '');
    row.style.paddingInlineStart = `${8 + depth * 8}px`;

    const canExpand = visibleChildren.length > 0;
    const leading = document.createElement(canExpand ? 'button' : 'span');
    if (canExpand) {
      leading.setAttribute('type', 'button');
      leading.setAttribute('data-blok-sidebar-toggle', '');
      leading.setAttribute('aria-label', expanded ? 'Replier' : 'Déplier');
      leading.setAttribute('aria-expanded', String(expanded));
    } else {
      leading.setAttribute('data-blok-sidebar-leaf', '');
      leading.setAttribute('aria-hidden', 'true');
    }
    const glyph = document.createElement('span');
    glyph.setAttribute('data-blok-sidebar-glyph', '');
    glyph.setAttribute('aria-hidden', 'true');
    if (page.icon) renderPageIcon(glyph, page.icon);
    else glyph.append(svg(ICONS.page));
    leading.append(glyph);
    if (canExpand) {
      const mark = document.createElement('span');
      mark.setAttribute('data-blok-sidebar-chevron', '');
      mark.setAttribute('aria-hidden', 'true');
      if (expanded) mark.setAttribute('data-open', '');
      mark.append(chevron());
      leading.append(mark);
      leading.addEventListener('click', () => {
        if (closed.has(page.id)) closed.delete(page.id);
        else closed.add(page.id);
        paint();
      });
    }

    const link = document.createElement('button');
    link.type = 'button';
    link.setAttribute('data-blok-sidebar-link', '');
    if (page.id === view.activeId) link.setAttribute('aria-current', 'page');
    const label = document.createElement('span');
    label.setAttribute('data-blok-sidebar-label', '');
    label.textContent = page.title;
    link.title = page.title;
    link.append(label);
    link.addEventListener('click', () => options.onOpen(page.id));

    const add = document.createElement('button');
    add.type = 'button';
    add.setAttribute('data-blok-sidebar-add', '');
    add.setAttribute('aria-label', ADD_HINT);
    add.hidden = options.canCreate?.(page.id) === false;
    add.append(plus());
    onHover(add, ADD_HINT);
    add.addEventListener('click', () => {
      closed.delete(page.id);
      options.onCreate(page.id);
    });

    const more = document.createElement('button');
    more.type = 'button';
    more.setAttribute('data-blok-sidebar-more', '');
    more.setAttribute('aria-label', MORE_HINT);
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', 'false');
    more.append(dots());
    onHover(more, MORE_HINT);

    const menu = document.createElement('div');
    menu.setAttribute('data-blok-sidebar-menu', '');
    const list = document.createElement('div');
    list.setAttribute('role', 'menu');
    list.setAttribute('aria-label', MORE_HINT);
    appendPageMenu(list, menu, link, page);
    menu.append(list);
    more.addEventListener('click', () => {
      if (isPromotedToTopLayer(menu)) {
        closeMenu(menu);
        return;
      }
      const rect = more.getBoundingClientRect();
      menu.style.top = `${rect.bottom + 4}px`;
      menu.style.left = `${Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8))}px`;
      tree.querySelectorAll<HTMLElement>('[data-blok-sidebar-menu]').forEach((other) => { if (other !== menu) closeMenu(other); });
      openMenu(menu, more);
      menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - menu.getBoundingClientRect().height - 8))}px`;
      list.querySelector<HTMLButtonElement>('button')?.focus();
    });

    menu.addEventListener('keydown', (event) => {
      const buttons = [...list.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'Escape' || event.key === 'Tab') {
        closeMenu(menu);
        if (event.key === 'Escape') { event.preventDefault(); more.focus(); }
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    });
    row.append(leading, link, more, add, menu);
    const nested = expanded ? visibleChildren.flatMap((child) => rows(child, depth + 1, forceOpen)) : [];
    return [row, ...nested];
  }

  function appendPageMenu(list: HTMLElement, menu: HTMLElement, link: HTMLElement, page: ShellPage): void {
    const favoriteOn = page.favorite === true;
    const entries: Array<
      | { kind: 'separator' }
      | { kind: 'check'; action: 'favorite' | 'offline'; label: string; icon: readonly string[]; on: boolean; filled?: boolean }
      | { kind: 'item'; label: string; icon: readonly string[]; danger?: boolean; run: () => void }
    > = [
      { kind: 'check', action: 'favorite', label: favoriteOn ? 'Retirer des favoris' : 'Ajouter aux favoris', icon: ICONS.star, on: favoriteOn, filled: favoriteOn },
      { kind: 'check', action: 'offline', label: 'Disponible hors connexion', icon: ICONS.cloud, on: offline.has(page.id) },
      { kind: 'separator' },
      { kind: 'item', label: 'Copier le lien', icon: ICONS.link, run: () => copyLink(page.id, options.pageUrl) },
      { kind: 'item', label: 'Dupliquer', icon: ICONS.copy, run: () => options.onAction?.({ id: page.id, type: 'duplicate' }) },
      { kind: 'item', label: 'Renommer', icon: ICONS.pencil, run: () => beginRename(link, page) },
      { kind: 'item', label: 'Déplacer vers', icon: ICONS.move, run: () => options.onAction?.({ id: page.id, type: 'move' }) },
      { kind: 'item', label: 'Mettre à la corbeille', icon: ICONS.trash, danger: true, run: () => options.onAction?.({ id: page.id, type: 'delete' }) },
      { kind: 'separator' },
      { kind: 'item', label: 'Transformer en wiki', icon: ICONS.wiki, run: () => options.onAction?.({ id: page.id, type: 'wiki' }) },
      { kind: 'separator' },
      { kind: 'item', label: 'Ouvrir dans un nouvel onglet', icon: ICONS.tab, run: () => options.onAction?.({ id: page.id, type: 'open-tab' }) },
      { kind: 'item', label: 'Ouvrir dans une nouvelle fenêtre', icon: ICONS.window, run: () => options.onAction?.({ id: page.id, type: 'open-window' }) },
      { kind: 'item', label: 'Ouvrir en aperçu latéral', icon: ICONS.peek, run: () => options.onAction?.({ id: page.id, type: 'open-peek' }) },
      { kind: 'separator' },
    ];

    const supported = new Map<string, SidebarAction['type']>([
      ['Dupliquer', 'duplicate'], ['Renommer', 'rename'], ['Déplacer vers', 'move'],
      ['Mettre à la corbeille', 'delete'], ['Transformer en wiki', 'wiki'],
      ['Ouvrir dans un nouvel onglet', 'open-tab'], ['Ouvrir dans une nouvelle fenêtre', 'open-window'], ['Ouvrir en aperçu latéral', 'open-peek'],
    ]);
    const allowed = entries.filter((entry) => {
      if (entry.kind === 'separator') return true;
      const action = entry.kind === 'check' ? (entry.action === 'offline' ? 'offline' : undefined) : supported.get(entry.label);
      if (action && options.availableActions && !options.availableActions.includes(action)) return false;
      return !action || action.startsWith('open-') || options.canEdit?.(page.id) !== false;
    }).filter((entry, i, all) => entry.kind !== 'separator' || (i > 0 && i < all.length - 1 && all[i - 1]?.kind !== 'separator'));
    allowed.forEach((entry) => {
      if (entry.kind === 'separator') {
        const line = document.createElement('div');
        line.setAttribute('data-blok-sidebar-menu-separator', '');
        line.setAttribute('aria-hidden', 'true');
        list.append(line);
        return;
      }

      const command = document.createElement('button');
      command.type = 'button';
      const icon = document.createElement('span');
      icon.setAttribute('data-blok-sidebar-menu-icon', '');
      icon.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.setAttribute('data-blok-sidebar-menu-label', '');
      text.textContent = entry.label;
      command.append(icon, text);

      if (entry.kind === 'check') {
        command.setAttribute('role', 'menuitemcheckbox');
        command.setAttribute('aria-checked', entry.on ? 'true' : 'false');
        icon.append(svg(entry.icon, entry.filled === true));
        if (entry.action === 'favorite' && entry.on) command.setAttribute('data-filled', '');
        if (entry.action === 'offline') {
          const track = document.createElement('span');
          track.setAttribute('data-blok-sidebar-switch', '');
          track.setAttribute('aria-hidden', 'true');
          command.append(track);
        }
        command.addEventListener('click', () => {
          if (entry.action === 'favorite') {
            closeMenu(menu);
            const target = view.pages.find((item) => item.id === page.id);
            if (target !== undefined) {
              target.favorite = target.favorite !== true;
              options.onFavorite?.(target.id, target.favorite);
            }
            paint();
            return;
          }
          const on = !offline.has(page.id);
          if (on) offline.add(page.id);
          else offline.delete(page.id);
          command.setAttribute('aria-checked', on ? 'true' : 'false');
          options.onAction?.({ id: page.id, type: 'offline', on });
        });
        list.append(command);
        return;
      }

      command.setAttribute('role', 'menuitem');
      if (entry.danger === true) command.setAttribute('data-danger', '');
      icon.append(svg(entry.icon));
      command.addEventListener('click', () => {
        closeMenu(menu);
        entry.run();
      });
      list.append(command);
    });
  }

  function beginRename(link: HTMLElement, page: ShellPage): void {
    const input = document.createElement('input');
    input.value = page.title;
    input.setAttribute('aria-label', `Renommer ${page.title}`);
    input.setAttribute('data-blok-sidebar-rename', '');
    link.replaceWith(input);
    input.focus();
    input.select();
    const rename = { done: false };
    const commit = (save: boolean): void => {
      if (rename.done) return;
      rename.done = true;
      const title = input.value.trim();
      if (save && title && title !== page.title) {
        options.onAction?.({ id: page.id, type: 'rename', title });
        return;
      }
      paint();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit(true);
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        commit(false);
      }
    });
    input.addEventListener('blur', () => commit(true));
  }

  remember(options.activeId);
  paint();

  return {
    element: shell,
    canvas,
    toggleSidebar: () => setCollapsed(!sidebar.hasAttribute('data-collapsed')),
    setPages(next, nextActive) {
      view.pages = next;
      view.activeId = nextActive;
      const allowed = new Set(next.map((page) => page.id));
      for (let i = recents.length - 1; i >= 0; i--) if (!allowed.has(recents[i])) recents.splice(i, 1);
      remember(nextActive);
      paint();
    },
  };
}
