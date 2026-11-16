// Keep the native database renderer behind the desktop's narrow type boundary.
import { DatabaseTableView, createTableState } from '../../src/tools/database/database-table-view';
import { databaseEnglish } from '../../src/tools/database/database-english';
import french from '../../src/components/i18n/locales/fr.json';
import { FileText, createElement } from 'lucide';
import { IconPlayerPlay } from '../../src/components/icons';
import '../../src/styles/lazy/database.css';

const message = key => french[key] ?? databaseEnglish(key) ?? key;
const i18n = {
  t: (key, vars) => message(key).replace(/\{(\w+)\}/g, (match, name) => vars?.[name] === undefined ? match : String(vars[name])),
  has: key => message(key) !== key,
  getEnglishTranslation: key => databaseEnglish(key) ?? '',
  getLocale: () => 'fr',
};
const schema = [
  { id: 'title', name: 'Nom de la page', type: 'title', position: 'a' },
  { id: 'updated', name: 'Dernière modification', type: 'lastEditedTime', position: 'b' },
];

function dateLabel(timestamp) {
  const age = Date.now() - timestamp;
  if (age >= 0 && age < 60_000) return 'À l’instant';
  if (age >= 60_000 && age < 86_400_000) {
    const hours = age >= 3_600_000;
    return `Il y a ${Math.floor(age / (hours ? 3_600_000 : 60_000))} ${hours ? 'h' : 'min'}`;
  }
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short',
    ...(date.getFullYear() !== new Date().getFullYear() ? {year:'numeric'} : {}) }).format(date);
}

// Only the library's presentation changes; native row identity, metadata and keyboard handling stay intact.
function decorateTable(container, entries) {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  for (const placeholder of container.querySelectorAll('[data-blok-database-page-icon-placeholder], [data-property-id="title"] [data-blok-database-table-column-icon]')) {
    placeholder.replaceChildren(createElement(FileText, {'aria-hidden':'true', focusable:'false', 'stroke-width':'1.8'}));
  }
  for (const toggle of container.querySelectorAll('[data-blok-database-subitem-toggle]')) {
    if (toggle.hasAttribute('data-empty')) { toggle.disabled = true; toggle.setAttribute('aria-hidden','true'); }
    else toggle.innerHTML = IconPlayerPlay;
  }
  for (const row of container.querySelectorAll('[data-row-id]')) {
    const value = row.querySelector('[data-property-id="updated"] [data-blok-database-cell]');
    if (!value) continue;
    const timestamp = Date.parse(byId.get(row.getAttribute('data-row-id'))?.updatedAt ?? '');
    if (!Number.isFinite(timestamp)) { value.textContent = '—'; value.setAttribute('aria-label','Date inconnue'); continue; }
    const time = document.createElement('time');
    time.dateTime = new Date(timestamp).toISOString();
    time.textContent = dateLabel(timestamp);
    time.setAttribute('aria-label', new Intl.DateTimeFormat('fr-FR', {dateStyle:'long', timeStyle:'short'}).format(timestamp));
    value.replaceChildren(time);
  }
}

/** This is the same read-only renderer used by database blocks, without a block store or write handlers. */
export function createLibraryTable(container, options) {
  const state = createTableState();
  let renderer = null;
  return {
    update(entries, {showUpdated = true} = {}) {
      renderer?.destroy();
      renderer = null;
      if (entries.length === 0) { container.replaceChildren(); return; }
      const byId = new Map(entries.map(entry => [entry.id, entry]));
      // This derived index is already paged by its workspace host. No inert native Load more action.
      state.loaded.set('', entries.length);
      renderer = new DatabaseTableView({
        readOnly: true, i18n, locale: 'fr', schema, titlePropertyId: 'title', state,
        view: {
          id: 'library', name: 'Bibliothèque', type: 'table', position: 'a',
          sorts: [], filters: [], visibleProperties: showUpdated ? ['title', 'updated'] : ['title'], showPageIcon: true,
          showVerticalLines: false, openPagesIn: 'full',
          properties: [{ id: 'title', width: Math.max(320, container.clientWidth - (showUpdated ? 240 : 0)) }, { id: 'updated', width: 240, visible: showUpdated }],
        },
        rows: entries.map((entry, position) => ({
          id: entry.id, pageId: entry.id, position: String(position), icon: entry.icon,
          properties: { title: entry.title },
          meta: Number.isFinite(Date.parse(entry.updatedAt ?? '')) ? { lastEditedAt: Date.parse(entry.updatedAt) } : {},
        })),
        openRow: options.onOpen,
        nesting: {
          info: id => {
            const entry = byId.get(id);
            return entry
              ? { depth: entry.depth, hasChildren: entry.hasChildren, expanded: entry.expanded } : undefined;
          },
          toggle: id => { if (byId.get(id)?.hasChildren) options.onToggle(id); },
        },
      });
      container.replaceChildren(renderer.createView());
      decorateTable(container, entries);
    },
    destroy() { renderer?.destroy(); renderer = null; container.replaceChildren(); },
  };
}
