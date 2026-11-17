import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IconChevronRight } from '../../../../../src/components/icons';
import { createOptionsEditor } from '../../../../../src/tools/database/cells/options-editor';
import { createDefaultStatusSettings } from '../../../../../src/tools/database/property-values';
import { PopoverRegistry } from '../../../../../src/components/utils/popover/popover-registry';
import { PopoverDesktop } from '../../../../../src/components/utils/popover';
import type { PropertyDefinition, SelectOption } from '../../../../../src/tools/database/types';

const i18n = { t: (key: string) => key };

const selectProp = (): PropertyDefinition => ({
  id: 'p', name: 'Stage', type: 'select', position: 'a0', config: { options: [
    { id: 'o1', label: 'Idea', color: 'yellow', position: 'a0' },
    { id: 'o2', label: 'Build', color: 'blue', position: 'a1' },
    { id: 'o3', label: 'Ship', color: 'green', position: 'a2' },
  ] },
});

const statusProp = (): PropertyDefinition => ({
  id: 's', name: 'Progress', type: 'status', position: 'a0',
  status: createDefaultStatusSettings(),
  config: { options: [
    { id: 'n', label: 'Not started', color: 'gray', position: 'a0', groupId: 'todo' },
    { id: 'i', label: 'In progress', color: 'blue', position: 'a0', groupId: 'inProgress' },
    { id: 'd', label: 'Done', color: 'green', position: 'a0', groupId: 'complete' },
  ] },
});

const mount = (property: PropertyDefinition): { root: HTMLElement; onChange: ReturnType<typeof vi.fn<(options: SelectOption[]) => void>> } => {
  const onChange = vi.fn<(options: SelectOption[]) => void>();
  const root = createOptionsEditor({ property, i18n, onChange });

  document.body.appendChild(root);

  return { root, onChange };
};

const rowIds = (root: HTMLElement): string[] =>
  [...root.querySelectorAll('[data-blok-database-select-option]')].map((row) => row.getAttribute('data-blok-database-select-option') ?? '');

const optionMenu = (): HTMLElement | null =>
  document.querySelector<HTMLElement>("[data-blok-popover][data-blok-popover-opened='true'][data-blok-popover-custom-class~='blok-database-option-menu']");

const confirmAction = (name: 'confirm' | 'cancel'): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-blok-database-confirm-action="${name}"]`);

  if (el === null) throw new Error(`no ${name} button in the confirm dialog`);

  return el;
};

/** The confirm resolves a promise; its answer lands a microtask later. */
const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const last = (onChange: { mock: { calls: Array<[SelectOption[]]> } }): SelectOption[] => onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] ?? [];

const press = (target: Element, key: string): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

  target.dispatchEvent(event);

  return event;
};

describe('options editor (Edit property for select, multi-select and status)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PopoverRegistry.resetForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('lists the options in their order, without a check or a pick', () => {
    const { root } = mount(selectProp());

    expect(rowIds(root)).toEqual(['o1', 'o2', 'o3']);
    expect(root.querySelector('[data-blok-database-select-option-check]')).toBeNull();
  });

  it('adds an option from "+": a new id, a colour and the last position', () => {
    const { root, onChange } = mount(selectProp());

    root.querySelector<HTMLElement>('[data-blok-database-options-add]')?.click();
    const input = root.querySelector<HTMLInputElement>('[data-blok-database-options-add-input]');

    if (input === null) throw new Error('no add field');
    input.value = 'Review';
    press(input, 'Enter');

    const added = last(onChange).find((option) => option.label === 'Review');

    expect(added?.id).toMatch(/.+/);
    expect(added?.color).toMatch(/.+/);
    expect((added?.position ?? '') > 'a2').toBe(true);
    expect(rowIds(root)).toHaveLength(4);
  });

  it('does not add a name that already exists (any case)', () => {
    const { root, onChange } = mount(selectProp());

    root.querySelector<HTMLElement>('[data-blok-database-options-add]')?.click();
    const input = root.querySelector<HTMLInputElement>('[data-blok-database-options-add-input]');

    if (input === null) throw new Error('no add field');
    input.value = 'build';
    press(input, 'Enter');

    expect(onChange).not.toHaveBeenCalled();
  });

  // notion-spec-2 §25.6: each option row in Edit property ends with a "›", not "⋯".
  it.each([['select', selectProp], ['status', statusProp]] as const)('ends every %s option row with a "›"', (_type, make) => {
    const { root } = mount(make());
    const menus = [...root.querySelectorAll('[data-blok-database-select-option-menu]')];
    const chevron = document.createElement('div');

    chevron.innerHTML = IconChevronRight;
    expect(menus.length).toBeGreaterThan(0);
    expect(menus.every((menu) => menu.innerHTML === chevron.innerHTML)).toBe(true);
  });

  it('renames, recolours and deletes an option from its menu', () => {
    const { root, onChange } = mount(selectProp());

    root.querySelector<HTMLElement>('[data-blok-database-select-option="o2"] [data-blok-database-select-option-menu]')?.click();
    const name = optionMenu()?.querySelector<HTMLInputElement>('[data-blok-database-option-name]');

    if (name === null || name === undefined) throw new Error('no name field in the option menu');
    name.value = 'Make';
    press(name, 'Enter');
    expect(last(onChange).find((o) => o.id === 'o2')?.label).toBe('Make');

    optionMenu()?.querySelector<HTMLElement>('[data-blok-database-option-color="pink"]')?.click();
    expect(last(onChange).find((o) => o.id === 'o2')).toMatchObject({ label: 'Make', color: 'pink' });

    optionMenu()?.querySelector<HTMLElement>('[data-blok-database-option-delete]')?.click();
    optionMenu()?.querySelector<HTMLElement>('[data-blok-database-option-delete-confirm]')?.click();
    expect(last(onChange).map((o) => o.id)).toEqual(['o1', 'o3']);
    expect(rowIds(root)).toEqual(['o1', 'o3']);
    expect(optionMenu()).toBeNull();
  });

  it('Escape in the option menu closes only the menu; the list stays', () => {
    const { root } = mount(selectProp());

    root.querySelector<HTMLElement>('[data-blok-database-select-option="o2"] [data-blok-database-select-option-menu]')?.click();
    const name = optionMenu()?.querySelector<HTMLInputElement>('[data-blok-database-option-name]');

    if (name === null || name === undefined) throw new Error('no name field in the option menu');
    const event = press(name, 'Escape');

    expect(event.defaultPrevented).toBe(true);
    expect(optionMenu()).toBeNull();
    expect(rowIds(root)).toEqual(['o1', 'o2', 'o3']);
  });

  // A rename redraws the list, so the row the menu opened from is gone; a scroll in the menu around must not close it.
  it('the option menu stays open through a rename and a scroll of the list around it', () => {
    const { root } = mount(selectProp());

    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(700, 250, 292, 120));
    root.querySelector<HTMLElement>('[data-blok-database-select-option="o2"]')?.click();
    const name = optionMenu()?.querySelector<HTMLInputElement>('[data-blok-database-option-name]');

    if (name === null || name === undefined) throw new Error('no name field in the option menu');
    name.value = 'Make';
    press(name, 'Enter');
    root.dispatchEvent(new Event('scroll'));

    expect(optionMenu()).not.toBeNull();
  });

  // notion-motion.md Round 57 §2: a select option row click opens the same separate 220 menu as status,
  // right edge on the row's right (993 + 220 = 1213), name field focused. No Set as default, no Group.
  it('a click on a select option row opens a separate 220 menu, right edge on the row', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1512);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(717);
    vi.spyOn(PopoverDesktop.prototype, 'size', 'get').mockReturnValue({ width: 220, height: 418.9 });
    const { root } = mount(selectProp());
    const row = root.querySelector<HTMLElement>('[data-blok-database-select-option="o2"]');

    if (row === null) throw new Error('no row o2');
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(new DOMRect(921, 286, 292, 28));
    row.click();

    const menu = optionMenu();

    expect(menu).not.toBeNull();
    expect(root.contains(menu)).toBe(false);
    expect(parseFloat(menu?.style.left ?? '')).toBeCloseTo(1213 - 220, 1);
    expect(menu?.querySelector('[data-blok-database-option-name]')).toHaveFocus();
    expect(menu?.querySelector('[data-blok-database-option-set-default]')).toBeNull();
    expect(menu?.querySelector('[data-blok-database-option-group]')).toBeNull();
    expect(rowIds(root)).toEqual(['o1', 'o2', 'o3']);
  });

  it('drags an option to a new place', () => {
    const { root, onChange } = mount(selectProp());

    ['o1', 'o2', 'o3'].forEach((id, index) => {
      const row = root.querySelector(`[data-blok-database-select-option="${id}"]`);

      if (row !== null) vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, index * 28, 200, 28));
    });
    root.querySelector('[data-blok-database-select-option="o3"] [data-blok-database-select-option-handle]')
      ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY: 66, button: 0 }));
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: 5 }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientY: 5 }));

    expect((last(onChange).find((o) => o.id === 'o3')?.position ?? 'z') < 'a0').toBe(true);
    expect(rowIds(root)).toEqual(['o3', 'o1', 'o2']);
  });

  // notion-spec-2 §17.3: Edit property lists the options in the Sort order.
  it('lists the options alphabetically when the property sorts them so', () => {
    const { root } = mount({ ...selectProp(), optionSort: 'alphabetical' });

    expect(rowIds(root)).toEqual(['o2', 'o1', 'o3']);
  });

  it('lists the options in reverse alphabetical order when the property sorts them so', () => {
    const { root } = mount({ ...selectProp(), type: 'multiSelect', optionSort: 'reverseAlphabetical' });

    expect(rowIds(root)).toEqual(['o3', 'o1', 'o2']);
  });

  // A drop would move an option the sort puts back at once.
  it('does not drag an option while the list is sorted by name', () => {
    const { root, onChange } = mount({ ...selectProp(), optionSort: 'alphabetical' });

    ['o2', 'o1', 'o3'].forEach((id, index) => {
      const row = root.querySelector(`[data-blok-database-select-option="${id}"]`);

      if (row !== null) vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, index * 28, 200, 28));
    });
    root.querySelector('[data-blok-database-select-option="o3"] [data-blok-database-select-option-handle]')
      ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY: 66, button: 0 }));
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: 5 }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientY: 5 }));

    expect(onChange).not.toHaveBeenCalled();
  });

  describe('status', () => {
    it('shows each group with its options under it', () => {
      const { root } = mount(statusProp());
      const order = [...root.querySelectorAll('[data-blok-database-status-group-heading], [data-blok-database-select-option]')]
        .map((el) => el.getAttribute('data-blok-database-status-group-heading') ?? el.getAttribute('data-blok-database-select-option'));

      expect(order).toEqual(['todo', 'n', 'inProgress', 'i', 'complete', 'd']);
    });

    // notion-motion.md Round 10 "Edit property flyout, Status": each chip is the status pill, its dot included.
    it('draws each option as the status pill of its group', () => {
      const { root } = mount(statusProp());
      const groups = ['n', 'i', 'd'].map((id) =>
        root.querySelector(`[data-blok-database-select-option="${id}"] [data-blok-database-option-pill]`)?.getAttribute('data-status-group'));

      expect(groups).toEqual(['todo', 'inProgress', 'complete']);
    });

    it('a select option keeps the plain pill', () => {
      const { root } = mount(selectProp());

      expect(root.querySelector('[data-blok-database-option-pill]')?.hasAttribute('data-status-group')).toBe(false);
    });

    it('adds an option to the group whose "+" was pressed', () => {
      const { root, onChange } = mount(statusProp());

      root.querySelector<HTMLElement>('[data-blok-database-options-add][data-group-id="complete"]')?.click();
      const input = root.querySelector<HTMLInputElement>('[data-blok-database-options-add-input]');

      if (input === null) throw new Error('no add field');
      input.value = 'Shipped';
      press(input, 'Enter');

      expect(last(onChange).find((o) => o.label === 'Shipped')?.groupId).toBe('complete');
    });

    it('a drag into another group moves the option to that group', () => {
      const { root, onChange } = mount(statusProp());

      ['n', 'i', 'd'].forEach((id, index) => {
        const row = root.querySelector(`[data-blok-database-select-option="${id}"]`);

        if (row !== null) vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, index * 60, 200, 28));
      });
      root.querySelector('[data-blok-database-select-option="n"] [data-blok-database-select-option-handle]')
        ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY: 10, button: 0 }));
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: 100 }));
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientY: 100 }));

      expect(last(onChange).find((o) => o.id === 'n')?.groupId).toBe('inProgress');
    });

    // A passed row slides to the slot it takes, so it jumps the group heading instead of sliding over it.
    // notion-motion.md Round 57 §4 (r57-n-epdrag.raw): Done dragged up from Complete to the list top. The passed
    // "Not started" slides one row, 290 -> 318 (28 px), not into Done's slot past the group headings.
    it('a passed row slides one row (28 px), not past the headings between it and the dragged row\'s slot', () => {
      const { root } = mount(statusProp());
      const row = (id: string): HTMLElement | null => root.querySelector<HTMLElement>(`[data-blok-database-select-option="${id}"]`);

      [['n', 290], ['i', 351], ['d', 412]].forEach(([id, top]) => {
        const el = row(String(id));

        if (el !== null) vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, Number(top), 292, 28));
      });
      row('d')?.querySelector('[data-blok-database-select-option-handle]')
        ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY: 426, button: 0 }));
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: 280 }));

      expect(row('n')?.style.transform).toBe('translateY(28px)');
      expect(row('i')?.style.transform).toBe('translateY(28px)');
      expect(row('d')?.style.transform).toBe('translateY(-122px)');
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientY: 280 }));
      // Where it lands is unchanged: the top of the list, in the first group.
      expect(rowIds(root)).toEqual(['d', 'n', 'i']);
    });

    // notion-motion.md Round 56 §5 "Status option menu": a click on the option row opens a separate 220 menu,
    // its right edge on the row's right; rows Delete, Set as default, Group › "In progress", then Colors.
    describe('the status option menu', () => {
      const flyout = (): HTMLElement | null =>
        document.querySelector<HTMLElement>("[data-blok-popover][data-blok-popover-opened='true'][data-blok-popover-custom-class~='blok-database-option-menu']");
      const inFlyout = <T extends Element = HTMLElement>(selector: string): T => {
        const el = flyout()?.querySelector<T>(selector);

        if (el === null || el === undefined) throw new Error(`missing ${selector} in the option menu`);

        return el;
      };
      const groupMenu = (): HTMLElement | null =>
        document.querySelector<HTMLElement>("[data-blok-popover][data-blok-popover-opened='true'][data-blok-popover-custom-class~='blok-database-option-group-menu']");
      const optionRow = (root: HTMLElement, id: string): HTMLElement => {
        const row = root.querySelector<HTMLElement>(`[data-blok-database-select-option="${id}"]`);

        if (row === null) throw new Error(`no row ${id}`);

        return row;
      };
      const mountStatus = (extra: { hold?: () => () => void; onHostClose?: (close: () => void) => void } = {}): { root: HTMLElement; onChange: ReturnType<typeof vi.fn<(options: SelectOption[]) => void>> } => {
        const onChange = vi.fn<(options: SelectOption[]) => void>();
        const root = createOptionsEditor({ property: statusProp(), i18n, onChange, onSetDefault: vi.fn(), ...extra });

        document.body.appendChild(root);

        return { root, onChange };
      };

      afterEach(() => {
        [1, 2, 3].forEach(() => press(document.body, 'Escape'));
      });

      it('a click on the option row opens a separate 220 menu and keeps the list in place', () => {
        const { root } = mountStatus();

        optionRow(root, 'i').click();

        expect(flyout()).not.toBeNull();
        expect(flyout()?.style.getPropertyValue('--width')).toBe('220px');
        expect(root.contains(flyout())).toBe(false);
        expect(rowIds(root)).toEqual(['n', 'i', 'd']);
        expect(inFlyout('[data-blok-database-option-name]')).toHaveFocus();
      });

      it('lines its right edge up with the row\'s right', () => {
        vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1512);
        vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(717);
        vi.spyOn(PopoverDesktop.prototype, 'size', 'get').mockReturnValue({ width: 220, height: 476.9 });
        const { root } = mountStatus();

        vi.spyOn(optionRow(root, 'i'), 'getBoundingClientRect').mockReturnValue(new DOMRect(1200, 200, 292, 28));
        optionRow(root, 'i').click();

        expect(parseFloat(flyout()?.style.left ?? '')).toBeCloseTo(1492 - 220, 1);
      });

      it('reads name, Delete, Set as default, Group with the current group, then the colours', () => {
        const { root } = mountStatus();

        optionRow(root, 'i').click();
        const panel = inFlyout('[data-blok-database-option-panel]');
        const order = [...panel.children].map((el) => [...el.attributes].map((a) => a.name).find((n) => n.startsWith('data-blok-database-option-')) ?? el.getAttribute('role'));

        expect(order).toEqual([
          'data-blok-database-option-name',
          'data-blok-database-option-delete',
          'data-blok-database-option-set-default',
          'data-blok-database-option-group',
          'data-blok-database-option-colors-heading',
          'menu',
        ]);
        expect(inFlyout('[data-blok-database-option-group]').textContent).toContain('tools.database.groupStatusGroup');
        expect(inFlyout('[data-blok-database-option-group-value]').textContent).toBe('In progress');
      });

      it('Group › moves the option to the group picked there', () => {
        const { root, onChange } = mountStatus();

        optionRow(root, 'n').click();
        inFlyout('[data-blok-database-option-group]').click();
        const menu = groupMenu();

        expect(menu).not.toBeNull();
        expect(menu?.querySelector('[data-blok-database-option-group-pick="todo"]')?.getAttribute('aria-checked')).toBe('true');
        menu?.querySelector<HTMLElement>('[data-blok-database-option-group-pick="complete"]')?.click();

        expect(last(onChange).find((o) => o.id === 'n')?.groupId).toBe('complete');
        const order = [...root.querySelectorAll('[data-blok-database-status-group-heading], [data-blok-database-select-option]')]
          .map((el) => el.getAttribute('data-blok-database-status-group-heading') ?? el.getAttribute('data-blok-database-select-option'));

        // notion-motion.md Round 57 §4: the moved option lands at the top of its new group.
        expect(order).toEqual(['todo', 'inProgress', 'i', 'complete', 'n', 'd']);
        expect(groupMenu()).toBeNull();
        expect(inFlyout('[data-blok-database-option-group-value]').textContent).toBe('Complete');
      });

      // notion-motion.md Round 57 §4: Group › opens a 250x94 menu right-aligned on the Group row (right 1109),
      // its top on the row's bottom; the first row is filled on open.
      it('Group › opens a 250 menu under the Group row, right edges lined up, first row focused', () => {
        vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1512);
        vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(717);
        const { root } = mountStatus();

        optionRow(root, 'i').click();
        const groupRow = inFlyout('[data-blok-database-option-group]');

        vi.spyOn(groupRow, 'getBoundingClientRect').mockReturnValue(new DOMRect(897, 338, 212, 28));
        vi.spyOn(PopoverDesktop.prototype, 'size', 'get').mockReturnValue({ width: 250, height: 94 });
        groupRow.click();
        const menu = groupMenu();

        expect(menu?.style.getPropertyValue('--width')).toBe('250px');
        expect(parseFloat(menu?.style.left ?? '')).toBeCloseTo(1109 - 250, 1);
        expect(parseFloat(menu?.style.top ?? '')).toBeCloseTo(366, 1);
        expect(menu?.querySelector('[data-blok-database-option-group-pick="todo"]')).toHaveFocus();
      });

      it('the › button opens the same menu', () => {
        const { root } = mountStatus();

        optionRow(root, 'i').querySelector<HTMLElement>('[data-blok-database-select-option-menu]')?.click();

        expect(flyout()).not.toBeNull();
      });

      it('Escape closes only the menu, and the list stays', () => {
        const { root } = mountStatus();

        optionRow(root, 'i').click();
        press(inFlyout('[data-blok-database-option-name]'), 'Escape');

        expect(flyout()).toBeNull();
        expect(rowIds(root)).toEqual(['n', 'i', 'd']);
      });

      it('holds the menu around the list while open and lets it go on close', () => {
        const release = vi.fn();
        const hold = vi.fn(() => release);
        const { root } = mountStatus({ hold });

        optionRow(root, 'i').click();
        expect(hold).toHaveBeenCalledTimes(1);
        expect(release).not.toHaveBeenCalled();
        press(inFlyout('[data-blok-database-option-name]'), 'Escape');
        expect(release).toHaveBeenCalledTimes(1);
      });

      it('closes when the menu around the list closes', () => {
        const closers: Array<() => void> = [];
        const { root } = mountStatus({ onHostClose: (close) => closers.push(close) });

        optionRow(root, 'i').click();
        closers.forEach((close) => close());

        expect(flyout()).toBeNull();
      });

      it('dragging by the handle opens no menu', () => {
        const { root } = mountStatus();

        optionRow(root, 'i').querySelector<HTMLElement>('[data-blok-database-select-option-handle]')?.click();

        expect(flyout()).toBeNull();
      });
    });

    // research/30 §10f, shot 23: the option menu reads Delete, Set as default, then the colours.
    describe('the default option', () => {
      const colourless = (): PropertyDefinition => {
        const property = statusProp();

        return {
          ...property,
          status: { ...createDefaultStatusSettings(), defaultOptionId: 'n' },
          config: { options: (property.config?.options ?? []).map(({ color, ...option }) => (option.id === 'n' ? option : { ...option, color })) },
        };
      };
      const openPanel = (root: HTMLElement, id: string): void =>
        root.querySelector<HTMLElement>(`[data-blok-database-select-option="${id}"] [data-blok-database-select-option-menu]`)?.click();

      it('marks the default option "Default" in the list; no other option is marked', () => {
        const root = createOptionsEditor({ property: colourless(), i18n, onChange: vi.fn(), onSetDefault: vi.fn() });

        expect(root.querySelector('[data-blok-database-select-option="n"] [data-blok-database-option-default]')?.textContent).toBe('tools.database.templateDefault');
        expect(root.querySelectorAll('[data-blok-database-option-default]')).toHaveLength(1);
      });

      it('a colourless status option draws the gray pill, and its colour menu checks no colour', () => {
        const root = createOptionsEditor({ property: colourless(), i18n, onChange: vi.fn(), onSetDefault: vi.fn() });

        expect(root.querySelector('[data-blok-database-select-option="n"] [data-blok-database-option-pill]')?.getAttribute('data-color')).toBe('gray');
        openPanel(root, 'n');
        expect(document.querySelectorAll('[data-blok-database-option-color]')).toHaveLength(10);
        expect(document.querySelectorAll('[data-blok-database-option-color][aria-checked="true"]')).toHaveLength(0);
        expect(document.querySelector('[data-blok-database-option-color] [data-blok-database-select-option-check]')).toBeNull();
      });

      it('renaming a colourless option keeps it colourless: the gray it draws is never saved', () => {
        const onChange = vi.fn<(options: SelectOption[]) => void>();
        const root = createOptionsEditor({ property: colourless(), i18n, onChange, onSetDefault: vi.fn() });

        openPanel(root, 'n');
        const name = document.querySelector<HTMLInputElement>('[data-blok-database-option-name]');

        if (name === null) throw new Error('no name field');
        name.value = 'Backlog';
        press(name, 'Enter');
        expect(last(onChange).find((o) => o.id === 'n')).toEqual({ id: 'n', label: 'Backlog', position: 'a0', groupId: 'todo' });
      });

      it('"Set as default" sits right after Delete and, once confirmed, makes that option the default', async () => {
        const onSetDefault = vi.fn();
        const root = createOptionsEditor({ property: colourless(), i18n, onChange: vi.fn(), onSetDefault });

        document.body.appendChild(root);
        openPanel(root, 'i');
        const row = document.querySelector<HTMLElement>('[data-blok-database-option-set-default]');

        expect(row?.previousElementSibling?.hasAttribute('data-blok-database-option-delete')).toBe(true);
        expect(row?.textContent?.trim()).toBe('tools.database.templateSetDefault');
        row?.click();
        confirmAction('confirm').click();
        await settle();
        expect(onSetDefault).toHaveBeenCalledWith('i');
        expect(root.querySelector('[data-blok-database-select-option="i"] [data-blok-database-option-default]')).not.toBeNull();
        expect(root.querySelector('[data-blok-database-select-option="n"] [data-blok-database-option-default]')).toBeNull();
      });

      // notion-motion.md Round 57 §4: Set as default asks first: "Change default to “In progress”?", a body line,
      // Continue (focused) then Cancel, 406 wide. Escape closes only the dialog; Continue closes the option menu.
      describe('the Set as default confirm', () => {
        const interpolating = { t: (key: string, params?: Record<string, string | number>) => `${key}${params === undefined ? '' : JSON.stringify(params)}` };
        const openConfirm = (onSetDefault: (id: string) => void): HTMLElement => {
          const root = createOptionsEditor({ property: colourless(), i18n: interpolating, onChange: vi.fn(), onSetDefault });

          document.body.appendChild(root);
          openPanel(root, 'i');
          document.querySelector<HTMLElement>('[data-blok-database-option-set-default]')?.click();

          return root;
        };

        // A menu left open keeps its window Escape listener, which would take the next test's Escape.
        afterEach(async () => {
          await settle();
          [1, 2, 3].forEach(() => press(document.body, 'Escape'));
        });

        it('asks with the option\'s name, Continue focused, before anything changes', () => {
          const onSetDefault = vi.fn();

          openConfirm(onSetDefault);
          const dialog = document.querySelector<HTMLElement>('[data-blok-database-confirm-dialog]');

          expect(onSetDefault).not.toHaveBeenCalled();
          expect(dialog?.querySelector('[data-blok-database-confirm-title]')?.textContent).toBe('tools.database.statusDefaultConfirm{"name":"In progress"}');
          expect(dialog?.querySelector('[data-blok-database-confirm-description]')?.textContent).toBe('tools.database.statusDefaultConfirmDescription{"name":"In progress"}');
          expect(dialog?.hasAttribute('data-roomy')).toBe(true);
          expect(confirmAction('confirm').textContent).toBe('tools.database.buttonConfirmContinue');
          expect(confirmAction('cancel').textContent).toBe('tools.database.layoutCancel');
          expect(confirmAction('confirm')).toHaveFocus();
          expect(optionMenu()).not.toBeNull();
          confirmAction('cancel').click();
        });

        it('Escape closes only the dialog: the option menu stays and nothing changes', async () => {
          const onSetDefault = vi.fn();

          openConfirm(onSetDefault);
          press(confirmAction('confirm'), 'Escape');
          await settle();

          expect(document.querySelector('[data-blok-database-confirm-dialog]')).toBeNull();
          expect(optionMenu()).not.toBeNull();
          expect(onSetDefault).not.toHaveBeenCalled();
        });

        it('Cancel keeps the option menu open and changes nothing', async () => {
          const onSetDefault = vi.fn();

          openConfirm(onSetDefault);
          confirmAction('cancel').click();
          await settle();

          expect(optionMenu()).not.toBeNull();
          expect(onSetDefault).not.toHaveBeenCalled();
        });

        it('Continue sets the default and closes the option menu; the list stays', async () => {
          const onSetDefault = vi.fn();
          const root = openConfirm(onSetDefault);

          confirmAction('confirm').click();
          await settle();

          expect(onSetDefault).toHaveBeenCalledWith('i');
          expect(optionMenu()).toBeNull();
          expect(root.isConnected).toBe(true);
          expect(root.querySelector('[data-blok-database-select-option="i"] [data-blok-database-option-default]')).not.toBeNull();
        });
      });

      it('the current default keeps the row, as measured; a click there changes nothing', () => {
        const onSetDefault = vi.fn();
        const root = createOptionsEditor({ property: colourless(), i18n, onChange: vi.fn(), onSetDefault });

        openPanel(root, 'n');
        document.querySelector<HTMLElement>('[data-blok-database-option-set-default]')?.click();
        expect(onSetDefault).not.toHaveBeenCalled();
      });

      it('a select option has no "Set as default" row', () => {
        const root = createOptionsEditor({ property: selectProp(), i18n, onChange: vi.fn(), onSetDefault: vi.fn() });

        openPanel(root, 'o1');
        expect(optionMenu()?.querySelector('[data-blok-database-option-name]')).toBeTruthy();
        expect(optionMenu()?.querySelector('[data-blok-database-option-set-default]')).toBeNull();
      });
    });
  });
});
