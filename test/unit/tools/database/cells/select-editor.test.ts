import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { openCellEditor } from '../../../../../src/tools/database/cells';
import type { CellEditorContext } from '../../../../../src/tools/database/cells/types';
import { PopoverRegistry } from '../../../../../src/components/utils/popover/popover-registry';
import type { SelectOption } from '../../../../../src/tools/database/types';
import { editorRoot, makeAnchor, makeEditorContext, makeProperty, press, pressOutside } from './helpers';
import { IconSliders } from '../../../../../src/components/icons';
import { DATA_ATTR, TOOLTIP_INTERFACE_VALUE } from '../../../../../src/components/constants';
import { HINT_DELAY, destroy as destroyTooltip } from '../../../../../src/components/utils/tooltip';

const OPTIONS: SelectOption[] = [
  { id: 'o2', label: 'Doing', color: 'blue', position: 'a1' },
  { id: 'o1', label: 'Todo', color: 'gray', position: 'a0' },
  { id: 'o3', label: 'Done', color: 'green', position: 'a2' },
];

const q = <T extends Element = HTMLElement>(selector: string): T => {
  const el = editorRoot()?.querySelector<T>(selector);

  if (el === null || el === undefined) {
    throw new Error(`missing ${selector}`);
  }

  return el;
};

const search = (): HTMLInputElement => q<HTMLInputElement>('[data-blok-database-select-search]');

const typeSearch = (text: string): void => {
  search().value = text;
  search().dispatchEvent(new Event('input', { bubbles: true }));
};

const rowIds = (): string[] =>
  [...(editorRoot()?.querySelectorAll('[data-blok-database-select-option]') ?? [])].map((r) => r.getAttribute('data-blok-database-select-option') ?? '');

const row = (id: string): HTMLElement => q(`[data-blok-database-select-option="${id}"]`);

const lastOptions = (ctx: CellEditorContext): SelectOption[] => {
  const onOptionsChange = ctx.onOptionsChange;

  if (onOptionsChange === undefined) {
    return [];
  }
  const calls = vi.mocked(onOptionsChange).mock.calls;
  const last: SelectOption[] | undefined = calls[calls.length - 1]?.[0];

  return last ?? [];
};

const openSelect = (value: string | string[] | null, overrides: Partial<CellEditorContext> = {}, multi = false): CellEditorContext => {
  const ctx = makeEditorContext({ options: OPTIONS, onOptionsChange: vi.fn(), ...overrides });

  openCellEditor(makeProperty(multi ? 'multiSelect' : 'select'), value, makeAnchor(), ctx);

  return ctx;
};

describe('select cell editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PopoverRegistry.resetForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('opens at least 300px wide, as Notion measured beside a 200px cell (research/08:306)', () => {
    openSelect('o2');

    expect(editorRoot()?.closest<HTMLElement>('[data-blok-popover]')?.style.getPropertyValue('--width')).toBe('300px');
  });

  // notion-spec-2 §17.3: the option picker follows the property's Sort.
  it.each([
    ['alphabetical', ['o2', 'o3', 'o1']],
    ['reverseAlphabetical', ['o1', 'o3', 'o2']],
  ] as const)('lists options %s when the property sorts them so', (optionSort, order) => {
    openCellEditor({ ...makeProperty('multiSelect'), optionSort }, null, makeAnchor(), makeEditorContext({ options: OPTIONS, onOptionsChange: vi.fn() }));

    expect(rowIds()).toEqual(order);
  });

  // notion-spec-2 §19.14: the current value shows only as the pill in the top field, never as a check.
  it('lists options in position order and draws no check mark on the selected one', () => {
    openSelect('o2');

    expect(row('o2').querySelector('[data-blok-database-select-option-check]')).toBeNull();
    expect(rowIds()).toEqual(['o1', 'o2', 'o3']);
    expect(row('o2').getAttribute('aria-selected')).toBe('true');
    expect(row('o1').getAttribute('aria-selected')).toBe('false');
  });

  it('shows the current value as a chip beside the search field', () => {
    openSelect('o2');

    expect(q('[data-blok-database-select-chips]').textContent).toContain('Doing');
  });

  it('typing filters options, ignoring case', () => {
    openSelect(null);
    typeSearch('do');

    expect(rowIds()).toEqual(['o1', 'o2', 'o3']);
    typeSearch('DON');
    expect(rowIds()).toEqual(['o3']);
  });

  it('clicking an option picks it and closes a single select', () => {
    const ctx = openSelect('o1');

    row('o3').click();

    expect(ctx.onCommit).toHaveBeenCalledWith('o3');
    expect(ctx.onClose).toHaveBeenCalledTimes(1);
  });

  it('Enter picks the first match', () => {
    const ctx = openSelect(null);

    typeSearch('don');
    press(search(), 'Enter');

    expect(ctx.onCommit).toHaveBeenCalledWith('o3');
  });

  // notion-spec-2 §18.4: no row is highlighted on open, so Enter there must not change the value.
  it.each([
    ['select', 'o2', false],
    ['multi-select', ['o1'], true],
  ] as const)('Enter right after opening a %s leaves the value and the picker alone', (_name, value, multi) => {
    const ctx = openSelect(typeof value === 'string' ? value : [...value], {}, multi);

    expect(search().getAttribute('aria-activedescendant')).toBeNull();
    press(search(), 'Enter');

    expect(ctx.onCommit).not.toHaveBeenCalled();
    expect(ctx.onClose).not.toHaveBeenCalled();
  });

  it('arrows move the active row and Enter picks it', () => {
    const ctx = openSelect(null);

    press(search(), 'ArrowDown');
    press(search(), 'ArrowDown');
    expect(search().getAttribute('aria-activedescendant')).toBe(row('o2').id);
    press(search(), 'ArrowUp');
    press(search(), 'Enter');

    expect(ctx.onCommit).toHaveBeenCalledWith('o1');
  });

  it('Enter on no match creates an option with the next color and picks it', () => {
    const ctx = openSelect(null);

    typeSearch('Blocked');
    press(search(), 'Enter');

    const created = lastOptions(ctx).find((option) => option.label === 'Blocked');

    expect(created).toBeDefined();
    expect(created?.color).toBe('orange');
    expect(created?.id).not.toBe('');
    expect(OPTIONS.map((o) => o.id)).not.toContain(created?.id);
    expect((created?.position ?? '') > 'a2').toBe(true);
    expect(lastOptions(ctx)).toHaveLength(4);
    expect(ctx.onCommit).toHaveBeenCalledWith(created?.id);
  });

  it('offers a create row only when no option has that name', () => {
    openSelect(null);
    typeSearch('todo');
    expect(editorRoot()?.querySelector('[data-blok-database-select-create]')).toBeNull();

    typeSearch('todos');
    expect(q('[data-blok-database-select-create]').textContent).toContain('todos');
  });

  it('Escape closes the editor', () => {
    const ctx = openSelect('o1');

    press(search(), 'Escape');

    expect(editorRoot()?.isConnected ?? false).toBe(false);
    expect(ctx.onClose).toHaveBeenCalledTimes(1);
    expect(ctx.onCommit).not.toHaveBeenCalled();
  });

  // notion-spec-2 §19.1, §19.14: in the table the current value is a pill with ×, and the field has no prompt beside it.
  describe('in a table cell', () => {
    it('has no search prompt beside a pill, and the prompt on an empty cell', () => {
      openSelect('o1', { coverCell: true });
      expect(search().placeholder).toBe('');
      document.body.innerHTML = '';
      PopoverRegistry.resetForTests();

      openSelect(null, { coverCell: true });
      expect(search().placeholder).toBe('tools.database.selectSearchPlaceholder');
    });

    it('clears the value with the pill\'s ×, stays open and shows the prompt again', () => {
      const ctx = openSelect('o1', { coverCell: true });

      q('[data-blok-database-select-chip="o1"] [data-blok-database-select-chip-remove]').click();

      expect(ctx.onCommit).toHaveBeenLastCalledWith(null);
      expect(editorRoot()?.querySelector('[data-blok-database-select-chip]')).toBeNull();
      expect(search().placeholder).toBe('tools.database.selectSearchPlaceholder');
      expect(ctx.onClose).not.toHaveBeenCalled();
    });

    it('multi-select: no prompt once a pill is in the field', () => {
      openSelect(['o1'], { coverCell: true }, true);

      expect(search().placeholder).toBe('');
    });
  });

  describe('multi-select', () => {
    it('toggles options, commits each change and stays open', () => {
      const ctx = openSelect(['o1'], {}, true);

      row('o2').click();
      expect(ctx.onCommit).toHaveBeenLastCalledWith(['o1', 'o2']);
      row('o1').click();
      expect(ctx.onCommit).toHaveBeenLastCalledWith(['o2']);
      expect(editorRoot()).not.toBeNull();
      expect(ctx.onClose).not.toHaveBeenCalled();
    });

    it('marks every selected option', () => {
      openSelect(['o1', 'o3'], {}, true);

      expect(row('o1').getAttribute('aria-selected')).toBe('true');
      expect(row('o3').getAttribute('aria-selected')).toBe('true');
      expect(q('[data-blok-database-select-list]').getAttribute('aria-multiselectable')).toBe('true');
    });

    it('Backspace in an empty search removes the last tag', () => {
      const ctx = openSelect(['o1', 'o3'], {}, true);

      press(search(), 'Backspace');

      expect(ctx.onCommit).toHaveBeenLastCalledWith(['o1']);
    });

    it('Backspace with search text only edits the text', () => {
      const ctx = openSelect(['o1'], {}, true);

      typeSearch('x');
      press(search(), 'Backspace');

      expect(ctx.onCommit).not.toHaveBeenCalled();
    });

    it('a chip remove button drops that tag', () => {
      const ctx = openSelect(['o1', 'o3'], {}, true);

      q('[data-blok-database-select-chip="o1"] [data-blok-database-select-chip-remove]').click();

      expect(ctx.onCommit).toHaveBeenLastCalledWith(['o3']);
    });

    it('creating an option adds it to the tags and clears the search', () => {
      const ctx = openSelect(['o1'], {}, true);

      typeSearch('New');
      press(search(), 'Enter');

      const created = lastOptions(ctx).find((option) => option.label === 'New');

      expect(ctx.onCommit).toHaveBeenLastCalledWith(['o1', created?.id]);
      expect(search().value).toBe('');
    });

    // research/22 §13: Enter on a new name keeps the editor open and focused, and highlights the new option.
    it('Enter creates two options in a row, keeps both, and stays open on the new one', () => {
      const ctx = openSelect([], {}, true);

      typeSearch('T1');
      press(search(), 'Enter');
      typeSearch('T2');
      press(search(), 'Enter');

      const t1 = lastOptions(ctx).find((option) => option.label === 'T1');
      const t2 = lastOptions(ctx).find((option) => option.label === 'T2');

      expect(ctx.onCommit).toHaveBeenLastCalledWith([t1?.id, t2?.id]);
      expect(editorRoot()).not.toBeNull();
      expect(ctx.onClose).not.toHaveBeenCalled();
      expect(search()).toHaveFocus();
      expect(row(t2?.id ?? '').hasAttribute('data-active')).toBe(true);
    });

    it('Enter on a typed, unselected option adds it, clears the search and stays open', () => {
      const ctx = openSelect(['o1'], {}, true);

      typeSearch('Done');
      press(search(), 'Enter');

      expect(ctx.onCommit).toHaveBeenLastCalledWith(['o1', 'o3']);
      expect(search().value).toBe('');
      expect(editorRoot()).not.toBeNull();
    });

    // notion-spec-2 §19.1 (01-ms-arrow-enter.png): the added option stays in the list, still highlighted.
    it('ArrowDown then Enter adds the option, keeps it in the list highlighted, and stays open', () => {
      const ctx = openSelect([], {}, true);

      press(search(), 'ArrowDown');
      press(search(), 'Enter');

      expect(row('o1').hasAttribute('data-active')).toBe(true);
      expect(ctx.onCommit).toHaveBeenLastCalledWith(['o1']);
      expect(rowIds()).toEqual(['o1', 'o2', 'o3']);
      expect(ctx.onClose).not.toHaveBeenCalled();
    });

    // Enter never removes an option, so a second Enter on the same highlighted row keeps it.
    it('a second Enter on the highlighted, just added option keeps it chosen', () => {
      const ctx = openSelect([], {}, true);

      press(search(), 'ArrowDown');
      press(search(), 'Enter');
      press(search(), 'Enter');

      expect(ctx.onCommit).toHaveBeenCalledTimes(1);
      expect(q('[data-blok-database-select-chip="o1"]')).not.toBeNull();
    });

    it('Enter on a typed option that is already selected does nothing', () => {
      const ctx = openSelect(['o1'], {}, true);

      typeSearch('Todo');
      press(search(), 'Enter');

      expect(ctx.onCommit).not.toHaveBeenCalled();
      expect(search().value).toBe('Todo');
      expect(q('[data-blok-database-select-chip="o1"]')).not.toBeNull();
      expect(editorRoot()).not.toBeNull();
    });
  });

  describe('option menu', () => {
    const openMenu = (id: string): void => {
      q(`[data-blok-database-select-option="${id}"] [data-blok-database-select-option-menu]`).click();
    };

    it('renames an option', () => {
      const ctx = openSelect(null);

      openMenu('o1');
      const name = q<HTMLInputElement>('[data-blok-database-option-name]');

      name.value = 'Backlog';
      press(name, 'Enter');

      expect(lastOptions(ctx).find((o) => o.id === 'o1')?.label).toBe('Backlog');
    });

    it('lists the ten colors and recolors an option', () => {
      const ctx = openSelect(null);

      openMenu('o1');
      const colors = editorRoot()?.querySelectorAll('[data-blok-database-option-color]') ?? [];

      expect(colors).toHaveLength(10);
      expect(q('[data-blok-database-option-color="gray"]').getAttribute('aria-checked')).toBe('true');
      q('[data-blok-database-option-color="red"]').click();

      expect(lastOptions(ctx).find((o) => o.id === 'o1')?.color).toBe('red');
      expect(q('[data-blok-database-option-color="red"]').getAttribute('aria-checked')).toBe('true');
    });

    it('deletes an option and drops it from the value', () => {
      const ctx = openSelect(['o1', 'o2'], {}, true);

      openMenu('o1');
      q('[data-blok-database-option-delete]').click();
      expect(ctx.onOptionsChange).not.toHaveBeenCalled();
      q('[data-blok-database-option-delete-confirm]').click();

      expect(lastOptions(ctx).map((o) => o.id).sort()).toEqual(['o2', 'o3']);
      expect(ctx.onCommit).toHaveBeenLastCalledWith(['o2']);
      expect(rowIds()).toEqual(['o2', 'o3']);
    });

    it('asks before deleting, as Notion does, and Cancel keeps the option', () => {
      const ctx = openSelect(['o1']);

      openMenu('o1');
      q('[data-blok-database-option-delete]').click();
      expect(q('[data-blok-database-option-delete-prompt]').textContent).toContain('tools.database.optionDeleteConfirm');
      q('[data-blok-database-option-delete-cancel]').click();

      expect(ctx.onOptionsChange).not.toHaveBeenCalled();
      expect(ctx.onCommit).not.toHaveBeenCalled();
      expect(editorRoot()?.querySelector('[data-blok-database-option-name]')).not.toBeNull();
    });

    it('the delete prompt is a labelled modal that keeps focus on its two buttons', () => {
      openSelect(['o1']);

      openMenu('o1');
      q('[data-blok-database-option-delete]').click();
      const prompt = q('[data-blok-database-option-delete-prompt]');
      const confirm = q('[data-blok-database-option-delete-confirm]');
      const cancel = q('[data-blok-database-option-delete-cancel]');

      expect(prompt.getAttribute('role')).toBe('alertdialog');
      expect(prompt.getAttribute('aria-modal')).toBe('true');
      expect(prompt.getAttribute('aria-label')).toBe('tools.database.optionDeleteConfirm');
      expect(confirm).toHaveFocus();
      expect(q('[data-blok-database-select-chips]').hasAttribute('inert')).toBe(true);

      cancel.focus();
      expect(press(cancel, 'Tab').defaultPrevented).toBe(true);
      expect(confirm).toHaveFocus();

      expect(press(confirm, 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
      expect(cancel).toHaveFocus();
    });

    it('Escape in the delete prompt cancels back to the option menu', () => {
      const ctx = openSelect(['o1']);

      openMenu('o1');
      q('[data-blok-database-option-delete]').click();
      press(q('[data-blok-database-option-delete-confirm]'), 'Escape');

      expect(editorRoot()?.querySelector('[data-blok-database-option-delete-prompt]')).toBeNull();
      expect(editorRoot()?.querySelector('[data-blok-database-option-name]')).not.toBeNull();
      expect(q('[data-blok-database-select-chips]').hasAttribute('inert')).toBe(false);
      expect(ctx.onOptionsChange).not.toHaveBeenCalled();
      expect(ctx.onClose).not.toHaveBeenCalled();
    });

    it('Escape in the menu steps back to the list and keeps the editor open', () => {
      const ctx = openSelect(null);

      openMenu('o1');
      press(q('[data-blok-database-option-name]'), 'Escape');

      expect(editorRoot()?.querySelector('[data-blok-database-option-panel]')).toBeNull();
      expect(rowIds()).toEqual(['o1', 'o2', 'o3']);
      expect(ctx.onClose).not.toHaveBeenCalled();
    });

    it('hides create, menu and drag without onOptionsChange', () => {
      openSelect(null, { onOptionsChange: undefined });
      typeSearch('zzz');

      expect(editorRoot()?.querySelector('[data-blok-database-select-create]')).toBeNull();
      typeSearch('');
      expect(editorRoot()?.querySelector('[data-blok-database-select-option-menu]')).toBeNull();
      expect(editorRoot()?.querySelector('[data-blok-database-select-option-handle]')).toBeNull();
    });
  });

  describe('drag reorder', () => {
    const stubRows = (): void => {
      ['o1', 'o2', 'o3'].forEach((id, index) => {
        vi.spyOn(row(id), 'getBoundingClientRect').mockReturnValue(new DOMRect(0, index * 28, 200, 28));
      });
    };

    const pointer = (target: EventTarget, type: string, clientY: number): void => {
      target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientY, pointerId: 1, button: 0 }));
    };

    it('dragging the first option below the last moves it to the end', () => {
      const ctx = openSelect(null);

      stubRows();
      const handle = q('[data-blok-database-select-option="o1"] [data-blok-database-select-option-handle]');

      pointer(handle, 'pointerdown', 10);
      pointer(document, 'pointermove', 80);
      pointer(document, 'pointerup', 80);

      const moved = lastOptions(ctx).find((o) => o.id === 'o1');

      expect((moved?.position ?? '') > 'a2').toBe(true);
      expect(rowIds()).toEqual(['o2', 'o3', 'o1']);
    });

    it('does not drag while the property sorts its options by name', () => {
      const ctx = makeEditorContext({ options: OPTIONS, onOptionsChange: vi.fn() });

      openCellEditor({ ...makeProperty('select'), optionSort: 'alphabetical' }, null, makeAnchor(), ctx);
      stubRows();
      pointer(q('[data-blok-database-select-option="o1"] [data-blok-database-select-option-handle]'), 'pointerdown', 70);
      pointer(document, 'pointermove', 5);
      pointer(document, 'pointerup', 5);

      expect(ctx.onOptionsChange).not.toHaveBeenCalled();
    });

    it('dragging the last option between the first two places it there', () => {
      const ctx = openSelect(null);

      stubRows();
      const handle = q('[data-blok-database-select-option="o3"] [data-blok-database-select-option-handle]');

      pointer(handle, 'pointerdown', 66);
      pointer(document, 'pointermove', 30);
      pointer(document, 'pointerup', 30);

      const moved = lastOptions(ctx).find((o) => o.id === 'o3')?.position ?? '';

      expect(moved > 'a0' && moved < 'a1').toBe(true);
      expect(rowIds()).toEqual(['o1', 'o3', 'o2']);
    });

    it('a drop where it started changes nothing', () => {
      const ctx = openSelect(null);

      stubRows();
      const handle = q('[data-blok-database-select-option="o2"] [data-blok-database-select-option-handle]');

      pointer(handle, 'pointerdown', 40);
      pointer(document, 'pointermove', 42);
      pointer(document, 'pointerup', 42);

      expect(ctx.onOptionsChange).not.toHaveBeenCalled();
    });
  });
  it('initialText becomes the search text, so typing over a selected cell offers to create it', () => {
    openSelect('o1', { initialText: 'S' });

    expect(q<HTMLInputElement>('[data-blok-database-select-search]').value).toBe('S');
    expect(document.querySelector('[data-blok-database-select-create]')).not.toBeNull();
  });
});

// feel/findings-table T17: Notion's status popover (shots-table/11-notion-status-popover.png).
describe('status cell editor', () => {
  const STATUS: SelectOption[] = [
    { id: 'ns', label: 'Not started', color: 'gray', position: 'a0', groupId: 'todo' },
    { id: 'ip', label: 'In progress', color: 'blue', position: 'a0', groupId: 'inProgress' },
    { id: 'dn', label: 'Done', color: 'green', position: 'a0', groupId: 'complete' },
  ];
  const openStatus = (value: string | null): void => {
    openCellEditor(makeProperty('status', STATUS), value, makeAnchor(), makeEditorContext({ options: STATUS, onOptionsChange: vi.fn(), onEditProperty: vi.fn() }));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    PopoverRegistry.resetForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('opens 240 wide', () => {
    openStatus('ip');

    expect(editorRoot()?.closest<HTMLElement>('[data-blok-popover]')?.style.getPropertyValue('--width')).toBe('240px');
  });

  it('shows the current value as a status pill with a dot, and no search prompt or hint', () => {
    openStatus('ip');

    expect(q('[data-blok-database-select-chip="ip"]').getAttribute('data-status-group')).toBe('inProgress');
    expect(search().placeholder).toBe('');
    expect(editorRoot()?.querySelector('[data-blok-database-select-hint]')).toBeNull();
  });

  // notion-spec-2 §19.14: the current status has no mark in the list.
  it('draws every option as a status pill and no check on the current one', () => {
    openStatus('ip');

    expect(row('ip').querySelector('[data-blok-database-select-option-check]')).toBeNull();
    expect(row('dn').querySelector('[data-blok-database-option-pill]')?.getAttribute('data-status-group')).toBe('complete');
  });

  // notion-spec-2 §18.4: no highlight on open; ArrowDown highlights the first option and Enter picks it and closes.
  it('Enter right after opening keeps the status; ArrowDown then Enter picks the first option and closes', () => {
    const ctx = makeEditorContext({ options: STATUS, onOptionsChange: vi.fn() });

    openCellEditor(makeProperty('status', STATUS), 'ip', makeAnchor(), ctx);
    press(search(), 'Enter');
    expect(ctx.onCommit).not.toHaveBeenCalled();
    expect(ctx.onClose).not.toHaveBeenCalled();

    press(search(), 'ArrowDown');
    press(search(), 'Enter');
    expect(ctx.onCommit).toHaveBeenCalledWith('ns');
    expect(ctx.onClose).toHaveBeenCalledTimes(1);
  });

  it('ends with "Edit property" behind the sliders glyph', () => {
    openStatus('ip');

    const glyph = document.createElement('div');

    glyph.innerHTML = IconSliders;
    expect(q('[data-blok-database-select-edit-property] svg').innerHTML).toBe(glyph.querySelector('svg')?.innerHTML);
  });
});

// notion-spec-2 §4: over a row page value, hovering a status option shows its name left of the picker.
describe('status picker option hint', () => {
  const STATUS: SelectOption[] = [
    { id: 'ns', label: 'Not started', color: 'gray', position: 'a0', groupId: 'todo' },
    { id: 'ip', label: 'In progress', color: 'blue', position: 'a0', groupId: 'inProgress' },
  ];
  const hint = (): HTMLElement | null => document.querySelector(`[${DATA_ATTR.interface}="${TOOLTIP_INTERFACE_VALUE}"]`);
  const hintShown = (): boolean => hint()?.getAttribute('aria-hidden') === 'false';
  const open = (overrides: Partial<CellEditorContext>): void => {
    openCellEditor(makeProperty('status', STATUS), 'ip', makeAnchor(), makeEditorContext({ options: STATUS, onOptionsChange: vi.fn(), ...overrides }));
  };
  const hover = (id: string): HTMLElement => {
    const option = row(id);

    vi.spyOn(option, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 933, y: 241, width: 427, height: 28 }));
    option.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    option.dispatchEvent(new MouseEvent('mouseenter'));

    return option;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    PopoverRegistry.resetForTests();
    // Earlier suites empty the body under the shared tooltip.
    destroyTooltip();
  });

  afterEach(() => {
    destroyTooltip();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('names the hovered option after the hint delay, left of the picker and level with the row', () => {
    open({ coverCell: 'value' });
    hover('ns');

    vi.advanceTimersByTime(HINT_DELAY - 1);
    expect(hintShown()).toBe(false);
    vi.advanceTimersByTime(1);

    expect(hintShown()).toBe(true);
    expect(hint()?.textContent).toBe('Not started');
    expect(hint()?.getAttribute('data-blok-placement')).toBe('left');
    expect(hint()?.style.top).toBe('241px');
  });

  it('closes the hint when a press outside closes the picker', async () => {
    open({ coverCell: 'value' });
    hover('ns');
    vi.advanceTimersByTime(HINT_DELAY);
    expect(hintShown()).toBe(true);

    pressOutside();
    await vi.runAllTimersAsync();

    expect(editorRoot()).toBeNull();
    expect(hintShown()).toBe(false);
  });

  it('shows no hint in a table cell status picker', () => {
    open({});
    hover('ns');
    vi.advanceTimersByTime(HINT_DELAY);

    expect(hintShown()).toBe(false);
  });
});
