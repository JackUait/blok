import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openPageLibrary } from './page-library';
import type { DesktopPage } from './storage';
beforeEach(() => vi.clearAllMocks());
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
const pages: DesktopPage[] = [{ id: 'a', title: 'Alpha', parentId: null }, { id: 'b', title: 'Bravo', parentId: 'a' }, { id: 'c', title: 'Charlie', parentId: null }];
function button(label: string): HTMLButtonElement { const result = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === label); if (!result) throw new Error(`Missing ${label}`); return result; }
const titles = () => [...document.querySelectorAll('[data-library-page-title]')].map(item => item.textContent);
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
  available = []; document.querySelector<HTMLButtonElement>('[data-library-page]')?.click(); expect(onOpen).not.toHaveBeenCalled(); expect(titles()).toEqual([]);
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
  const sort = document.querySelector('select'); if (!sort) throw new Error('Missing sort'); sort.value = 'updated'; sort.dispatchEvent(new Event('change'));
  expect(titles()).toEqual(['Charlie', 'Alpha', 'Bravo']);
  expect(document.querySelectorAll('[data-library-date]')[2].textContent).toBe('—');
});
it('expands real child pages without duplicate rows and searches collapsed descendants', () => {
  openPageLibrary({ container: document.body, pages: () => pages, access: () => undefined, recentIds: () => [], isFavorite: () => false, onOpen: vi.fn(), onCreate: vi.fn() });
  expect(titles()).toEqual(['Alpha', 'Charlie']);
  const expand = document.querySelector<HTMLButtonElement>('[aria-label="Développer Alpha"]'); if (!expand) throw new Error('Missing disclosure');
  expand.click(); expect(titles()).toEqual(['Alpha', 'Bravo', 'Charlie']);
  document.querySelector<HTMLButtonElement>('[aria-label="Réduire Alpha"]')?.click(); expect(titles()).toEqual(['Alpha', 'Charlie']);
  const input = document.querySelector<HTMLInputElement>('input[type="search"]'); if (!input) throw new Error('Missing search');
  input.value = 'bravo'; input.dispatchEvent(new Event('input')); expect(titles()).toEqual(['Bravo']);
});
it('loads actual inline databases only on expansion and opens their owning page/block', async () => {
  const loadChildren = vi.fn(async () => [{ pageId: 'a', blockId: 'db', title: 'Todo List', type: 'database' as const }]); const onOpenBlock = vi.fn();
  openPageLibrary({ container: document.body, pages: () => [pages[0]], access: () => undefined, recentIds: () => [], isFavorite: () => false, onOpen: vi.fn(), onCreate: vi.fn(), loadChildren, onOpenBlock });
  expect(loadChildren).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>('[aria-label="Développer Alpha"]')?.click();
  await vi.waitFor(() => expect(document.querySelector('[data-library-database]')?.textContent).toContain('Todo List'));
  document.querySelector<HTMLButtonElement>('[data-library-database]')?.click(); expect(onOpenBlock).toHaveBeenCalledWith('a', 'db');
});
it('discards an outline response when its page access is revoked', async () => {
  let available = [pages[0]]; const onOpenBlock = vi.fn();
  const loadChildren = vi.fn(async () => { available = []; return [{ pageId: 'a', blockId: 'db', title: 'Secret', type: 'database' as const }]; });
  openPageLibrary({ container: document.body, pages: () => available, access: () => undefined, recentIds: () => [], isFavorite: () => false, onOpen: vi.fn(), onCreate: vi.fn(), loadChildren, onOpenBlock });
  document.querySelector<HTMLButtonElement>('[aria-label="Développer Alpha"]')?.click();
  await vi.waitFor(() => expect(loadChildren).toHaveBeenCalledOnce());
  expect(document.querySelector('[data-library-database]')).toBeNull();
});
it('offers the Notes collection action separately from ordinary page creation', () => {
  const onCreateNote = vi.fn(); const onCreate = vi.fn();
  openPageLibrary({ container: document.body, pages: () => [], access: () => undefined, recentIds: () => [], isFavorite: () => false, onOpen: vi.fn(), onCreate, onCreateNote });
  button('Nouvelle note').click(); expect(onCreateNote).toHaveBeenCalledOnce(); expect(onCreate).not.toHaveBeenCalled();
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

it('presents aligned table columns and icon category tabs', () => {
  openPageLibrary({ container: document.body, pages: () => pages, access: () => undefined, recentIds: () => [], isFavorite: () => false, onOpen: vi.fn(), onCreate: vi.fn() });
  const table = document.querySelector('table');
  expect(table).not.toBeNull();
  expect([...document.querySelectorAll('th')].map(cell => cell.textContent)).toEqual(['Nom de la page', 'Dernière modification']);
  expect(table?.querySelector('tbody tr')?.children).toHaveLength(2);
  expect(button('Récents').querySelector('svg')).not.toBeNull();
  expect(button('Favoris').querySelector('svg')).not.toBeNull();
});
