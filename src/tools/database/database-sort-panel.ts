import { nanoid } from 'nanoid';
import { IconCross, IconPlus, IconTrash } from '../../components/icons';
import type { I18n } from '../../../types';
import { DatabasePanel, panelInput, panelReorderList, panelRow, panelSeparator, panelText } from './database-panel';
import { propertyGlyph } from './database-property-types';
import { sortDirectionLabelKey } from './database-filter-labels';
import { openSortDirectionFlyout, openSortPropertyFlyout, sortChevron } from './database-sort-flyouts';
import { withEntryIds } from './filter-tree';
import { GROUPABLE_TYPES } from './group-keys';
import type { PropertyDefinition, PropertyType, SortConfig } from './types';

/** Notion's sort list adds files and ID to the groupable types (findings V20, shot 19). */
export const SORTABLE_TYPES: readonly PropertyType[] = [...GROUPABLE_TYPES, 'files', 'uniqueId'];

/** notion-motion.md Round 10: the "Add sort" picker box. */
const ADD_SORT_PICKER_WIDTH = 280;
const ADD_SORT_PICKER_HEIGHT = 287;

export interface PropertyPickerOptions {
  anchor: HTMLElement;
  testId: string;
  types: readonly PropertyType[];
  schema: () => PropertyDefinition[];
  /** Names the list for its ink: Notion's filter picker icons are darker. */
  kind?: 'filter';
  /** The type a property was made as; `schema` reads a formula as its result. */
  storedType?: (propertyId: string) => PropertyType | undefined;
  i18n: Pick<I18n, 't'>;
  onPick: (property: PropertyDefinition) => void;
  placeholder: string;
  footer?: (close: () => void) => HTMLElement;
  used?: string[];
  /** Opens over an open panel, which stays: this width and height cap, flush under the anchor. */
  over?: { width: number; maxHeight: number };
  onClose: (escape: boolean) => void;
}

/**
 * Notion's property list: 290 wide, a search on top, the first option
 * highlighted, Name first and then A→Z, each with its type glyph. Not opened yet.
 */
export const propertyPicker = (options: PropertyPickerOptions): DatabasePanel => {
  const state = { query: '', active: 0 };
  const list = document.createElement('div');

  list.setAttribute('data-blok-database-picker-list', options.kind ?? '');
  const matches = (): PropertyDefinition[] => {
    const needle = state.query.trim().toLowerCase();
    const shown = options.schema()
      .filter((p) => options.types.includes(p.type) && options.used?.includes(p.id) !== true)
      .filter((p) => needle === '' || p.name.toLowerCase().includes(needle));

    return [
      ...shown.filter((p) => p.type === 'title'),
      ...shown.filter((p) => p.type !== 'title').sort((a, b) => a.name.localeCompare(b.name)),
    ];
  };
  const pick = (property: PropertyDefinition): void => {
    panel.close();
    options.onPick(property);
  };
  const fill = (): void => {
    const rows = matches().map((property, index) => {
      const row = panelRow({
        label: property.name,
        icon: propertyGlyph(property, options.storedType),
        testId: `database-pick-property-${property.id}`,
        onClick: () => pick(property),
      });

      row.toggleAttribute('data-active', index === state.active);

      return row;
    });

    // notion-motion.md Round 18 §2 (r18-bar-addfilter-allused.raw): an empty list says "No results".
    list.replaceChildren(...(rows.length === 0 ? [panelText(options.i18n.t('find.noResults'))] : rows));
  };
  const panel = new DatabasePanel({
    anchor: options.anchor,
    root: {
      // database.css: the measured picker layout (notion-motion.md Round 10).
      name: 'picker',
      build: () => {
        const search = panelInput({
          value: state.query,
          placeholder: options.placeholder,
          label: options.placeholder,
          testId: `${options.testId}-search`,
          // Only the list redraws, so the field keeps its caret.
          onInput: (value) => {
            state.query = value;
            state.active = 0;
            fill();
          },
        });

        search.addEventListener('keydown', (event) => {
          const shown = matches();

          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (shown.length === 0) return;
            state.active = (state.active + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
            fill();
          } else if (event.key === 'Enter' && !event.isComposing) {
            event.preventDefault();
            const property = shown[state.active];

            if (property !== undefined) pick(property);
          }
        });
        search.setAttribute('data-blok-database-picker-search', '');
        fill();

        return options.footer === undefined ? [search, list] : [search, list, panelSeparator(), options.footer(() => panel.close())];
      },
    },
    testId: options.testId,
    width: options.over?.width ?? 290,
    backLabel: options.i18n.t('tools.database.settingsBack'),
    ...(options.over !== undefined ? { gap: 0 } : {}),
    onClose: options.onClose,
  });

  if (options.over !== undefined) panel.root.style.maxHeight = `${options.over.maxHeight}px`;

  return panel;
};

export interface SortEditorOptions {
  anchor: HTMLElement;
  i18n: Pick<I18n, 't'>;
  schema: () => PropertyDefinition[];
  storedType?: (propertyId: string) => PropertyType | undefined;
  sorts: () => SortConfig[];
  /** The caller redraws the editor after a write. */
  write: (next: SortConfig[]) => void;
  /** Space under the anchor; the popover's usual gap when unset. */
  gap?: number;
  /** The pinned group modal's editor (r27-pm-sortpop.raw): no drag handle, no ×, at least 290 wide. */
  compact?: boolean;
  onClose: (escape: boolean) => void;
}

/**
 * Notion's sort panel (findings V19): no title, sized to its words. Each rule
 * has a drag handle, a property button and a direction button that open
 * lists, and a ×. Then "+ Add sort" and "Delete sort". Not opened yet.
 */
export const sortEditor = (options: SortEditorOptions): DatabasePanel => {
  const t = (key: string): string => options.i18n.t(`tools.database.${key}`);
  const sorts = (): Array<SortConfig & { id: string }> => withEntryIds(options.sorts());
  const { write } = options;
  const state: { addPicker: DatabasePanel | null } = { addPicker: null };

  /**
   * notion-motion.md Rounds 10-11: "Add sort" opens a 280x287 picker of its
   * own, flush under the row and left-aligned to it, with its search focused.
   * The sort panel stays open under it; a property already sorted is left out.
   */
  const openAddPicker = (sortPanel: DatabasePanel): void => {
    const row = sortPanel.root.querySelector<HTMLElement>('[data-blok-testid="database-sort-add"]');

    if (row === null) return;
    const release = sortPanel.hold();
    // "Add sort" goes once every property is sorted; "Delete sort" takes its place.
    const focusAdd = (): void => (sortPanel.root.querySelector<HTMLElement>('[data-blok-testid="database-sort-add"]')
      ?? sortPanel.root.querySelector<HTMLElement>('[data-blok-testid="database-sort-delete-all"]'))?.focus();

    state.addPicker = propertyPicker({
      anchor: row,
      testId: 'database-sort-add-picker',
      types: SORTABLE_TYPES,
      schema: options.schema,
      i18n: options.i18n,
      onPick: (property) => {
        write([...sorts(), { id: nanoid(), propertyId: property.id, direction: 'asc' }]);
        focusAdd();
      },
      placeholder: t('settingsSearchProperty'),
      used: sorts().map((sort) => sort.propertyId),
      over: { width: ADD_SORT_PICKER_WIDTH, maxHeight: ADD_SORT_PICKER_HEIGHT },
      // An outside press keeps the focus it made.
      onClose: (escape) => {
        state.addPicker = null;
        release();
        if (escape) focusAdd();
      },
    });
    state.addPicker.open();
  };

  const panel = new DatabasePanel({
    anchor: options.anchor,
    root: {
      // database.css: the measured rule spacing (r35:497-509).
      name: 'sort',
      build: (current) => {
        const schema = options.schema();
        const all = sorts();
        const items = all.flatMap((sort) => {
          const property = schema.find((p) => p.id === sort.propertyId);

          if (property === undefined) return [];
          const line = document.createElement('div');
          const removeButton = (): HTMLElement => {
            const remove = panelRow({
              label: t('sortRemove'),
              testId: `database-sort-remove-${sort.id}`,
              icon: IconCross,
              onClick: () => write(all.filter((s) => s.id !== sort.id)),
            });

            remove.querySelector('[data-blok-database-panel-label]')?.remove();
            remove.setAttribute('aria-label', t('sortRemove'));
            remove.setAttribute('data-blok-database-sort-remove', '');

            return remove;
          };

          line.setAttribute('data-blok-database-sort-row', '');
          line.setAttribute('data-blok-testid', `database-sort-row-${sort.id}`);
          const propertyButton: HTMLElement = sortChevron(panelRow({
            label: property.name,
            testId: `database-sort-property-${sort.id}`,
            icon: propertyGlyph(property, options.storedType),
            onClick: () => openSortPropertyFlyout(
              propertyButton,
              current,
              schema.filter((p) => SORTABLE_TYPES.includes(p.type)),
              (picked) => write(sorts().map((s) => (s.id === sort.id ? { ...s, propertyId: picked.id } : s))),
              options.storedType
            ),
          }));
          const directionButton: HTMLElement = sortChevron(panelRow({
            label: options.i18n.t(sortDirectionLabelKey(property.type, sort.direction)),
            testId: `database-sort-direction-${sort.id}`,
            onClick: () => openSortDirectionFlyout(
              directionButton,
              current,
              (key) => options.i18n.t(key),
              property,
              sort.direction,
              (direction) => write(sorts().map((s) => (s.id === sort.id ? { ...s, direction } : s)))
            ),
          }));

          line.append(propertyButton, directionButton, ...(options.compact === true ? [] : [removeButton()]));

          return [{ id: sort.id, element: line }];
        });

        const list = options.compact === true ? document.createElement('div') : panelReorderList({
            testId: 'database-sorts-list',
            handleLabel: t('settingsDragToReorder'),
            items,
            onMove: (id, beforeId) => {
              const moving = all.find((s) => s.id === id);
              const rest = all.filter((s) => s.id !== id);
              const at = beforeId === null ? rest.length : rest.findIndex((s) => s.id === beforeId);

              if (moving !== undefined) write([...rest.slice(0, at), moving, ...rest.slice(at)]);
            },
          });

        if (options.compact === true) {
          list.setAttribute('data-blok-database-panel-list', '');
          list.setAttribute('data-blok-testid', 'database-sorts-list');
          list.append(...items.map((item) => item.element));
        }

        return [
          list,
          // notion-motion.md Round 17 §5: gone once every property is sorted.
          ...(schema.some((p) => SORTABLE_TYPES.includes(p.type) && !all.some((s) => s.propertyId === p.id)) ? [panelRow({
            label: t('sortAdd'),
            testId: 'database-sort-add',
            muted: true,
            icon: IconPlus,
            onClick: () => openAddPicker(current),
          })] : []),
          panelRow({
            label: t('sortDeleteAll'),
            testId: 'database-sort-delete-all',
            muted: true,
            icon: IconTrash,
            onClick: () => {
              write([]);
              current.close();
            },
          }),
        ];
      },
    },
    testId: 'database-sort-panel',
    width: 290,
    backLabel: t('settingsBack'),
    ...(options.gap !== undefined ? { gap: options.gap } : {}),
    onClose: (escape) => {
      state.addPicker?.close();
      options.onClose(escape);
    },
  });

  // Notion's panel sizes to its words, so no label is cut.
  panel.root.style.width = 'max-content';
  if (options.compact === true) {
    panel.root.setAttribute('data-blok-database-sort-compact', '');
    // r27-pm-sortpop.raw: 290 wide, with room to spare after the direction button.
    panel.root.style.minWidth = '290px';
  }

  return panel;
};
