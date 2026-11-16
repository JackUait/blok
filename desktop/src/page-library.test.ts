import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openPageLibrary as mountPageLibrary } from './page-library';
import type { DesktopPage } from './storage';
const disposers: Array<() => void> = [];
function openPageLibrary(options: Parameters<typeof mountPageLibrary>[0]): ReturnType<typeof mountPageLibrary> {
  const handle = mountPageLibrary(options); disposers.push(handle); return handle;
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); document.body.replaceChildren(); vi.restoreAllMocks(); });
const pages: DesktopPage[] = [{ id: 'a', title: 'Alpha', parentId: null }, { id: 'b', title: 'Bravo', parentId: 'a' }, { id: 'c', title: 'Charlie', parentId: null }];
function button(label: string): HTMLButtonElement { const result = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === label || item.getAttribute('aria-label') === label); if (!result) throw new Error(`Missing ${label}`); return result; }
const titles = () => [...document.querySelectorAll('[data-blok-database-table-cell][data-property-id="title"] > [data-blok-database-cell]')].map(item => item.textContent);
it('filters accessible pages by effective audience, favorites and viewed recency', () => {
  openPageLibrary({ container: document.body, pages: () => pages, access: () => ({ a: { visibility: 'private', level: 'full', shared: false }, b: { visibility: 'private', level: 'full', shared: false }, c: { visibility: 'workspace', level: 'edit', teamspaceId: 'team' } }), recentIds: () => ['gone', 'b', 'a'], isFavorite: id => id === 'a', onOpen: vi.fn(), onCreate: vi.fn() });
  button('Récents').click(); expect(titles()).toEqual(['Bravo', 'Alpha']);
  button('Favoris').click(); expect(titles()).toEqual(['Alpha']);
  button('Privé').click(); expect(titles()).toEqual(['Alpha']);
  button('Espaces d’équipe').click(); expect(titles()).toEqual(['Charlie']);
  button('Partagé').click(); expect(titles()).toEqual([]);
});
it('searches within a category and refuses to open a revoked page', () => {
  let available = pages; const onOpen = vi.fn();
  openPageLibrary({ container: document.body, pages: () => available, access: () => undefined, recentIds: () => [], isFavorite: () => true, onOpen, onCreate: vi.fn() });
  const input = document.querySelector<HTMLInputElement>('input[type="search"]'); if (!input) throw new Error('Missing search');
  input.value = 'brav'; input.dispatchEvent(new Event('input')); expect(titles()).toEqual(['Bravo']);
  available = []; document.querySelector<HTMLButtonElement>('[data-blok-database-table-open]')?.click(); expect(onOpen).not.toHaveBeenCalled(); expect(titles()).toEqual([]);
});
it('keeps the library available while the page creation dialog is opened', () => {
  const onCreate = vi.fn(); openPageLibrary({ container: document.body, pages: () => [], access: () => undefined, recentIds: () => [], isFavorite: () => false, onOpen: vi.fn(), onCreate });
  button('Nouvelle page').click(); expect(onCreate).toHaveBeenCalledOnce(); expect(document.querySelector('[data-page-library]')).not.toBeNull();
});
it('uses fresh personal navigation on reopening, and disables creation for viewers', () => {
  const favorites = new Set(['a']); let recents = ['a']; const onCreate = vi.fn();
  const options = { container: document.body, pages: () => pages, access: () => undefined, recentIds: () => recents, isFavorite: (id: string) => favorites.has(id), onOpen: vi.fn(), onCreate, canCreate: false };
  const close = openPageLibrary(options); button('Favoris').click(); expect(titles()).toEqual(['Alpha']); close();
  favorites.clear(); favorites.add('c'); recents = ['c', 'b'];
  openPageLibrary(options); button('Favoris').click(); expect(titles()).toEqual(['Charlie']);
  button('Récents').click(); expect(titles()).toEqual(['Charlie', 'Bravo']);
  expect(button('Nouvelle page').disabled).toBe(true); button('Nouvelle page').click(); expect(onCreate).not.toHaveBeenCalled();
});
it('sorts known metadata dates without assigning dates to legacy pages', () => {
  openPageLibrary({ container: document.body, pages: () => [{ ...pages[0], updatedAt: '2026-01-01T10:00:00Z' }, { ...pages[1], parentId: null }, { ...pages[2], updatedAt: '2026-02-01T10:00:00Z' }], access: () => undefined, recentIds: () => [], isFavorite: () => false, onOpen: vi.fn(), onCreate: vi.fn() });
  button('Trier les pages').click(); document.querySelector<HTMLElement>('[data-blok-item-name=updated]')?.click();
  expect(titles()).toEqual(['Charlie', 'Alpha', 'Bravo']);
  expect(document.querySelectorAll('[data-property-id=updated] [data-blok-database-cell]')[2].hasAttribute('data-empty')).toBe(true);
});
it('expands real child pages without duplicate rows and searches collapsed descendants', () => {
  openPageLibrary({ container: document.body, pages: () => pages, access: () => undefined, recentIds: () => [], isFavorite: () => false, onOpen: vi.fn(), onCreate: vi.fn() });
  expect(titles()).toEqual(['Alpha', 'Charlie']);
  const expand = document.querySelector<HTMLButtonElement>('[data-row-id="a"] [data-blok-database-subitem-toggle]'); if (!expand) throw new Error('Missing disclosure');
  expand.click(); expect(titles()).toEqual(['Alpha', 'Bravo', 'Charlie']);
  document.querySelector<HTMLButtonElement>('[data-row-id="a"] [data-blok-database-subitem-toggle]')?.click(); expect(titles()).toEqual(['Alpha', 'Charlie']);
  const input = document.querySelector<HTMLInputElement>('input[type="search"]'); if (!input) throw new Error('Missing search');
  input.value = 'bravo'; input.dispatchEvent(new Event('input')); expect(titles()).toEqual(['Bravo']);
});
it('loads actual inline databases only on expansion and opens their owning page/block', async () => {
  const loadChildren = vi.fn(async () => [{ pageId: 'a', blockId: 'db', title: 'Todo List', type: 'database' as const }]); const onOpenBlock = vi.fn();
  openPageLibrary({ container: document.body, pages: () => pages.slice(0, 2), access: () => undefined, recentIds: () => [], isFavorite: () => false, onOpen: vi.fn(), onCreate: vi.fn(), loadChildren, onOpenBlock });
  expect(loadChildren).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>('[data-row-id="a"] [data-blok-database-subitem-toggle]')?.click();
  await vi.waitFor(() => expect(document.querySelector('[data-row-id=\'database:a:db\']')?.textContent).toContain('Todo List'));
  document.querySelector<HTMLButtonElement>('[data-row-id=\'database:a:db\'] [data-blok-database-table-open]')?.click(); expect(onOpenBlock).toHaveBeenCalledWith('a', 'db');
});
it('discards an outline response when its page access is revoked', async () => {
  let available = pages.slice(0, 2); const onOpenBlock = vi.fn();
  const loadChildren = vi.fn(async () => { available = []; return [{ pageId: 'a', blockId: 'db', title: 'Secret', type: 'database' as const }]; });
  openPageLibrary({ container: document.body, pages: () => available, access: () => undefined, recentIds: () => [], isFavorite: () => false, onOpen: vi.fn(), onCreate: vi.fn(), loadChildren, onOpenBlock });
  document.querySelector<HTMLButtonElement>('[data-row-id="a"] [data-blok-database-subitem-toggle]')?.click();
  await vi.waitFor(() => expect(loadChildren).toHaveBeenCalledOnce());
  expect(document.querySelector('[data-row-id=\'database:a:db\']')).toBeNull();
});
it('offers the Notes collection action separately from ordinary page creation', () => {
  const onCreateNote = vi.fn(); const onCreate = vi.fn();
  openPageLibrary({ container: document.body, pages: () => [], access: () => undefined, recentIds: () => [], isFavorite: () => false, onOpen: vi.fn(), onCreate, onCreateNote });
  button('Options de création').click(); document.querySelector<HTMLElement>('[data-blok-item-name=note]')?.click(); expect(onCreateNote).toHaveBeenCalledOnce(); expect(onCreate).not.toHaveBeenCalled();
  expect(document.querySelector('[data-page-library]')).not.toBeNull();
});

it('mounts in the main content without a modal or disabling sidebar navigation', () => {
  const sidebar = document.createElement('aside'); const open = document.createElement('button'); const navigate = vi.fn();
  open.textContent = 'Open page'; open.onclick = navigate; sidebar.append(open);
  const container = document.createElement('main'); document.body.append(sidebar, container);
  const dispose = openPageLibrary({ container, pages: () => pages, access: () => undefined, recentIds: () => [], isFavorite: () => false, onOpen: vi.fn(), onCreate: vi.fn() });
  expect(container.querySelector('[data-page-library]')).not.toBeNull();
  expect(document.querySelector('[aria-modal="true"], [data-desktop-settings-overlay], [data-library-close]')).toBeNull();
  expect(sidebar.inert).not.toBe(true); open.click(); expect(navigate).toHaveBeenCalledOnce();
  dispose(); expect(container.childElementCount).toBe(0); expect(sidebar.isConnected).toBe(true);
});
it('restores the routed category and reports tab navigation', () => {
  const onCategoryChange = vi.fn();
  openPageLibrary({ container: document.body, category: 'favorite', onCategoryChange, pages: () => pages, access: () => undefined, recentIds: () => ['c'], isFavorite: id => id === 'a', onOpen: vi.fn(), onCreate: vi.fn() });
  expect(titles()).toEqual(['Alpha']); expect(button('Favoris').getAttribute('aria-selected')).toBe('true');
  button('Récents').click(); expect(onCategoryChange).toHaveBeenCalledWith('recent'); expect(titles()).toEqual(['Charlie']);
});

it('refreshes the authorized index without losing the current search', () => {
  let available = pages;
  const library = openPageLibrary({ container: document.body, pages: () => available, access: () => undefined, recentIds: () => [], isFavorite: () => false, onOpen: vi.fn(), onCreate: vi.fn() });
  const input = document.querySelector('input'); if (!input) throw new Error('Missing search');
  input.value = 'bravo'; input.dispatchEvent(new Event('input'));
  available = []; library.refresh();
  expect(titles()).toEqual([]); expect(input.value).toBe('bravo'); expect(input.isConnected).toBe(true);
});

it('uses the native read-only database grid and its property headers and SVG disclosures', () => {
  openPageLibrary({ container: document.body, pages: () => pages, access: () => undefined, recentIds: () => [], isFavorite: () => false, onOpen: vi.fn(), onCreate: vi.fn() });
  const grid = document.querySelector('[data-blok-database-table-grid]');
  expect(grid?.getAttribute('aria-readonly')).toBe('true');
  expect(grid?.querySelectorAll('[role=columnheader]')).toHaveLength(2);
  expect(grid?.textContent).toContain('Nom de la page');
  expect(grid?.textContent).toContain('Dernière modification');
  expect(grid?.querySelector('[data-row-id="a"] [data-blok-database-subitem-toggle] svg')).not.toBeNull();
  expect(grid?.querySelector('[data-row-id="c"] [data-blok-database-subitem-toggle]')?.hasAttribute('data-empty')).toBe(true);
  expect(document.querySelector('[data-blok-database-table-add-row], [contenteditable=true]')).toBeNull();
  expect(button('Récents').querySelector('svg')).not.toBeNull();
});
it('opens the original page through the native grid without changing its metadata', () => {
  const onOpen = vi.fn(); const before = JSON.stringify(pages);
  const library = openPageLibrary({ container: document.body, pages: () => pages, access: () => undefined, recentIds: () => [], isFavorite: () => false, onOpen, onCreate: vi.fn() });
  document.querySelector<HTMLButtonElement>('[data-row-id="a"] [data-blok-database-table-open]')?.click();
  expect(onOpen).toHaveBeenCalledWith('a'); expect(JSON.stringify(pages)).toBe(before);
  library(); expect(document.querySelector('[data-blok-database-table-grid]')).toBeNull();
});
it('does not read leaf documents or show speculative child arrows', () => {
  const loadChildren = vi.fn(async () => []);
  openPageLibrary({ container: document.body, pages: () => [pages[2]], access: () => undefined, recentIds: () => [], isFavorite: () => false, onOpen: vi.fn(), onCreate: vi.fn(), loadChildren });
  expect(document.querySelector('[data-blok-database-subitem-toggle]:not([data-empty])')).toBeNull();
  expect(loadChildren).not.toHaveBeenCalled();
});

it('keeps search collapsed until requested and clears it with Escape',()=>{
  openPageLibrary({container:document.body,pages:()=>pages,access:()=>undefined,recentIds:()=>[],isFavorite:()=>false,onOpen:vi.fn(),onCreate:vi.fn()});
  const search=document.querySelector<HTMLInputElement>('input[type=search]');if(!search)throw new Error('Missing search');
  expect(search.closest('[data-library-search]')?.hasAttribute('hidden')).toBe(true);
  button('Rechercher dans la bibliothèque').click();expect(document.activeElement).toBe(search);
  search.value='brav';search.dispatchEvent(new Event('input'));expect(titles()).toEqual(['Bravo']);
  search.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  expect(search.value).toBe('');expect(titles()).toEqual(['Alpha','Charlie']);
  expect(button('Rechercher dans la bibliothèque').getAttribute('aria-expanded')).toBe('false');
});
it('shows missing dates honestly and lets display settings hide the date column',()=>{
  openPageLibrary({container:document.body,pages:()=>pages,access:()=>undefined,recentIds:()=>[],isFavorite:()=>false,onOpen:vi.fn(),onCreate:vi.fn()});
  expect(document.querySelector('[data-property-id=updated] [data-blok-database-cell]')?.textContent).toBe('—');
  expect(document.querySelector('[data-blok-database-table-grid]')?.getAttribute('data-vertical-lines')).not.toBe('true');
  button('Options d’affichage').click();document.querySelector<HTMLElement>('[data-blok-item-name=titles]')?.click();
  expect(document.querySelectorAll('[role=columnheader]')).toHaveLength(1);
  expect(titles()).toEqual(['Alpha','Charlie']);
});

it('shows short dates with a precise accessible timestamp and updates them on refresh', () => {
  const now = new Date('2026-11-16T10:00:00Z').getTime();
  vi.spyOn(Date, 'now').mockReturnValue(now);
  let updatedAt = new Date(now - 5 * 60_000).toISOString();
  const library = openPageLibrary({container:document.body,pages:()=>[{...pages[2],updatedAt}],access:()=>undefined,recentIds:()=>[],isFavorite:()=>false,onOpen:vi.fn(),onCreate:vi.fn()});
  const timestamp = () => document.querySelector('time');
  expect(timestamp()?.textContent).toBe('Il y a 5 min');
  expect(timestamp()?.dateTime).toBe(updatedAt);
  expect(timestamp()?.getAttribute('aria-label')).toContain('2026');
  updatedAt = new Date(now).toISOString();library.refresh();
  expect(timestamp()?.textContent).toBe('À l’instant');
});

it('lists device-local pages as private without assuming unreported remote permissions are private', () => {
  const options = {container:document.body,category:'private' as const,pages:()=>pages,access:()=>undefined,recentIds:()=>[],isFavorite:()=>false,onOpen:vi.fn(),onCreate:vi.fn()};
  const local = openPageLibrary({...options,local:true});
  expect(titles()).toEqual(['Alpha','Charlie']);
  button('Partagé').click();expect(titles()).toEqual([]);
  local();
  openPageLibrary({...options,local:false});expect(titles()).toEqual([]);
});
