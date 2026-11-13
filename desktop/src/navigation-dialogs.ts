import { openModalDialog, type ModalDialogHandle } from '@blok/modal-dialog';
import type { ShellPage } from '@blok/sidebar';
import { IconCross, IconFile, IconTable } from '../../src/components/icons';
import { renderPageIcon } from '../../src/shell/page-icon';
import { createChoice, wrapSearchField } from './ui/controls';
import './navigation-dialogs.css';

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, attribute: string, text?: string): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  element.setAttribute(attribute, '');
  if (text !== undefined) element.textContent = text;
  return element;
};
function icon(value?: string, database = false): HTMLElement {
  const element = node('span', 'data-navigation-icon');
  element.setAttribute('aria-hidden', 'true');
  if (value) renderPageIcon(element, value);
  else element.innerHTML = database ? IconTable : IconFile;
  return element;
}

function dialog(label: string): { surface: HTMLElement; open: (focus: HTMLElement, cleanup?: () => void) => void; close: () => void } {
  const overlay = node('div', 'data-desktop-settings-overlay');
  const surface = node('div', 'data-navigation-dialog');
  const closeButton = node('button', 'data-navigation-close');
  closeButton.type = 'button'; closeButton.setAttribute('aria-label', 'Fermer'); closeButton.innerHTML = IconCross;
  surface.tabIndex = -1;
  surface.append(closeButton); overlay.append(surface);
  let handle: ModalDialogHandle | null = null;
  const close = (): void => handle?.close();
  closeButton.addEventListener('click', close);
  return { surface, close, open(focus, cleanup) {
    handle = openModalDialog({ content: overlay, surface, label, initialFocus: () => focus, onDismiss: close, onClose: cleanup });
  } };
}

/** Metadata search only: its input is the current server-filtered workspace index. */
export function openPageSearch(options: {
  workspaceName: string;
  pages: () => ShellPage[];
  onOpen: (id: string) => void;
  recentIds?: string[];
}): () => void {
  const modal = dialog(options.recentIds ? 'Pages récentes' : 'Rechercher une page');
  modal.surface.setAttribute('data-navigation-search', '');
  const input = document.createElement('input');
  input.type = 'search'; input.placeholder = 'Rechercher une page…'; input.setAttribute('aria-label', 'Rechercher une page par son titre');
  const header = node('div', 'data-navigation-search-header'); header.append(wrapSearchField(input));
  const heading = node('p', 'data-navigation-caption', options.recentIds ? 'Pages récentes' : `Pages de ${options.workspaceName}`);
  const results = node('div', 'data-navigation-results');
  const empty = node('p', 'data-navigation-empty'); empty.setAttribute('role', 'status');
  const footer = node('div', 'data-navigation-help', 'Recherche par titre · ↑ ↓ parcourir · Entrée ouvrir · Échap fermer');
  modal.surface.append(header, heading, results, empty, footer);
  let selected = 0;
  let matches: ShellPage[] = [];
  const choose = (page: ShellPage): void => {
    // An index refresh can revoke access while the dialog is open.
    if (!options.pages().some((item) => item.id === page.id)) { render(); return; }
    modal.close(); options.onOpen(page.id);
  };
  function highlight(): void {
    [...results.querySelectorAll<HTMLButtonElement>('button')].forEach((button, i) => {
      button.toggleAttribute('data-selected', selected === i);
      button.tabIndex = selected === i ? 0 : -1;
    });
    results.querySelector('[data-selected]')?.scrollIntoView?.({ block: 'nearest' });
  }
  function render(): void {
    const pages = options.pages();
    const byId = new Map(pages.map((page) => [page.id, page]));
    const query = input.value.trim().toLocaleLowerCase();
    const source = options.recentIds && !query
      ? options.recentIds.map((id) => byId.get(id)).filter((page): page is ShellPage => !!page) : pages;
    matches = source.filter((page) => page.title.toLocaleLowerCase().includes(query));
    selected = 0; results.replaceChildren();
    for (const page of matches) {
      const row = node('button', 'data-navigation-result'); row.type = 'button';
      const labels = node('span', 'data-navigation-result-labels');
      labels.append(node('span', 'data-navigation-result-title', page.title || 'Nouvelle page'));
      const path: string[] = []; const seen = new Set([page.id]); let parent = byId.get(page.parentId ?? '');
      while (parent && !seen.has(parent.id)) { seen.add(parent.id); path.unshift(parent.title); parent = byId.get(parent.parentId ?? ''); }
      path.unshift(options.workspaceName);
      labels.append(node('small', 'data-navigation-result-path', path.join(' / ')));
      row.append(icon(page.icon), labels);
      row.addEventListener('click', () => choose(page)); results.append(row);
    }
    empty.hidden = matches.length > 0;
    empty.textContent = query ? `Aucune page pour « ${input.value.trim()} »` : 'Aucune page à afficher.';
    highlight();
  }
  input.addEventListener('input', render);
  modal.surface.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      selected = Math.max(0, Math.min(matches.length - 1, selected + (event.key === 'ArrowDown' ? 1 : -1)));
      highlight();
      if (document.activeElement !== input) results.querySelector<HTMLButtonElement>('[data-selected]')?.focus();
    } else if (event.key === 'Enter' && document.activeElement === input && matches[selected]) {
      event.preventDefault(); choose(matches[selected]);
    }
  });
  render(); modal.open(input);
  return modal.close;
}

export type CreationDestination = { value: string; label: string; parentId: string | null; privatePage?: boolean };
export function openPageCreation(options: {
  destinations: CreationDestination[];
  destination: string;
  onCreate: (destination: CreationDestination, database: boolean) => void;
}): void {
  const modal = dialog('Créer une page');
  modal.surface.setAttribute('data-navigation-create', '');
  modal.surface.append(node('h2', 'data-navigation-heading', 'Créer une page'));
  const destination = createChoice({ label: 'Ajouter dans', value: options.destination, options: options.destinations, searchable: true, onChange() {} });
  const row = node('div', 'data-navigation-destination');
  row.append(node('span', 'data-navigation-caption', 'Ajouter dans'), destination.element);
  modal.surface.append(row);
  for (const [database, title, description] of [
    [false, 'Page vide', 'Écrire, ajouter des images et des blocs.'],
    [true, 'Base de données vide', 'Organiser des pages dans une vue table.'],
  ] as const) {
    const button = node('button', 'data-navigation-create-option'); button.type = 'button';
    const labels = node('span', 'data-navigation-result-labels');
    labels.append(node('strong', 'data-navigation-result-title', title), node('small', 'data-navigation-result-path', description));
    button.append(icon(undefined, database), labels);
    button.addEventListener('click', () => {
      const target = options.destinations.find((item) => item.value === destination.value);
      if (!target) return;
      modal.close(); options.onCreate(target, database);
    });
    modal.surface.append(button);
  }
  modal.open(destination.element, () => destination.destroy());
}
