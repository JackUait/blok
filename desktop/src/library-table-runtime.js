// Keep the native database renderer behind the desktop's narrow type boundary.
import { DatabaseTableView, createTableState } from '../../src/tools/database/database-table-view';
import { databaseEnglish } from '../../src/tools/database/database-english';
import french from '../../src/components/i18n/locales/fr.json';
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

/** This is the same read-only renderer used by database blocks, without a block store or write handlers. */
export function createLibraryTable(container, options) {
  const state = createTableState();
  let renderer = null;
  return {
    update(entries) {
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
          sorts: [], filters: [], visibleProperties: ['updated'], showPageIcon: true,
          showVerticalLines: true, openPagesIn: 'full',
          properties: [{ id: 'title', width: Math.max(420, container.clientWidth - 300) }, { id: 'updated', width: 220 }],
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
            return entry && (entry.depth > 0 || entry.hasChildren)
              ? { depth: entry.depth, hasChildren: entry.hasChildren, expanded: entry.expanded } : undefined;
          },
          toggle: id => { if (byId.get(id)?.hasChildren) options.onToggle(id); },
        },
      });
      container.replaceChildren(renderer.createView());
    },
    destroy() { renderer?.destroy(); renderer = null; container.replaceChildren(); },
  };
}
