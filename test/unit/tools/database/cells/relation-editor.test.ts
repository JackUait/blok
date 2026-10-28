import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { openCellEditor } from '../../../../../src/tools/database/cells';
import type { PropertyDefinition } from '../../../../../src/tools/database/types';
import { makeAnchor, makeEditorContext, press } from './helpers';

const relation = (limit?: 1): PropertyDefinition => ({
  id: 'rel', name: 'Related', type: 'relation', position: 'a0', relation: { targetDatabaseId: 'db', ...(limit !== undefined ? { limit } : {}) },
});

const candidates = [
  { id: 'r1', title: 'Alpha' },
  { id: 'r2', title: 'Bravo' },
  { id: 'r3', title: '' },
];

const options = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-blok-database-relation-option]')];
const search = (): HTMLInputElement => {
  const input = document.querySelector<HTMLInputElement>('[data-blok-database-relation-search]');

  if (input === null) throw new Error('no search');

  return input;
};

describe('relation editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('lists the target rows by title and marks the related ones', () => {
    openCellEditor(relation(), [{ id: 'r2' }], makeAnchor(), makeEditorContext({ relationCandidates: () => candidates }));

    expect(options().map((o) => o.textContent?.trim())).toEqual(['Alpha', 'Bravo', 'tools.database.relationUntitled']);
    expect(options().map((o) => o.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
  });

  it('commits the whole list as id objects when a row is picked', () => {
    const onCommit = vi.fn();

    openCellEditor(relation(), [{ id: 'r2' }], makeAnchor(), makeEditorContext({ relationCandidates: () => candidates, onCommit }));
    options()[0].click();

    expect(onCommit).toHaveBeenLastCalledWith([{ id: 'r2' }, { id: 'r1' }]);
  });

  it('removes a related row when it is picked again', () => {
    const onCommit = vi.fn();

    openCellEditor(relation(), [{ id: 'r1' }, { id: 'r2' }], makeAnchor(), makeEditorContext({ relationCandidates: () => candidates, onCommit }));
    options()[1].click();

    expect(onCommit).toHaveBeenLastCalledWith([{ id: 'r1' }]);
  });

  it('replaces the related row when the limit is one page', () => {
    const onCommit = vi.fn();

    openCellEditor(relation(1), [{ id: 'r1' }], makeAnchor(), makeEditorContext({ relationCandidates: () => candidates, onCommit }));
    options()[1].click();

    expect(onCommit).toHaveBeenLastCalledWith([{ id: 'r2' }]);
  });

  // notion-spec-2 §18.4: the first page is highlighted on open and Enter links it. Enter never unlinks.
  it('Enter right after opening links the first page and stays open', () => {
    const onCommit = vi.fn();
    const onClose = vi.fn();

    openCellEditor(relation(), [], makeAnchor(), makeEditorContext({ relationCandidates: () => candidates, onCommit, onClose }));
    press(search(), 'Enter');

    expect(onCommit).toHaveBeenLastCalledWith([{ id: 'r1' }]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Enter on a highlighted page that is already linked keeps it linked', () => {
    const onCommit = vi.fn();

    openCellEditor(relation(), [{ id: 'r1' }], makeAnchor(), makeEditorContext({ relationCandidates: () => candidates, onCommit }));
    press(search(), 'Enter');

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('filters by the search text and picks the active row with Enter', () => {
    const onCommit = vi.fn();

    openCellEditor(relation(), [], makeAnchor(), makeEditorContext({ relationCandidates: () => candidates, onCommit }));
    search().value = 'bra';
    search().dispatchEvent(new Event('input'));

    expect(options().map((o) => o.textContent?.trim())).toEqual(['Bravo']);
    press(search(), 'Enter');
    expect(onCommit).toHaveBeenLastCalledWith([{ id: 'r2' }]);
  });

  // notion-spec-2 §18.3 (b4-rel-dlg.txt): the table picker is 560 wide, "In <database>" in its head, "Select a page" over 32px page rows.
  describe('in a table cell', () => {
    const openInTable = (): void => {
      openCellEditor(relation(), [], makeAnchor(), makeEditorContext({ relationCandidates: () => candidates, relationScope: () => 'Tasks', coverCell: true }));
    };

    it('opens 560 wide', () => {
      openInTable();

      expect(search().closest<HTMLElement>('[data-blok-popover]')?.style.getPropertyValue('--width')).toBe('560px');
    });

    it('names the related database in the head and labels the list "Select a page"', () => {
      openInTable();

      expect(document.querySelector('[data-blok-database-relation-scope] strong')?.textContent).toBe('Tasks');
      expect(document.querySelector('[data-blok-database-relation-heading]')?.textContent).toBe('tools.database.formRelationHeading');
      expect(document.querySelector('[data-blok-database-select-hint]')).toBeNull();
      expect(search().placeholder).toBe('tools.database.relationSearchPlaceholder');
    });

    // notion-spec-2 §19.2 (02-rel-reopen.png): linked pages first under "1 selected", then "Select more".
    describe('with pages already linked', () => {
      const openLinked = (overrides: Parameters<typeof makeEditorContext>[0] = {}): void => {
        openCellEditor(relation(), [{ id: 'r2' }], makeAnchor(), makeEditorContext({
          relationCandidates: () => candidates, relationScope: () => 'Tasks', coverCell: true, ...overrides,
        }));
      };
      const labels = (): string[] =>
        [...document.querySelectorAll('[data-blok-database-relation-heading], [data-blok-database-relation-option]')].map((el) =>
          el.hasAttribute('data-blok-database-relation-heading') ? `# ${el.textContent ?? ''}` : el.getAttribute('data-blok-database-relation-option') ?? '');

      it('groups the linked pages first, then the rest under "Select more"', () => {
        openLinked({ i18n: { t: (key: string) => (key === 'tools.database.tableSelectedCount' ? '{count} selected' : key) } });

        expect(labels()).toEqual(['# 1 selected', 'r2', '# tools.database.relationSelectMore', 'r1', 'r3']);
      });

      it('highlights the first linked page on open', () => {
        openLinked();

        expect(options().find((o) => o.hasAttribute('data-active'))?.getAttribute('data-blok-database-relation-option')).toBe('r2');
      });

      // notion-spec-2 §19.2 (02-rel-enter-linked.png): Enter opens the linked page; it stays linked and the picker stays open.
      it('Enter on the highlighted linked page opens it, keeps it linked and stays open', () => {
        const openRelated = vi.fn();
        const onCommit = vi.fn();
        const onClose = vi.fn();

        openLinked({ openRelated, onCommit, onClose });
        press(search(), 'Enter');

        expect(openRelated).toHaveBeenCalledWith(relation(), 'r2');
        expect(onCommit).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
      });

      // notion-spec-2 §19.15 / §19.2: a "+" at the right of a page to link, a "−" on a linked one.
      it('ends each row with "+" to link, or "−" on a linked page', () => {
        openLinked();

        const glyph = (id: string): string | undefined =>
          document.querySelector(`[data-blok-database-relation-option="${id}"] > [data-blok-database-relation-toggle]`)?.getAttribute('data-blok-database-relation-toggle');

        expect(glyph('r2')).toBe('remove');
        expect(glyph('r1')).toBe('add');
        expect(document.querySelector('[data-blok-database-relation-toggle]')?.getAttribute('aria-hidden')).toBe('true');
      });

      it('keeps "Select a page" over the list while nothing is linked', () => {
        openInTable();

        expect(labels()).toEqual(['# tools.database.formRelationHeading', 'r1', 'r2', 'r3']);
      });
    });

    it('draws a page glyph before each title', () => {
      openInTable();

      expect(options()[0].querySelector('[data-blok-database-page-icon-placeholder] svg')).not.toBeNull();
      expect(options()[0].textContent?.trim()).toBe('Alpha');
    });
  });

  it('keeps the search and hint over a row page value', () => {
    openCellEditor(relation(), [], makeAnchor(), makeEditorContext({ relationCandidates: () => candidates, relationScope: () => 'Tasks', coverCell: 'value' }));

    expect(document.querySelector('[data-blok-database-relation-scope]')).toBeNull();
    expect(document.querySelector('[data-blok-database-select-hint]')).not.toBeNull();
  });

  it('opens nothing without candidates from the host', () => {
    expect(openCellEditor(relation(), [], makeAnchor(), makeEditorContext()).isOpen).toBe(false);
  });
});
