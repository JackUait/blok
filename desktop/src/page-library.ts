import { openModalDialog, type ModalDialogHandle } from '@blok/modal-dialog';
import { IconCross, IconFile, IconTable } from '../../src/components/icons';
import { renderPageIcon } from '../../src/shell/page-icon';
import { sectionOf } from './page-section';
import type { PageAccessMap } from './page-access';
import type { DesktopPage } from './storage';
import type { PageOutline } from './page-outline';
import './page-library.css';

export function pageTimestamp(value?: string): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

/** The library only reads the current authorized index, never a second page store. */
export function openPageLibrary(options: {
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
}): () => void {
  const overlay = document.createElement('div'); overlay.setAttribute('data-desktop-settings-overlay', '');
  const surface = document.createElement('section'); surface.setAttribute('data-page-library', ''); surface.tabIndex = -1;
  const heading = document.createElement('h2'); heading.textContent = 'Bibliothèque';
  const closeButton = document.createElement('button'); closeButton.type = 'button'; closeButton.setAttribute('data-library-close', ''); closeButton.setAttribute('aria-label', 'Fermer la bibliothèque'); closeButton.innerHTML = IconCross;
  const modal: { handle: ModalDialogHandle | null } = { handle: null };
  const close = (): void => modal.handle?.close(); closeButton.addEventListener('click', close);
  const create = document.createElement('button'); create.type = 'button'; create.textContent = 'Nouvelle page'; create.disabled = options.canCreate === false; create.addEventListener('click', () => { close(); options.onCreate(); });
  const header = document.createElement('header'); header.append(heading, create, closeButton);
  if (options.onCreateNote) {
    const note = document.createElement('button'); note.type = 'button'; note.textContent = 'Nouvelle note'; note.disabled = options.canCreate === false;
    note.addEventListener('click', () => { close(); options.onCreateNote?.(); }); header.insertBefore(note, create);
  }
  const tabs = document.createElement('div'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Catégories de pages');
  const categories = [['all', 'Toutes'], ['teamspaces', 'Espaces d’équipe'], ['recent', 'Récents'], ['favorite', 'Favoris'], ['shared', 'Partagé'], ['private', 'Privé']] as const;
  const view = { category: 'all' };
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
  const columns = document.createElement('div'); columns.setAttribute('data-library-columns', '');
  const nameColumn = document.createElement('span'); nameColumn.textContent = 'Nom de la page';
  const dateColumn = document.createElement('span'); dateColumn.textContent = 'Dernière modification'; columns.append(nameColumn, dateColumn);
  const results = document.createElement('div'); results.setAttribute('data-library-results', ''); results.setAttribute('role', 'tabpanel'); results.id = 'page-library-results'; results.setAttribute('aria-labelledby', 'page-library-tab-all');
  const empty = document.createElement('p'); empty.setAttribute('role', 'status');
  function render(): void {
    const focusedDisclosure = document.activeElement?.getAttribute('data-library-disclosure');
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
    results.replaceChildren();
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
      const wrapper = document.createElement('div'); wrapper.setAttribute('data-library-row', ''); wrapper.style.paddingLeft = `${depth * 20}px`;
      const children = pages.filter(child => child.parentId === page.id && child.id !== page.id);
      const disclosure = document.createElement('button'); disclosure.type = 'button'; disclosure.setAttribute('data-library-disclosure', page.id);
      disclosure.textContent = expanded.has(page.id) ? '⌄' : '›';
      disclosure.setAttribute('aria-label', `${expanded.has(page.id) ? 'Réduire' : 'Développer'} ${page.title}`);
      disclosure.setAttribute('aria-expanded', String(expanded.has(page.id))); disclosure.hidden = (children.length === 0 && !options.loadChildren) || searching;
      disclosure.addEventListener('click', () => {
        if (expanded.has(page.id)) { expanded.delete(page.id); render(); return; }
        expanded.add(page.id);
        if (options.loadChildren && !outlines.has(page.id) && !loading.has(page.id)) {
          loading.add(page.id); errors.delete(page.id);
          void options.loadChildren(page.id).then(items => {
            if (options.pages().some(item => item.id === page.id)) outlines.set(page.id, items.filter(item => item.pageId === page.id));
          }).catch(() => { errors.add(page.id); }).finally(() => { loading.delete(page.id); render(); });
        }
        render();
      });

      const row = document.createElement('button'); row.type = 'button'; row.setAttribute('data-library-page', '');
      const icon = document.createElement('span'); icon.setAttribute('data-library-icon', ''); icon.setAttribute('aria-hidden', 'true');
      if (page.icon) renderPageIcon(icon, page.icon); else icon.innerHTML = IconFile;
      const name = document.createElement('span'); name.setAttribute('data-library-page-title', ''); name.textContent = page.title || 'Nouvelle page';
      const edited = document.createElement('span'); edited.setAttribute('data-library-date', '');
      const timestamp = pageTimestamp(page.updatedAt); edited.textContent = timestamp ?? '—'; edited.setAttribute('aria-label', timestamp ? `Dernière modification : ${timestamp}` : 'Date de modification inconnue');
      row.append(icon, name, edited); row.addEventListener('click', () => {
        if (!options.pages().some(item => item.id === page.id)) { render(); return; }
        close(); options.onOpen(page.id);
      }); wrapper.append(disclosure, row); results.append(wrapper);
      if (!expanded.has(page.id) || searching) return;
      children.forEach(child => appendPage(child, depth + 1));
      for (const database of outlines.get(page.id) ?? []) {
        const databaseRow = document.createElement('button'); databaseRow.type = 'button'; databaseRow.setAttribute('data-library-database', ''); databaseRow.style.paddingLeft = `${(depth + 1) * 20 + 32}px`;
        const databaseIcon = document.createElement('span'); databaseIcon.setAttribute('data-library-icon', ''); databaseIcon.innerHTML = IconTable;
        const databaseTitle = document.createElement('span'); databaseTitle.textContent = database.title;
        databaseRow.append(databaseIcon, databaseTitle);
        databaseRow.addEventListener('click', () => {
          if (!options.pages().some(item => item.id === page.id)) { render(); return; }
          close(); options.onOpenBlock?.(page.id, database.blockId);
        }); results.append(databaseRow);
      }
      if (loading.has(page.id) || errors.has(page.id)) {
        const message = document.createElement('p'); message.setAttribute('data-library-outline-status', ''); message.setAttribute('role', 'status');
        message.textContent = loading.has(page.id) ? 'Chargement…' : 'Contenu indisponible. Réduisez puis développez pour réessayer.'; results.append(message);
      }
    };
    matches.filter(page => searching || !hasListedAncestor(page)).forEach(page => appendPage(page, 0));
    if (focusedDisclosure) [...results.querySelectorAll<HTMLButtonElement>('[data-library-disclosure]')].find(button => button.getAttribute('data-library-disclosure') === focusedDisclosure)?.focus();
    empty.textContent = matches.length === 0 ? 'Aucune page à afficher.' : `${matches.length} page${matches.length === 1 ? '' : 's'}`;
  }
  for (const [value, label] of categories) {
    const tab = document.createElement('button'); tab.type = 'button'; tab.setAttribute('role', 'tab'); tab.textContent = label; tab.setAttribute('aria-selected', String(view.category === value)); tab.id = `page-library-tab-${value}`; tab.setAttribute('aria-controls', results.id); tab.tabIndex = view.category === value ? 0 : -1;
    tab.addEventListener('click', () => { view.category = value; for (const sibling of tabs.querySelectorAll('button')) { sibling.setAttribute('aria-selected', String(sibling === tab)); sibling.tabIndex = sibling === tab ? 0 : -1; } results.setAttribute('aria-labelledby', tab.id); render(); }); tabs.append(tab);
  }
  tabs.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...tabs.querySelectorAll('button')]; const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const edges: Record<string, number> = { Home: 0, End: buttons.length - 1 };
    const next = edges[event.key] ?? (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault(); buttons[next]?.focus(); buttons[next]?.click();
  });
  input.addEventListener('input', render); sort.addEventListener('change', render);
  surface.append(header, tabs, controls, columns, results, empty); overlay.append(surface); render();
  modal.handle = openModalDialog({ content: overlay, surface, label: 'Bibliothèque', initialFocus: () => input, onDismiss: close });
  return close;
}
