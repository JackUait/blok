import {Table2, Clock3, Star, Users, Building2, LockKeyhole, PanelLeft, Search, ArrowDownUp, SlidersHorizontal, ChevronDown, createElement} from 'lucide';
import {createChoice, type ChoiceControl} from './ui/controls';
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
  /** Device-local pages have no server audience metadata and remain private. */
  local?: boolean;
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
  const close = (): void => { disposed = true; tabObserver?.disconnect(); overflowChoice?.destroy(); sort.destroy(); display.destroy(); creation?.destroy(); table.destroy(); surface.remove(); };
  const icon = (drawing: Parameters<typeof createElement>[0]): SVGElement => createElement(drawing, {'aria-hidden':'true',focusable:'false','stroke-width':'1.8'}) as SVGElement;
  const create = document.createElement('button'); create.type = 'button'; create.textContent = 'Nouvelle page'; create.disabled = options.canCreate === false; create.addEventListener('click', options.onCreate);
  const header = document.createElement('header');
  const createGroup=document.createElement('div');createGroup.setAttribute('data-library-create','');createGroup.append(create);header.append(heading,createGroup);
  const creation=options.onCreateNote?createChoice({label:'Options de création',value:'page',options:[{value:'page',label:'Nouvelle page'},{value:'note',label:'Nouvelle note'}],onChange:value=>{if(value==='note')options.onCreateNote?.();else options.onCreate();}}):null;
  if(creation){creation.element.prepend(icon(ChevronDown));creation.element.setAttribute('data-library-icon-button','');creation.disabled=options.canCreate===false;createGroup.append(creation.element);}
  if (options.onToggleSidebar) {
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.append(icon(PanelLeft)); toggle.setAttribute('data-library-sidebar-toggle',''); toggle.setAttribute('aria-label', 'Afficher ou masquer la barre latérale');
    toggle.addEventListener('click', options.onToggleSidebar); header.prepend(toggle);
  }
  const tabs = document.createElement('div'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Catégories de pages');
  const categories = [['all', 'Toutes', Table2], ['teamspaces', 'Espaces d’équipe', Building2], ['recent', 'Récents', Clock3], ['favorite', 'Favoris', Star], ['shared', 'Partagé', Users], ['private', 'Privé', LockKeyhole]] as const;
  const view = { category: options.category ?? 'all' };
  const expanded = new Set<string>();
  const outlines = new Map<string, PageOutline[]>();
  const loading = new Set<string>();
  const errors = new Set<string>();
  const input = document.createElement('input'); input.type = 'search'; input.placeholder = 'Rechercher une page…'; input.setAttribute('aria-label', 'Rechercher dans la bibliothèque');
  const sort=createChoice({label:'Trier les pages',value:'default',options:[{value:'default',label:'Ordre de la catégorie'},{value:'title',label:'Nom'},{value:'updated',label:'Dernière modification'},{value:'created',label:'Date de création'}],onChange:()=>{sort.element.toggleAttribute('data-active',sort.value!=='default');render();}});
  const display=createChoice({label:'Options d’affichage',value:'standard',options:[{value:'standard',label:'Titre et dernière modification'},{value:'compact',label:'Lignes compactes'},{value:'titles',label:'Titres uniquement'}],onChange:()=>render()});
  for(const [control,drawing] of [[sort,ArrowDownUp],[display,SlidersHorizontal]] as const){control.element.prepend(icon(drawing));control.element.setAttribute('data-library-icon-button','');}
  const searchButton=document.createElement('button');searchButton.type='button';searchButton.setAttribute('data-library-icon-button','');searchButton.setAttribute('aria-label','Rechercher dans la bibliothèque');searchButton.setAttribute('aria-expanded','false');searchButton.append(icon(Search));
  const searchBox=document.createElement('div');searchBox.setAttribute('data-library-search','');searchBox.hidden=true;searchBox.append(icon(Search),input);
  const toggleSearch=(open:boolean):void=>{searchBox.hidden=!open;searchButton.setAttribute('aria-expanded',String(open));if(open)input.focus();else{input.value='';render();searchButton.focus();}};
  searchButton.addEventListener('click',()=>toggleSearch(searchBox.hidden !== false));
  input.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();toggleSearch(false);}});
  const controls=document.createElement('div');controls.setAttribute('data-library-controls','');controls.append(sort.element,searchButton,display.element);
  const overflow=document.createElement('div');overflow.setAttribute('data-library-overflow','');overflow.hidden=true;
  let overflowChoice: ChoiceControl<string> | null = null;
  let overflowKey = '';
  const toolbar=document.createElement('div');toolbar.setAttribute('data-library-toolbar','');toolbar.append(tabs,overflow,controls);
  function fitTabs(): void {
    if (disposed || toolbar.clientWidth === 0) return;
    const buttons = [...tabs.querySelectorAll<HTMLButtonElement>('[role=tab]')];
    buttons.forEach(button => { button.hidden = false; });
    const widths = buttons.map(button => button.getBoundingClientRect().width + 2);
    const available = toolbar.clientWidth - controls.getBoundingClientRect().width - 16;
    const visible = new Set<number>();
    if (widths.reduce((sum, width) => sum + width, 0) <= available) buttons.forEach((_, index) => visible.add(index));
    else {
      // Always keep the selected category visible; reserve room for the overflow menu.
      const active = buttons.findIndex(button => button.getAttribute('aria-selected') === 'true');
      let remaining = available - 106 - (widths[active] ?? 0);
      visible.add(active);
      for (let index = 0; index < widths.length; index++) {
        if (index === active) continue;
        if (widths[index] > remaining) break;
        visible.add(index); remaining -= widths[index];
      }
    }
    const hidden = categories.filter((_, index) => !visible.has(index));
    buttons.forEach((button, index) => { button.hidden = !visible.has(index); });
    overflow.hidden = hidden.length === 0;
    const key = hidden.map(([value]) => value).join(',');
    if (key === overflowKey) return;
    overflowKey = key; overflowChoice?.destroy(); overflowChoice = null; overflow.replaceChildren();
    if (!hidden.length) return;
    overflowChoice = createChoice<string>({label:'Autres catégories',value:'',options:hidden.map(([value,label])=>({value,label})),onChange:value=>buttons[categories.findIndex(([category])=>category===value)]?.click()});
    overflowChoice.element.querySelector('[data-desktop-choice-label]')!.textContent = `${hidden.length} autres…`;
    overflow.append(overflowChoice.element);
  }
  const tabObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fitTabs);
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
      if (view.category === 'shared' || view.category === 'private') return (options.local ? 'private' : sectionOf(access?.[page.id])) === view.category;
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
    surface.setAttribute('data-library-density',display.value==='compact'?'compact':'standard');
    table.update(rows,{showUpdated:display.value!=='titles'});
    if (focusedDisclosure) [...results.querySelectorAll<HTMLButtonElement>('[data-blok-database-subitem-toggle]')]
      .find(button => button.closest('[data-row-id]')?.getAttribute('data-row-id') === focusedDisclosure)?.focus();
    empty.textContent = matches.length === 0 ? 'Aucune page à afficher.' : `${matches.length} page${matches.length === 1 ? '' : 's'}`;
    if (loading.size) empty.textContent += ' · Chargement des bases de données…';
    else if (errors.size) empty.textContent += ' · Contenu indisponible. Réduisez puis développez pour réessayer.';
  }
  for (const [value, label, drawing] of categories) {
    const tab = document.createElement('button'); tab.type = 'button'; tab.setAttribute('role', 'tab'); const tabIcon = document.createElement('span'); tabIcon.append(icon(drawing)); tabIcon.setAttribute('aria-hidden', 'true'); const tabLabel = document.createElement('span'); tabLabel.textContent = label; tab.append(tabIcon, tabLabel); tab.setAttribute('aria-selected', String(view.category === value)); tab.id = `page-library-tab-${value}`; tab.setAttribute('aria-controls', results.id); tab.tabIndex = view.category === value ? 0 : -1;
    tab.addEventListener('click', () => { view.category = value; for (const sibling of tabs.querySelectorAll('button')) { sibling.setAttribute('aria-selected', String(sibling === tab)); sibling.tabIndex = sibling === tab ? 0 : -1; } results.setAttribute('aria-labelledby', tab.id); render(); options.onCategoryChange?.(value); queueMicrotask(fitTabs); }); tabs.append(tab);
  }
  tabs.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...tabs.querySelectorAll<HTMLButtonElement>('button:not([hidden])')]; const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const edges: Record<string, number> = { Home: 0, End: buttons.length - 1 };
    const next = edges[event.key] ?? (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault(); buttons[next]?.focus(); buttons[next]?.click();
  });
  input.addEventListener('input', render);
  surface.append(header, toolbar, searchBox, results, empty); options.container.append(surface); render(); fitTabs(); tabObserver?.observe(toolbar);
  return Object.assign(close, { refresh: render });
}
