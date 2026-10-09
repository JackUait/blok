import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { openCellEditor } from '../../../../../src/tools/database/cells';
import type { CellEditorContext } from '../../../../../src/tools/database/cells/types';
import { PopoverRegistry } from '../../../../../src/components/utils/popover/popover-registry';
import type { SelectOption } from '../../../../../src/tools/database/types';
import { editorRoot, makeAnchor, makeEditorContext, makeProperty, press } from './helpers';

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

  it('lists options in position order and marks the selected one with a check', () => {
    openSelect('o2');

    expect(rowIds()).toEqual(['o1', 'o2', 'o3']);
    expect(row('o2').getAttribute('aria-selected')).toBe('true');
    expect(row('o2').querySelector('[data-blok-database-select-option-check]')).not.toBeNull();
    expect(row('o1').getAttribute('aria-selected')).toBe('false');
    expect(row('o1').querySelector('[data-blok-database-select-option-check]')).toBeNull();
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
});
