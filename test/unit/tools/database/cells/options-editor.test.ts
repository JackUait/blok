import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IconChevronRight } from '../../../../../src/components/icons';
import { createOptionsEditor } from '../../../../../src/tools/database/cells/options-editor';
import { createDefaultStatusSettings } from '../../../../../src/tools/database/property-values';
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

const last = (onChange: { mock: { calls: Array<[SelectOption[]]> } }): SelectOption[] => onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] ?? [];

const press = (target: Element, key: string): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

  target.dispatchEvent(event);

  return event;
};

describe('options editor (Edit property for select, multi-select and status)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('renames, recolours and deletes an option from its ⋯ panel', () => {
    const { root, onChange } = mount(selectProp());

    root.querySelector<HTMLElement>('[data-blok-database-select-option="o2"] [data-blok-database-select-option-menu]')?.click();
    const name = root.querySelector<HTMLInputElement>('[data-blok-database-option-name]');

    if (name === null) throw new Error('no name field');
    name.value = 'Make';
    press(name, 'Enter');
    expect(last(onChange).find((o) => o.id === 'o2')?.label).toBe('Make');

    root.querySelector<HTMLElement>('[data-blok-database-option-color="pink"]')?.click();
    expect(last(onChange).find((o) => o.id === 'o2')).toMatchObject({ label: 'Make', color: 'pink' });

    root.querySelector<HTMLElement>('[data-blok-database-option-delete]')?.click();
    root.querySelector<HTMLElement>('[data-blok-database-option-delete-confirm]')?.click();
    expect(last(onChange).map((o) => o.id)).toEqual(['o1', 'o3']);
    expect(rowIds(root)).toEqual(['o1', 'o3']);
  });

  it('Escape in the ⋯ panel goes back to the list and stops there', () => {
    const { root } = mount(selectProp());

    root.querySelector<HTMLElement>('[data-blok-database-select-option="o2"] [data-blok-database-select-option-menu]')?.click();
    const name = root.querySelector<HTMLInputElement>('[data-blok-database-option-name]');

    if (name === null) throw new Error('no name field');
    const event = press(name, 'Escape');

    expect(event.defaultPrevented).toBe(true);
    expect(rowIds(root)).toEqual(['o1', 'o2', 'o3']);
    expect(root.querySelector('[data-blok-database-option-panel]')).toBeNull();
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
        expect(root.querySelectorAll('[data-blok-database-option-color][aria-checked="true"]')).toHaveLength(0);
        expect(root.querySelector('[data-blok-database-option-color] [data-blok-database-select-option-check]')).toBeNull();
      });

      it('renaming a colourless option keeps it colourless: the gray it draws is never saved', () => {
        const onChange = vi.fn<(options: SelectOption[]) => void>();
        const root = createOptionsEditor({ property: colourless(), i18n, onChange, onSetDefault: vi.fn() });

        openPanel(root, 'n');
        const name = root.querySelector<HTMLInputElement>('[data-blok-database-option-name]');

        if (name === null) throw new Error('no name field');
        name.value = 'Backlog';
        press(name, 'Enter');
        expect(last(onChange).find((o) => o.id === 'n')).toEqual({ id: 'n', label: 'Backlog', position: 'a0', groupId: 'todo' });
      });

      it('"Set as default" sits right after Delete and makes that option the default', () => {
        const onSetDefault = vi.fn();
        const root = createOptionsEditor({ property: colourless(), i18n, onChange: vi.fn(), onSetDefault });

        openPanel(root, 'i');
        const row = root.querySelector<HTMLElement>('[data-blok-database-option-set-default]');

        expect(row?.previousElementSibling?.hasAttribute('data-blok-database-option-delete')).toBe(true);
        expect(row?.textContent?.trim()).toBe('tools.database.templateSetDefault');
        row?.click();
        expect(onSetDefault).toHaveBeenCalledWith('i');
        expect(root.querySelector('[data-blok-database-select-option="i"] [data-blok-database-option-default]')).not.toBeNull();
        expect(root.querySelector('[data-blok-database-select-option="n"] [data-blok-database-option-default]')).toBeNull();
      });

      it('the current default keeps the row, as measured; a click there changes nothing', () => {
        const onSetDefault = vi.fn();
        const root = createOptionsEditor({ property: colourless(), i18n, onChange: vi.fn(), onSetDefault });

        openPanel(root, 'n');
        root.querySelector<HTMLElement>('[data-blok-database-option-set-default]')?.click();
        expect(onSetDefault).not.toHaveBeenCalled();
      });

      it('a select option has no "Set as default" row', () => {
        const root = createOptionsEditor({ property: selectProp(), i18n, onChange: vi.fn(), onSetDefault: vi.fn() });

        openPanel(root, 'o1');
        expect(root.querySelector('[data-blok-database-option-set-default]')).toBeNull();
      });
    });
  });
});
