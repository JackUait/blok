import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { destroy, HINT_DELAY } from '../../../src/components/utils/tooltip';
import { createPageFrame } from '../../../src/shell/sidebar';
import type { ShellPage, SidebarAction } from '../../../src/shell/sidebar';

/**
 * The host page row: emoji at rest, a disclosure chevron on hover, and the
 * Notion page menu. These assert what a person sees and what the host hears.
 */

const tree = (): ShellPage[] => [
  { id: 'home', title: 'Home', icon: '🏠', parentId: null },
  { id: 'notes', title: 'Notes', icon: '📝', parentId: 'home' },
  { id: 'draft', title: 'Draft', icon: '✏️', parentId: 'notes' },
];

interface Harness {
  pages: ShellPage[];
  actions: SidebarAction[];
  opened: string[];
  created: Array<string | null>;
}

const mount = (): Harness => {
  const pages = tree();
  const actions: SidebarAction[] = [];
  const opened: string[] = [];
  const created: Array<string | null> = [];
  const frame = createPageFrame({
    pages,
    activeId: 'home',
    onOpen(id) {
      opened.push(id);
    },
    onCreate(parentId) {
      created.push(parentId);
    },
    onAction(action) {
      actions.push(action);
    },
  });

  document.body.append(frame.element);

  return { pages, actions, opened, created };
};

const row = (title: string): HTMLElement => {
  const link = [...document.querySelectorAll('[data-blok-sidebar-link]')].find((node) => node.textContent?.includes(title) && !node.closest('[data-blok-sidebar-recents], [data-blok-sidebar-favorites]'));
  const found = link?.closest('[data-blok-sidebar-row]');

  if (!(found instanceof HTMLElement)) {
    throw new Error(`missing row ${title}`);
  }

  return found;
};

const menuOf = (title: string): HTMLElement => {
  const menu = row(title).querySelector('[data-blok-sidebar-menu]');

  if (!(menu instanceof HTMLElement)) {
    throw new Error(`missing menu ${title}`);
  }

  return menu;
};

const item = (title: string, label: string): HTMLButtonElement => {
  const found = [...menuOf(title).querySelectorAll('button')].find((button) => button.textContent?.includes(label));

  if (!(found instanceof HTMLButtonElement)) {
    throw new Error(`missing menu item ${label}`);
  }

  return found;
};

const click = (node: Element | null): void => {
  if (!(node instanceof HTMLElement)) {
    throw new Error('missing control');
  }

  node.click();
};

const tooltipText = (): string | null => document.querySelector('[data-blok-testid="tooltip-content"]')?.textContent ?? null;

const tooltipShown = (): boolean => document.querySelector('[data-blok-interface="tooltip"]')?.getAttribute('aria-hidden') === 'false';

const hover = (node: Element): void => {
  node.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse', bubbles: true }));
  node.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('page sidebar row', () => {
  it('shows a document icon and no disclosure button for a leaf page', () => {
    const frame = createPageFrame({
      pages: [{ id: 'leaf', title: 'Leaf', parentId: null }],
      activeId: 'leaf',
      onOpen: () => undefined,
      onCreate: () => undefined,
    });
    document.body.append(frame.element);

    expect(row('Leaf').querySelector('[data-blok-sidebar-toggle]')).toBeNull();
    expect(row('Leaf').querySelector('[data-blok-sidebar-leaf] svg')).not.toBeNull();
  });

  it('keeps a closed page menu out of the row until it is opened', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../src/shell/sidebar.css'), 'utf8');

    expect(css).toMatch(/\[data-blok-sidebar-menu\]:not\(:popover-open\)\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/\[data-blok-sidebar-menu\]:popover-open\s*\{[^}]*display:\s*flex/);
  });

  it('indents each level by 8px', () => {
    mount();

    expect(row('Home').style.paddingInlineStart).toBe('8px');
    expect(row('Notes').style.paddingInlineStart).toBe('16px');
    expect(row('Draft').style.paddingInlineStart).toBe('24px');
  });

  it('shows the page emoji at rest and toggles children without opening the page', () => {
    const harness = mount();
    const home = row('Home');

    expect(home.querySelector('[data-blok-sidebar-glyph]')?.textContent).toBe('🏠');
    expect(home.querySelector('[data-blok-sidebar-chevron]')?.hasAttribute('data-open')).toBe(true);

    click(home.querySelector('[data-blok-sidebar-toggle]'));

    expect(harness.opened).toEqual([]);
    expect(document.body.textContent).not.toContain('Notes');
    expect(row('Home').querySelector('[data-blok-sidebar-chevron]')?.hasAttribute('data-open')).toBe(false);

    click(row('Home').querySelector('[data-blok-sidebar-toggle]'));

    expect(harness.opened).toEqual([]);
    expect(row('Notes').querySelector('[data-blok-sidebar-glyph]')?.textContent).toBe('📝');
    expect(row('Draft').style.paddingInlineStart).toBe('24px');
    expect(row('Home').querySelector('[data-blok-sidebar-chevron]')?.hasAttribute('data-open')).toBe(true);
  });

  it('opens the page from the title and adds a child from the plus', () => {
    const harness = mount();

    click(row('Notes').querySelector('[data-blok-sidebar-link]'));
    click(row('Home').querySelector('[data-blok-sidebar-add]'));

    expect(harness.opened).toEqual(['notes']);
    expect(harness.created).toEqual(['home']);
    expect(row('Home').querySelector('[data-blok-sidebar-add]')?.getAttribute('aria-label')).toBe('Ajouter une sous-page');
    expect(row('Home').querySelector('[data-blok-sidebar-more]')?.getAttribute('aria-label')).toBe('Actions de la page');
  });

  it('lists the Notion page menu, with separators, and a muted last-edited line', () => {
    mount();
    const script = [...menuOf('Home').querySelectorAll('[data-blok-sidebar-menu-label], [data-blok-sidebar-menu-separator], [data-blok-sidebar-menu-meta]')].map((child) => {
      if (child.hasAttribute('data-blok-sidebar-menu-separator')) return 'separator';
      if (child.hasAttribute('data-blok-sidebar-menu-meta')) return `meta:${child.textContent}`;

      return `item:${child.textContent}`;
    });

    expect(script).toEqual([
      'item:Ajouter aux favoris',
      'item:Disponible hors connexion',
      'separator',
      'item:Copier le lien',
      'item:Dupliquer',
      'item:Renommer',
      'item:Déplacer vers',
      'item:Mettre à la corbeille',
      'separator',
      'item:Transformer en wiki',
      'separator',
      'item:Ouvrir dans un nouvel onglet',
      'item:Ouvrir dans une nouvelle fenêtre',
      'item:Ouvrir en aperçu latéral',
    ]);

    const meta = menuOf('Home').querySelector('[data-blok-sidebar-menu-meta]');

    expect(meta).toBeNull();
    expect(item('Home', 'Disponible hors connexion').getAttribute('role')).toBe('menuitemcheckbox');
    expect(item('Home', 'Disponible hors connexion').querySelector('[data-blok-sidebar-switch]')).not.toBeNull();
    expect(item('Home', 'Mettre à la corbeille').hasAttribute('data-danger')).toBe(true);
  });

  it('keeps rename, duplicate, and move to trash wired', () => {
    const harness = mount();

    click(item('Home', 'Dupliquer'));
    expect(harness.actions).toEqual([{ id: 'home', type: 'duplicate' }]);
    expect(harness.opened).toEqual([]);

    click(item('Notes', 'Mettre à la corbeille'));
    expect(harness.actions.at(-1)).toEqual({ id: 'notes', type: 'delete' });

    click(item('Draft', 'Renommer'));
    const input = document.querySelector('[data-blok-sidebar-rename]');

    if (!(input instanceof HTMLInputElement)) {
      throw new Error('rename input');
    }

    input.value = 'Renommerd';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(harness.actions).toEqual([
      { id: 'home', type: 'duplicate' },
      { id: 'notes', type: 'delete' },
      { id: 'draft', type: 'rename', title: 'Renommerd' },
    ]);
  });

  it('cancels rename on Escape and still does not open the page', () => {
    const harness = mount();

    click(item('Home', 'Renommer'));
    const input = document.querySelector('[data-blok-sidebar-rename]');

    if (!(input instanceof HTMLInputElement)) {
      throw new Error('rename input');
    }

    input.value = 'Nope';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(harness.actions).toEqual([]);
    expect(harness.opened).toEqual([]);
    expect(row('Home').textContent).toContain('Home');
  });

  it('copies /?page=<id> when the clipboard exists, and does nothing when it does not', () => {
    const harness = mount();
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    click(item('Home', 'Copier le lien'));

    expect(writeText).toHaveBeenCalledWith(new URL('/?page=home', location.origin).href);
    expect(harness.actions).toEqual([]);
    expect(harness.opened).toEqual([]);

    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    expect(() => click(item('Notes', 'Copier le lien'))).not.toThrow();
    expect(harness.actions).toEqual([]);
  });

  it('toggles favorites through the menu without adding stars beside page titles', () => {
    const harness = mount();
    const favorite = item('Home', 'Ajouter aux favoris');

    expect(harness.pages[0]?.favorite).not.toBe(true);
    expect(favorite.getAttribute('aria-checked')).toBe('false');
    expect(favorite.hasAttribute('data-filled')).toBe(false);
    expect(favorite.querySelector('[data-blok-sidebar-menu-icon] path')?.getAttribute('fill')).toBe('none');
    expect(row('Home').querySelector('[data-blok-sidebar-favorite]')).toBeNull();

    click(favorite);

    expect(harness.pages[0]?.favorite).toBe(true);
    expect(harness.actions).toEqual([]);
    expect(harness.opened).toEqual([]);
    const filled = item('Home', 'Retirer des favoris');

    expect(filled.getAttribute('aria-checked')).toBe('true');
    expect(filled.hasAttribute('data-filled')).toBe(true);
    expect(filled.querySelector('[data-blok-sidebar-menu-icon] path')?.getAttribute('fill')).toBe('currentColor');
    expect(row('Home').querySelector('[data-blok-sidebar-favorite]')).toBeNull();

    click(filled);

    expect(harness.pages[0]?.favorite).toBe(false);
    expect(row('Home').querySelector('[data-blok-sidebar-favorite]')).toBeNull();
    expect(item('Home', 'Ajouter aux favoris').hasAttribute('data-filled')).toBe(false);
  });

  it('reports the unwired rows as distinct actions and does not open the page', () => {
    const harness = mount();
    const cases: Array<[string, SidebarAction]> = [
      ['Déplacer vers', { id: 'home', type: 'move' }],
      ['Transformer en wiki', { id: 'home', type: 'wiki' }],
      ['Ouvrir dans un nouvel onglet', { id: 'home', type: 'open-tab' }],
      ['Ouvrir dans une nouvelle fenêtre', { id: 'home', type: 'open-window' }],
      ['Ouvrir en aperçu latéral', { id: 'home', type: 'open-peek' }],
    ];

    cases.forEach(([label]) => click(item('Home', label)));

    expect(harness.actions).toEqual(cases.map(([, action]) => action));
    expect(harness.opened).toEqual([]);
    expect(row('Home').textContent).toContain('Home');
  });

  it('toggles Disponible hors connexion and tells the host, without opening the page', () => {
    const harness = mount();
    const offline = item('Home', 'Disponible hors connexion');

    expect(offline.getAttribute('aria-checked')).toBe('false');

    click(offline);
    expect(offline.getAttribute('aria-checked')).toBe('true');
    expect(harness.actions).toEqual([{ id: 'home', type: 'offline', on: true }]);

    click(offline);
    expect(offline.getAttribute('aria-checked')).toBe('false');
    expect(harness.actions).toEqual([
      { id: 'home', type: 'offline', on: true },
      { id: 'home', type: 'offline', on: false },
    ]);
    expect(harness.opened).toEqual([]);
  });

  it('shows the plus and more hints on hover, after the hint delay, and not on focus', () => {
    vi.useFakeTimers();
    mount();
    const add = row('Home').querySelector('[data-blok-sidebar-add]');
    const more = row('Notes').querySelector('[data-blok-sidebar-more]');

    if (!(add instanceof HTMLElement) || !(more instanceof HTMLElement)) {
      throw new Error('missing hover controls');
    }

    add.focus();
    add.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    vi.advanceTimersByTime(HINT_DELAY);
    expect(tooltipShown()).toBe(false);

    hover(add);
    vi.advanceTimersByTime(HINT_DELAY - 1);
    expect(tooltipShown()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(tooltipShown()).toBe(true);
    expect(tooltipText()).toBe('Ajouter une sous-page');

    hover(more);
    vi.advanceTimersByTime(HINT_DELAY);
    expect(tooltipText()).toBe('Actions de la page');
  });
});
