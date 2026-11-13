import { describe, expect, it, beforeEach } from 'vitest';
import { createPageFrame } from '../../../src/shell/sidebar';
import type { ShellPage } from '../../../src/shell/sidebar';

const page = (id: string, over: Partial<ShellPage> = {}): ShellPage => ({ id, title: id, parentId: null, ...over });

function mount(pages: ShellPage[], activeId = '') {
  const frame = createPageFrame({ pages, activeId, onOpen: () => {}, onCreate: () => {} });
  document.body.append(frame.element);
  return frame;
}

const headings = (): string[] =>
  [...document.querySelectorAll('[data-blok-sidebar-section-label]')].map((node) => node.textContent ?? '');

beforeEach(() => document.body.replaceChildren());

describe('sidebar sections', () => {
  // Chez Notion, Favoris n'apparaît qu'une fois la première page mise en favori.
  it('shows Favorites only once something is favorited', () => {
    mount([page('a'), page('b')]);
    expect(headings()).not.toContain('Favoris');
    document.body.replaceChildren();
    mount([page('a', { favorite: true }), page('b')]);
    expect(headings()).toContain('Favoris');
  });

  // Une page en favori reste à sa place dans l'arbre : Favoris est un raccourci,
  // pas un déplacement.
  it('keeps a favorited page in its own section too', () => {
    mount([page('a', { favorite: true, section: 'Équipe' })]);
    expect(headings()).toEqual(['Favoris', 'Équipe']);
    expect(document.querySelectorAll('[data-blok-sidebar-row]')).toHaveLength(2);
  });

  // Recents se remplit en ouvrant des pages, la plus récente en tête.
  it('builds Recents from what was opened, most recent first', () => {
    const frame = mount([page('a'), page('b'), page('c')]);
    frame.setPages([page('a'), page('b'), page('c')], 'b');
    frame.setPages([page('a'), page('b'), page('c')], 'c');
    expect(headings()).toContain('Récents');
    const recents = document.querySelector('[data-blok-sidebar-recents]');
    expect([...(recents?.querySelectorAll('[data-blok-sidebar-row] [data-blok-sidebar-label]') ?? [])].map((node) => node.textContent))
      .toEqual(['c', 'b']);
  });

  // Notion replie une section d'un clic sur son titre.
  it('collapses a section when its heading is clicked', () => {
    mount([page('a', { section: 'Équipe' }), page('b', { section: 'Privé' })]);
    const heading = document.querySelector<HTMLButtonElement>('[data-blok-sidebar-section-label]');
    expect(document.querySelectorAll('[data-blok-sidebar-row]')).toHaveLength(2);
    heading?.click();
    expect(document.querySelectorAll('[data-blok-sidebar-row]')).toHaveLength(1);
    // Le repeint recrée le titre : on relit le DOM plutôt que la référence.
    const after = document.querySelector<HTMLButtonElement>('[data-blok-sidebar-section-label]');
    expect(after?.getAttribute('aria-expanded')).toBe('false');
    after?.click();
    expect(document.querySelectorAll('[data-blok-sidebar-row]')).toHaveLength(2);
  });

  it('drops a section that has nothing in it', () => {
    mount([page('a', { section: 'Équipe' })]);
    expect(headings()).toEqual(['Équipe']);
  });

  // La recherche traverse les sections : on cherche une page, pas une section.
  it('searches across every section at once', () => {
    mount([page('alpha', { section: 'Équipe' }), page('beta', { section: 'Privé' })]);
    const input = document.querySelector<HTMLInputElement>('[data-blok-sidebar-search] input');
    input!.value = 'bet';
    input!.dispatchEvent(new Event('input'));
    expect(document.querySelectorAll('[data-blok-sidebar-row]')).toHaveLength(1);
    expect(headings()).toEqual(['Privé']);
  });
});

describe('teamspace row', () => {
  // Chez Notion, l'espace n'est pas un titre : c'est une ligne avec son icône,
  // sous un en-tête « Espaces », et les pages sont indentées dessous.
  it('puts the workspace on a row of its own under Espaces', () => {
    const frame = createPageFrame({
      pages: [page('a', { section: 'workspace' })],
      activeId: '', onOpen: () => {}, onCreate: () => {},
      teamspace: { name: 'Tousambassadeurs' },
    });
    document.body.append(frame.element);
    expect(headings()).toContain('Espaces');
    expect(document.querySelector('[data-blok-sidebar-teamspace]')?.textContent).toContain('Tousambassadeurs');
    expect(document.querySelectorAll('[data-blok-sidebar-row]')).toHaveLength(1);
  });

  it('collapses the workspace row, hiding its pages but not the other sections', () => {
    const frame = createPageFrame({
      pages: [page('a', { section: 'workspace' }), page('b', { section: 'Privé' })],
      activeId: '', onOpen: () => {}, onCreate: () => {},
      teamspace: { name: 'Tousambassadeurs' },
    });
    document.body.append(frame.element);
    expect(document.querySelectorAll('[data-blok-sidebar-row]')).toHaveLength(2);
    document.querySelector<HTMLButtonElement>('[data-blok-sidebar-teamspace] button')?.click();
    expect(document.querySelectorAll('[data-blok-sidebar-row]')).toHaveLength(1);
  });

  it('stays a plain heading when there is no workspace to name', () => {
    mount([page('a', { section: 'Privé' })]);
    expect(headings()).toEqual(['Privé']);
    expect(document.querySelector('[data-blok-sidebar-teamspace]')).toBeNull();
  });
});

describe('sidebar shortcuts', () => {
  // Notion met « New page » sur une ligne de la barre, pas seulement derrière
  // un + dans l'en-tête.
  it('offers New page as a row, not only as a header button', () => {
    mount([page('a')]);
    const shortcut = document.querySelector<HTMLButtonElement>('[data-blok-sidebar-shortcut]');
    expect(shortcut?.textContent).toContain('Nouvelle page');
  });

  it('creates at the root from that shortcut', () => {
    const created: (string | null)[] = [];
    const frame = createPageFrame({ pages: [page('a')], activeId: '', onOpen: () => {}, onCreate: (parent) => created.push(parent) });
    document.body.append(frame.element);
    document.querySelector<HTMLButtonElement>('[data-blok-sidebar-shortcut]')?.click();
    expect(created).toEqual([null]);
  });
});
