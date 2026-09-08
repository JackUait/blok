import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { DatabaseBoardView } from '../../../../src/tools/database/database-board-view';
import { simulateKeydown } from '../../../helpers/simulate';
import type { SelectOption, DatabaseRow } from '../../../../src/tools/database/types';
import type { I18n } from '../../../../types';

/**
 * Mutation-focused companion to database-board-view.test.ts.
 *
 * Every assertion here pins a COMPLETE produced value — the whole marker-attribute
 * map, the exact inline style read back through cssstyle, the exact call list of a
 * collaborator — because the board view's output is otherwise indistinguishable
 * from a dozen quietly weakened variants of itself.
 *
 * Four of the file's 76 live mutants are equivalent — no test can distinguish
 * them, so none is written:
 *
 * - `cardEl?.removeAttribute` (line 117) and `cardEl?.setAttribute` (line 121)
 *   losing their `?.`. Both sit inside `if (titleEl !== null && titleEl !==
 *   undefined)`, and `titleEl`'s only assignment is `cardEl?.querySelector(...)`.
 *   Optional chaining yields `undefined` exactly when its base is nullish, so a
 *   `titleEl` that is neither null nor undefined proves `cardEl` is non-null.
 *   The chain can never short-circuit there.
 * - `createColumnElement(option, [], '')` (line 130) with a different
 *   `titlePropertyId`. Inside `createColumnElement` that parameter is read at
 *   exactly one place — the `createCardElement(row, titlePropertyId)` call in
 *   `for (const row of rows)` — and `appendGroup` always passes the literal `[]`,
 *   so the loop body never runs.
 * - `titleEl.textContent ?? ''` (line 339) with a different fallback. Per the DOM
 *   Standard, `textContent` returns null only for Document and DocumentType; an
 *   Element with no children returns `''` (verified in this jsdom: `""`), so the
 *   `??` right-hand side is unreachable for an element.
 */

const makeOption = (overrides: Partial<SelectOption> = {}): SelectOption => ({
  id: 'opt-1',
  label: 'To Do',
  position: 'a0',
  ...overrides,
});

const makeRow = (overrides: Partial<DatabaseRow> = {}): DatabaseRow => ({
  id: 'row-1',
  position: 'a0',
  properties: { title: 'Fix bug' },
  ...overrides,
});

/**
 * `T(key)` rather than `key`: a translator that echoes its key cannot tell a
 * mutated `t('')` from the real key once the result is concatenated into
 * textContent — both read as a bare prefix.
 */
const createI18n = (): I18n => ({
  t: vi.fn((key: string) => `T(${key})`),
  has: vi.fn(() => true),
  getEnglishTranslation: vi.fn(() => ''),
  getLocale: vi.fn(() => 'en'),
});

const requireEl = (root: ParentNode, selector: string): HTMLElement => {
  const element = root.querySelector<HTMLElement>(selector);

  if (element === null) {
    throw new Error(`fixture is missing ${selector}`);
  }

  return element;
};

const requireInput = (root: ParentNode, selector: string): HTMLInputElement => {
  const element = root.querySelector<HTMLInputElement>(selector);

  if (element === null) {
    throw new Error(`fixture is missing ${selector}`);
  }

  return element;
};

/**
 * Runs `act` and returns the messages jsdom reported to window's `error` event.
 *
 * A throw inside a listener never reaches the caller of `dispatchEvent` — jsdom
 * reports it on window instead — so an optional-chaining mutant that turns a
 * missing callback into a TypeError passes any test that only looks at the DOM.
 * `preventDefault` marks the exception handled so it is not also reported as an
 * unhandled error for the whole file.
 */
const captureWindowErrors = (act: () => void): string[] => {
  const messages: string[] = [];
  const onError = (event: ErrorEvent): void => {
    messages.push(event.message);
    event.preventDefault();
  };

  window.addEventListener('error', onError);

  try {
    act();
  } finally {
    window.removeEventListener('error', onError);
  }

  return messages;
};

describe('DatabaseBoardView — mutation coverage', () => {
  let i18n: I18n;

  beforeEach(() => {
    vi.clearAllMocks();
    i18n = createI18n();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createBoard = (
    overrides: Partial<{
      readOnly: boolean;
      options: SelectOption[];
      rows: DatabaseRow[];
      titlePropertyId: string;
      onTitleEdit: (rowId: string, newTitle: string) => void;
    }> = {},
  ): { view: DatabaseBoardView; board: HTMLDivElement } => {
    const view = new DatabaseBoardView({
      readOnly: overrides.readOnly ?? false,
      i18n,
      options: overrides.options ?? [makeOption()],
      getRows: () => overrides.rows ?? [],
      titlePropertyId: overrides.titlePropertyId ?? 'title',
      onTitleEdit: overrides.onTitleEdit,
    });

    return { view,
      board: view.createView() };
  };

  describe('createView markers and styles', () => {
    it('writes every board-level marker attribute with an empty value', () => {
      const { board } = createBoard();
      const boardArea = requireEl(board, '[data-blok-database-board]');
      const addColumnBtn = requireEl(board, '[data-blok-database-add-column]');

      expect({
        board: boardArea.getAttribute('data-blok-database-board'),
        addColumn: addColumnBtn.getAttribute('data-blok-database-add-column'),
      }).toStrictEqual({
        board: '',
        addColumn: '',
      });
    });

    it('pins the wrapper and board-area inline styles as cssstyle reads them back', () => {
      const { board } = createBoard();
      const boardArea = requireEl(board, '[data-blok-database-board]');

      expect({
        wrapperDisplay: board.style.display,
        display: boardArea.style.display,
        overflowX: boardArea.style.overflowX,
        alignItems: boardArea.style.alignItems,
        gap: boardArea.style.gap,
        paddingBottom: boardArea.style.paddingBottom,
        flex: boardArea.style.flex,
        minWidth: boardArea.style.minWidth,
      }).toStrictEqual({
        wrapperDisplay: 'flex',
        display: 'flex',
        overflowX: 'auto',
        alignItems: 'flex-start',
        gap: '12px',
        paddingBottom: '24px',
        flex: '1 1 0%',
        minWidth: '0px',
      });
    });

    it('labels the add-column button from the addColumn key on both the text and the aria-label', () => {
      const { board } = createBoard();
      const addColumnBtn = requireEl(board, '[data-blok-database-add-column]');

      expect({
        text: addColumnBtn.textContent,
        label: addColumnBtn.getAttribute('aria-label'),
      }).toStrictEqual({
        text: '+ T(tools.database.addColumn)',
        label: 'T(tools.database.addColumn)',
      });
    });
  });

  describe('column element', () => {
    it('writes every column-level marker attribute with an empty value', () => {
      const { board } = createBoard({ options: [makeOption({ color: 'blue' })] });
      const column = requireEl(board, '[data-blok-database-column]');

      expect({
        column: column.getAttribute('data-blok-database-column'),
        header: requireEl(column, '[data-blok-database-column-header]').getAttribute('data-blok-database-column-header'),
        pill: requireEl(column, '[data-blok-database-column-pill]').getAttribute('data-blok-database-column-pill'),
        dot: requireEl(column, '[data-blok-database-column-dot]').getAttribute('data-blok-database-column-dot'),
        title: requireEl(column, '[data-blok-database-column-title]').getAttribute('data-blok-database-column-title'),
        count: requireEl(column, '[data-blok-database-column-count]').getAttribute('data-blok-database-column-count'),
        cards: requireEl(column, '[data-blok-database-cards]').getAttribute('data-blok-database-cards'),
        addCard: requireEl(column, '[data-blok-database-add-card]').getAttribute('data-blok-database-add-card'),
        addCardIcon: requireEl(column, '[data-blok-database-add-card-icon]').getAttribute('data-blok-database-add-card-icon'),
      }).toStrictEqual({
        column: '',
        header: '',
        pill: '',
        dot: '',
        title: '',
        count: '',
        cards: '',
        addCard: '',
        addCardIcon: '',
      });
    });

    it('pins the header and cards-container inline styles', () => {
      const { board } = createBoard();
      const header = requireEl(board, '[data-blok-database-column-header]');
      const cards = requireEl(board, '[data-blok-database-cards]');

      expect({
        headerDisplay: header.style.display,
        headerAlignItems: header.style.alignItems,
        headerPadding: header.style.padding,
        headerBorderRadius: header.style.borderRadius,
        headerGap: header.style.gap,
        headerCursor: header.style.cursor,
        cardsDisplay: cards.style.display,
        cardsFlexDirection: cards.style.flexDirection,
        cardsGap: cards.style.gap,
        cardsPaddingTop: cards.style.paddingTop,
        cardsMinHeight: cards.style.minHeight,
      }).toStrictEqual({
        headerDisplay: 'flex',
        headerAlignItems: 'center',
        headerPadding: '0px 0px 6px',
        headerBorderRadius: '4px',
        headerGap: '6px',
        headerCursor: 'grab',
        cardsDisplay: 'flex',
        cardsFlexDirection: 'column',
        cardsGap: '8px',
        cardsPaddingTop: '6px',
        cardsMinHeight: '40px',
      });
    });

    it('derives the pill background, pill text and count colours from the option colour', () => {
      const { board } = createBoard({ options: [makeOption({ color: 'blue' })] });
      const pill = requireEl(board, '[data-blok-database-column-pill]');
      const count = requireEl(board, '[data-blok-database-column-count]');
      const dot = requireEl(board, '[data-blok-database-column-dot]');

      expect({
        pillBackground: pill.style.backgroundColor,
        pillColor: pill.style.color,
        dotBackground: dot.style.backgroundColor,
        countColor: count.style.color,
      }).toStrictEqual({
        pillBackground: 'color-mix(in srgb, var(--blok-color-blue-text) 20%, var(--blok-color-blue-bg))',
        pillColor: 'var(--blok-color-blue-text)',
        dotBackground: 'var(--blok-color-blue-text)',
        countColor: 'var(--blok-color-blue-text)',
      });
    });

    it('leaves the pill and count colours unset when the option carries no colour', () => {
      const { board } = createBoard({ options: [makeOption()] });
      const pill = requireEl(board, '[data-blok-database-column-pill]');
      const count = requireEl(board, '[data-blok-database-column-count]');

      expect({
        pillBackground: pill.style.backgroundColor,
        pillColor: pill.style.color,
        countColor: count.style.color,
      }).toStrictEqual({
        pillBackground: '',
        pillColor: '',
        countColor: '',
      });
    });

    it('builds the add-card button from an icon span and a localised label span', () => {
      const { board } = createBoard();
      const addCardBtn = requireEl(board, '[data-blok-database-add-card]');

      // The button's own textContent carries the icon SVG's whitespace, so the
      // label is read off the span that was appended after it.
      expect({
        childCount: addCardBtn.children.length,
        iconMarker: addCardBtn.firstElementChild?.getAttribute('data-blok-database-add-card-icon'),
        labelText: addCardBtn.lastElementChild?.textContent,
        label: addCardBtn.getAttribute('aria-label'),
      }).toStrictEqual({
        childCount: 2,
        iconMarker: '',
        labelText: 'T(tools.database.newPage)',
        label: 'T(tools.database.addCard)',
      });
    });
  });

  describe('card element', () => {
    it('writes every card-level marker attribute with an empty value', () => {
      const { board } = createBoard({ rows: [makeRow()] });
      const card = requireEl(board, '[data-blok-database-card]');

      expect({
        card: card.getAttribute('data-blok-database-card'),
        title: requireEl(card, '[data-blok-database-card-title]').getAttribute('data-blok-database-card-title'),
        actions: requireEl(card, '[data-blok-database-card-actions]').getAttribute('data-blok-database-card-actions'),
        edit: requireEl(card, '[data-blok-database-edit-card]').getAttribute('data-blok-database-edit-card'),
        menu: requireEl(card, '[data-blok-database-card-menu]').getAttribute('data-blok-database-card-menu'),
      }).toStrictEqual({
        card: '',
        title: '',
        actions: '',
        edit: '',
        menu: '',
      });
    });

    it('marks an empty-titled card with empty-valued placeholder attributes', () => {
      const { board } = createBoard({ rows: [makeRow({ properties: { title: '' } })] });
      const card = requireEl(board, '[data-blok-database-card]');
      const title = requireEl(card, '[data-blok-database-card-title]');

      expect({
        text: title.textContent,
        placeholder: title.getAttribute('data-placeholder'),
        empty: card.getAttribute('data-empty'),
      }).toStrictEqual({
        text: 'T(tools.database.cardTitlePlaceholder)',
        placeholder: '',
        empty: '',
      });
    });

    it('falls back to an empty title when the row has no value for the title property', () => {
      const { board } = createBoard({ rows: [makeRow({ properties: {} })] });
      const card = requireEl(board, '[data-blok-database-card]');
      const title = requireEl(card, '[data-blok-database-card-title]');

      expect({
        text: title.textContent,
        placeholder: title.getAttribute('data-placeholder'),
        empty: card.getAttribute('data-empty'),
      }).toStrictEqual({
        text: 'T(tools.database.cardTitlePlaceholder)',
        placeholder: '',
        empty: '',
      });
    });

    it('stops the edit-button click from reaching the card', () => {
      const { board } = createBoard({ rows: [makeRow()] });
      const card = requireEl(board, '[data-blok-database-card]');
      const editBtn = requireEl(card, '[data-blok-database-edit-card]');
      const onCardClick: Mock<(event: Event) => void> = vi.fn();

      card.addEventListener('click', onCardClick);
      editBtn.click();

      expect(onCardClick).not.toHaveBeenCalled();
    });
  });

  describe('column count badge', () => {
    it('appendRow re-counts the cards in the column it was dropped into', () => {
      const { view, board } = createBoard({ rows: [makeRow()] });
      const cards = requireEl(board, '[data-blok-database-cards]');
      const count = requireEl(board, '[data-blok-database-column-count]');

      view.appendRow(cards, makeRow({ id: 'row-2', properties: { title: 'Second' } }));

      expect(count.textContent).toBe('2');
    });

    it('removeRow re-counts the cards left in the column', () => {
      const { view, board } = createBoard({
        rows: [makeRow(), makeRow({ id: 'row-2', properties: { title: 'Second' } })],
      });
      const count = requireEl(board, '[data-blok-database-column-count]');

      view.removeRow(board, 'row-2');

      expect(count.textContent).toBe('1');
    });

    it('removeRow skips the re-count when the card sits outside any cards container', () => {
      const { view } = createBoard();
      const wrapper: HTMLElement = document.createElement('div');
      const card: HTMLElement = document.createElement('div');

      card.setAttribute('data-row-id', 'row-1');
      wrapper.appendChild(card);

      expect(() => {
        view.removeRow(wrapper, 'row-1');
      }).not.toThrow();
      expect(wrapper.querySelector('[data-row-id="row-1"]')).toBeNull();
    });

    it('leaves a column without a count badge alone instead of writing to nothing', () => {
      const { view } = createBoard();
      const column: HTMLElement = document.createElement('div');
      const cards: HTMLElement = document.createElement('div');

      column.setAttribute('data-blok-database-column', '');
      cards.setAttribute('data-blok-database-cards', '');
      column.appendChild(cards);

      expect(() => {
        view.appendRow(cards, makeRow());
      }).not.toThrow();
      expect(cards.querySelectorAll('[data-blok-database-card]')).toHaveLength(1);
    });

    // BUG (pinned, not fixed): `cardEl?.closest(...)` yields `undefined` for an
    // unknown row id, and `as HTMLElement | null` hides that from the
    // `cardsContainer !== null` guard — so removeRow reaches
    // updateColumnCount(undefined) and throws on `.closest`. The message is the
    // discriminator: dropping the `?.` on `cardEl?.remove()` throws on `.remove`
    // instead, one line earlier.
    it('removeRow currently throws on an unknown row id, and it throws inside the re-count', () => {
      const { view, board } = createBoard({ rows: [makeRow()] });

      expect(() => {
        view.removeRow(board, 'row-does-not-exist');
      }).toThrow(/closest/);
    });
  });

  describe('updateRowTitle', () => {
    it('clears both placeholder markers when a title arrives', () => {
      const { view, board } = createBoard({ rows: [makeRow({ properties: { title: '' } })] });
      const card = requireEl(board, '[data-blok-database-card]');

      view.updateRowTitle(board, 'row-1', 'Now titled');

      expect({
        text: requireEl(card, '[data-blok-database-card-title]').textContent,
        placeholder: requireEl(card, '[data-blok-database-card-title]').getAttribute('data-placeholder'),
        empty: card.getAttribute('data-empty'),
      }).toStrictEqual({
        text: 'Now titled',
        placeholder: null,
        empty: null,
      });
    });

    it('restores both placeholder markers with empty values when the title is cleared', () => {
      const { view, board } = createBoard({ rows: [makeRow()] });
      const card = requireEl(board, '[data-blok-database-card]');

      view.updateRowTitle(board, 'row-1', '');

      expect({
        text: requireEl(card, '[data-blok-database-card-title]').textContent,
        placeholder: requireEl(card, '[data-blok-database-card-title]').getAttribute('data-placeholder'),
        empty: card.getAttribute('data-empty'),
      }).toStrictEqual({
        text: 'T(tools.database.cardTitlePlaceholder)',
        placeholder: '',
        empty: '',
      });
    });

    it('ignores a card that carries no title element', () => {
      const { view } = createBoard();
      const wrapper: HTMLElement = document.createElement('div');
      const card: HTMLElement = document.createElement('div');

      card.setAttribute('data-row-id', 'row-1');
      wrapper.appendChild(card);

      expect(() => {
        view.updateRowTitle(wrapper, 'row-1', 'Anything');
      }).not.toThrow();
      expect(card.textContent).toBe('');
    });
  });

  describe('appendGroup and removeGroup', () => {
    it('appends the column when there is no add-column button to insert before', () => {
      const { view, board } = createBoard({ readOnly: true });
      const boardArea = requireEl(board, '[data-blok-database-board]');
      const insertBefore = vi.spyOn(boardArea, 'insertBefore');

      view.appendGroup(board, makeOption({ id: 'opt-new',
        label: 'New' }));

      // insertBefore(node, null) and appendChild(node) build the same tree, so the
      // call that was NOT made is the only witness of which branch ran.
      expect(insertBefore).not.toHaveBeenCalled();
      expect(boardArea.lastElementChild?.getAttribute('data-option-id')).toBe('opt-new');
    });

    it('ignores an unknown option id', () => {
      const { view, board } = createBoard({ options: [makeOption({ id: 'opt-keep' })] });

      expect(() => {
        view.removeGroup(board, 'opt-missing');
      }).not.toThrow();
      expect(board.querySelectorAll('[data-blok-database-column]')).toHaveLength(1);
    });
  });

  describe('inline card rename', () => {
    const openRename = (
      overrides: Partial<{ title: string; onTitleEdit: (rowId: string, newTitle: string) => void }> = {},
    ): { board: HTMLDivElement; card: HTMLElement; input: HTMLInputElement } => {
      const { board } = createBoard({
        rows: [makeRow({ properties: { title: overrides.title ?? 'Fix bug' } })],
        onTitleEdit: overrides.onTitleEdit,
      });
      const card = requireEl(board, '[data-blok-database-card]');

      requireEl(card, '[data-blok-database-edit-card]').click();

      return { board,
        card,
        input: requireInput(card, '[data-blok-database-card-title-input]') };
    };

    it('configures the rename input with its label, marker and inline styles', () => {
      const { input } = openRename();

      expect({
        label: input.getAttribute('aria-label'),
        marker: input.getAttribute('data-blok-database-card-title-input'),
        width: input.style.width,
        boxSizing: input.style.boxSizing,
      }).toStrictEqual({
        label: 'T(tools.database.editCardTitle)',
        marker: '',
        width: '100%',
        boxSizing: 'border-box',
      });
    });

    it('rebuilds the title div with an empty-valued card-title marker', () => {
      const { card, input } = openRename();

      input.value = 'Renamed';
      simulateKeydown(input, 'Enter');

      const restored = requireEl(card, '[data-blok-database-card-title]');

      expect({
        marker: restored.getAttribute('data-blok-database-card-title'),
        text: restored.textContent,
      }).toStrictEqual({
        marker: '',
        text: 'Renamed',
      });
    });

    it('does not report an unchanged title as an edit', () => {
      const onTitleEdit: Mock<(rowId: string, newTitle: string) => void> = vi.fn();
      const { input } = openRename({ onTitleEdit });

      simulateKeydown(input, 'Enter');

      expect(onTitleEdit.mock.calls).toStrictEqual([]);
    });

    it('clears data-empty once a real title is committed', () => {
      const { card, input } = openRename({ title: '' });

      input.value = 'Now titled';
      simulateKeydown(input, 'Enter');

      expect(card.hasAttribute('data-empty')).toBe(false);
    });

    it('keeps data-empty when the commit resolves to an empty title', () => {
      const onTitleEdit: Mock<(rowId: string, newTitle: string) => void> = vi.fn();
      const { board } = createBoard({ rows: [makeRow({ properties: { title: '' } })],
        onTitleEdit });
      const card = requireEl(board, '[data-blok-database-card]');

      // The commit resolves to `input.value.trim() || currentValue`, so an empty
      // result needs the seed value empty too — hence blanking the placeholder text.
      requireEl(card, '[data-blok-database-card-title]').textContent = '';
      requireEl(card, '[data-blok-database-edit-card]').click();

      const input = requireInput(card, '[data-blok-database-card-title-input]');

      input.value = '';
      simulateKeydown(input, 'Enter');

      expect(card.getAttribute('data-empty')).toBe('');
    });

    it('commits without an onTitleEdit callback instead of throwing into the keydown', () => {
      const { card, input } = openRename({ title: '' });

      input.value = 'Now titled';

      const errors = captureWindowErrors(() => {
        simulateKeydown(input, 'Enter');
      });

      expect(errors).toStrictEqual([]);
      expect(card.hasAttribute('data-empty')).toBe(false);
    });

    it('does nothing when the edited card has lost its title element', () => {
      const { board } = createBoard({ rows: [makeRow()] });
      const card = requireEl(board, '[data-blok-database-card]');

      requireEl(card, '[data-blok-database-card-title]').remove();

      const editBtn = requireEl(card, '[data-blok-database-edit-card]');
      const errors = captureWindowErrors(() => {
        editBtn.click();
      });

      expect(errors).toStrictEqual([]);
      expect(card.querySelector('[data-blok-database-card-title-input]')).toBeNull();
    });
  });
});
