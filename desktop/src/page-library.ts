import { IconTable, IconClock, IconEmojiStar, IconPeople, IconGlobe, IconLock, IconSidebarRight } from '../../src/components/icons';
import { createLibraryTable, type LibraryTableRow } from './library-table-runtime.js';
import { sectionOf } from './page-section';
import type { PageAccessMap } from './page-access';
import type { DesktopPage } from './storage';
import type { PageOutline } from './page-outline';
import type { LibraryCategory } from './page-urls';
import './page-library.css';

export function pageTimestamp(value?: string): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

/** The library only reads the current authorized index, never a second page store. */
export function openPageLibrary(options: {
  container: HTMLElement;
  category?: LibraryCategory;
  onCategoryChange?: (category: LibraryCategory) => void;
  onToggleSidebar?: () => void;
  pages: () => DesktopPage[];
  access: () => PageAccessMap | undefined;
  recentIds: () => string[];
  isFavorite: (id: string) => boolean;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onCreateNote?: () => void;
  canCreate?: boolean;
  loadChildren?: (pageId: string) => Promise<PageOutline[]>;
  onOpenBlock?: (pageId: string, blockId: string) => void;
}): (() => void) & { refresh(): void } {
  const surface = document.createElement('section'); surface.setAttribute('data-page-library', ''); surface.tabIndex = -1;
  surface.setAttribute('aria-label', 'Bibliothèque');
  const heading = document.createElement('h1'); heading.textContent = 'Bibliothèque';
  let disposed = false;
  const close = (): void => { disposed = true; table.destroy(); surface.remove(); };
  const create = document.createElement('button'); create.type = 'button'; create.textContent = 'Nouvelle page'; create.disabled = options.canCreate === false; create.addEventListener('click', options.onCreate);
  const header = document.createElement('header'); header.append(heading, create);
  if (options.onToggleSidebar) {
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.innerHTML = IconSidebarRight; toggle.setAttribute('aria-label', 'Afficher ou masquer la barre latérale');
    toggle.addEventListener('click', options.onToggleSidebar); header.prepend(toggle);
  }
  if (options.onCreateNote) {
    const note = document.createElement('button'); note.type = 'button'; note.textContent = 'Nouvelle note'; note.disabled = options.canCreate === false;
    note.addEventListener('click', () => options.onCreateNote?.()); header.insertBefore(note, create);
  }
  const tabs = document.createElement('div'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Catégories de pages');
  const categories = [['all', 'Toutes', IconTable], ['teamspaces', 'Espaces d’équipe', IconPeople], ['recent', 'Récents', IconClock], ['favorite', 'Favoris', IconEmojiStar], ['shared', 'Partagé', IconGlobe], ['private', 'Privé', IconLock]] as const;
  const view = { category: options.category ?? 'all' };
  const expanded = new Set<string>();
  const outlines = new Map<string, PageOutline[]>();
  const loading = new Set<string>();
  const errors = new Set<string>();
  const input = document.createElement('input'); input.type = 'search'; input.placeholder = 'Rechercher une page…'; input.setAttribute('aria-label', 'Rechercher dans la bibliothèque');
  const sort = document.createElement('select'); sort.setAttribute('aria-label', 'Trier les pages');
  for (const [value, label] of [['default', 'Ordre de la catégorie'], ['title', 'Nom'], ['updated', 'Dernière modification'], ['created', 'Date de création']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = label; sort.append(option);
  }
  const controls = document.createElement('div'); controls.setAttribute('data-library-controls', ''); controls.append(input, sort);
  const results = document.createElement('div'); results.setAttribute('data-library-results', ''); results.setAttribute('role', 'tabpanel'); results.id = 'page-library-results'; results.setAttribute('aria-labelledby', `page-library-tab-${view.category}`);
  // Native database tokens and keyboard ownership apply without mounting an editor.
  results.setAttribute('data-blok-interface', '');
  const targets = new Map<string, { pageId: string; blockId?: string }>();
  const table = createLibraryTable(results, {
    onOpen: id => {
      const target = targets.get(id);
      if (!target || !options.pages().some(page => page.id === target.pageId)) { render(); return; }
      if (target.blockId) options.onOpenBlock?.(target.pageId, target.blockId);
      else options.onOpen(target.pageId);
    },
    onToggle: id => {
      if (expanded.has(id)) { expanded.delete(id); render(); return; }
      expanded.add(id);
      if (options.loadChildren && !outlines.has(id) && !loading.has(id)) {
        loading.add(id); errors.delete(id);
        void options.loadChildren(id).then(items => {
          if (!disposed && options.pages().some(page => page.id === id)) outlines.set(id, items.filter(item => item.pageId === id));
        }).catch(() => { if (!disposed) errors.add(id); }).finally(() => { loading.delete(id); if (!disposed) render(); });
      }
      render();
    },
  });
  const empty = document.createElement('p'); empty.setAttribute('role', 'status');
  function render(): void {
    if (disposed) return;
    const focusedDisclosure = document.activeElement?.matches('[data-blok-database-subitem-toggle]')
      ? document.activeElement.closest('[data-row-id]')?.getAttribute('data-row-id') : null;
    const pages = options.pages(); const access = options.access();
    const recent = new Map(options.recentIds().map((id, position) => [id, position]));
    const matches = pages.filter(page => {
      if (view.category === 'recent') return recent.has(page.id);
      if (view.category === 'favorite') return options.isFavorite(page.id);
      if (view.category === 'teamspaces') return !!access?.[page.id]?.teamspaceId;
      if (view.category === 'shared' || view.category === 'private') return sectionOf(access?.[page.id]) === view.category;
      return true;
    }).filter(page => page.title.toLocaleLowerCase().includes(input.value.trim().toLocaleLowerCase()));
    if (sort.value === 'title') matches.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort.value === 'updated' || sort.value === 'created') {
      const key = sort.value === 'updated' ? 'updatedAt' : 'createdAt';
      matches.sort((a, b) => (Date.parse(b[key] ?? '') || 0) - (Date.parse(a[key] ?? '') || 0));
    } else if (view.category === 'recent') matches.sort((a, b) => (recent.get(a.id) ?? 0) - (recent.get(b.id) ?? 0));
    targets.clear();
    const rows: LibraryTableRow[] = [];
    const byId = new Map(pages.map(page => [page.id, page]));
    const matchIds = new Set(matches.map(page => page.id));
    const searching = input.value.trim() !== '';
    const hasListedAncestor = (page: DesktopPage): boolean => {
      const seen = new Set([page.id]);
      const cursor = { id: page.parentId };
      while (cursor.id && !seen.has(cursor.id)) {
        seen.add(cursor.id);
        if (matchIds.has(cursor.id) && (expanded.has(cursor.id) || !['recent', 'favorite'].includes(view.category))) return true;
        cursor.id = byId.get(cursor.id)?.parentId ?? null;
      }
      return false;
    };
    const rendered = new Set<string>();
    const appendPage = (page: DesktopPage, depth: number): void => {
      if (rendered.has(page.id)) return;
      rendered.add(page.id);
      const children = pages.filter(child => child.parentId === page.id && child.id !== page.id);
      targets.set(page.id, { pageId: page.id });
      rows.push({ id: page.id, title: page.title || 'Nouvelle page', icon: page.icon, updatedAt: page.updatedAt,
        depth, hasChildren: !searching && (children.length > 0 || (outlines.get(page.id)?.length ?? 0) > 0), expanded: expanded.has(page.id) });
      if (!expanded.has(page.id) || searching) return;
      children.forEach(child => appendPage(child, depth + 1));
      for (const database of outlines.get(page.id) ?? []) {
        const id = `database:${page.id}:${database.blockId}`;
        targets.set(id, { pageId: page.id, blockId: database.blockId });
        rows.push({ id, title: database.title, depth: depth + 1, hasChildren: false, expanded: false });
      }
    };
    matches.filter(page => searching || !hasListedAncestor(page)).forEach(page => appendPage(page, 0));
    table.update(rows);
    if (focusedDisclosure) [...results.querySelectorAll<HTMLButtonElement>('[data-blok-database-subitem-toggle]')]
      .find(button => button.closest('[data-row-id]')?.getAttribute('data-row-id') === focusedDisclosure)?.focus();
    empty.textContent = matches.length === 0 ? 'Aucune page à afficher.' : `${matches.length} page${matches.length === 1 ? '' : 's'}`;
    if (loading.size) empty.textContent += ' · Chargement des bases de données…';
    else if (errors.size) empty.textContent += ' · Contenu indisponible. Réduisez puis développez pour réessayer.';
  }
  for (const [value, label, icon] of categories) {
    const tab = document.createElement('button'); tab.type = 'button'; tab.setAttribute('role', 'tab'); const tabIcon = document.createElement('span'); tabIcon.innerHTML = icon; tabIcon.setAttribute('aria-hidden', 'true'); const tabLabel = document.createElement('span'); tabLabel.textContent = label; tab.append(tabIcon, tabLabel); tab.setAttribute('aria-selected', String(view.category === value)); tab.id = `page-library-tab-${value}`; tab.setAttribute('aria-controls', results.id); tab.tabIndex = view.category === value ? 0 : -1;
    tab.addEventListener('click', () => { view.category = value; for (const sibling of tabs.querySelectorAll('button')) { sibling.setAttribute('aria-selected', String(sibling === tab)); sibling.tabIndex = sibling === tab ? 0 : -1; } results.setAttribute('aria-labelledby', tab.id); render(); options.onCategoryChange?.(value); }); tabs.append(tab);
  }
  tabs.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...tabs.querySelectorAll('button')]; const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const edges: Record<string, number> = { Home: 0, End: buttons.length - 1 };
    const next = edges[event.key] ?? (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault(); buttons[next]?.focus(); buttons[next]?.click();
  });
  input.addEventListener('input', render); sort.addEventListener('change', render);
  surface.append(header, tabs, controls, results, empty); options.container.append(surface); render();
  return Object.assign(close, { refresh: render });
}
