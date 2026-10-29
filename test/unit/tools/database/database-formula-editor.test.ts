import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openFormulaEditor } from '../../../../src/tools/database/database-formula-editor';
import type { FormulaEditorOptions } from '../../../../src/tools/database/database-formula-editor';
import { compileFormula } from '../../../../src/tools/database/formula';
import type { PropertyDefinition } from '../../../../src/tools/database/types';
import { pressOutside } from './cells/helpers';

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'amount', name: 'Amount', type: 'number', position: 'a1' },
  { id: 'fx', name: 'Double', type: 'formula', position: 'a2', formula: { expression: '{{property:amount}} * 2' } },
];

const t = (key: string, vars?: Record<string, string | number>): string =>
  vars === undefined ? key : `${key}(${Object.entries(vars).map(([k, v]) => `${k}=${String(v)}`).join(',')})`;

const anchor = (): HTMLElement => {
  const el = document.createElement('button');

  document.body.appendChild(el);

  return el;
};

const open = (overrides: Partial<FormulaEditorOptions> = {}): FormulaEditorOptions => {
  const options: FormulaEditorOptions = {
    i18n: { t },
    property: schema[2],
    schema,
    compile: (source) => compileFormula(source, schema),
    preview: (source) => {
      const compiled = compileFormula(source, schema);

      return compiled.ok ? '6' : null;
    },
    onSave: vi.fn(),
    ...overrides,
  };

  openFormulaEditor(anchor(), options);

  return options;
};

const input = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('[data-blok-database-formula-input]');

  if (el === null) throw new Error('no input');

  return el;
};

/** Puts the caret at the end of the field, as after typing. */
const caretAtEnd = (): void => {
  const range = document.createRange();

  range.selectNodeContents(input());
  range.collapse(false);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
};

const type = (text: string): void => {
  input().textContent = text;
  caretAtEnd();
  input().dispatchEvent(new Event('input'));
};

const tokens = (): Array<string | null> =>
  [...input().querySelectorAll('[data-blok-database-formula-token]')].map((el) => el.getAttribute('data-property'));

const enter = (): void => {
  input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
};

const text = (selector: string): string => document.querySelector(selector)?.textContent?.trim() ?? '';

describe('formula editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  // notion-spec-2 §22.5, `formula-editor.png`: a property reference shows as a "# Number" token.
  it('shows the stored formula with its property as a token', () => {
    open();

    expect(tokens()).toEqual(['Amount']);
    expect(input().querySelector('[data-blok-database-formula-token]')?.getAttribute('contenteditable')).toBe('false');
    expect(input().lastChild?.textContent).toBe(' * 2');
  });

  it('is a labelled multi-line text box', () => {
    open();

    expect(input().getAttribute('role')).toBe('textbox');
    expect(input().getAttribute('aria-multiline')).toBe('true');
    expect(input().getAttribute('aria-label')).toBe('tools.database.formulaLabel');
  });

  describe('tokens', () => {
    it('turns a typed prop("Name") into a token and saves it by id', () => {
      const options = open();

      type('prop("Amount") + 1');
      expect(tokens()).toEqual(['Amount']);
      enter();

      expect(options.onSave).toHaveBeenCalledWith('{{property:amount}} + 1');
    });

    it('leaves an unknown property as text', () => {
      open();
      type('prop("Nope") + 1');

      expect(tokens()).toEqual([]);
    });

    it('leaves current.prop("Name") of a related page as text', () => {
      open();
      type('current.prop("Amount")');

      expect(tokens()).toEqual([]);
    });

    it('Backspace right after a token removes it whole', () => {
      const options = open();

      type('1 + prop("Amount")');
      caretAtEnd();
      const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });

      input().dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(tokens()).toEqual([]);
      expect(input().textContent).toBe('1 + ');
      expect(options.onSave).not.toHaveBeenCalled();
    });

    // The box rewrites its own DOM, so the browser's undo has nothing to go back to: it keeps its own.
    it('undoes and redoes its own edits with Cmd+Z and Cmd+Shift+Z, not the document undo', () => {
      open();
      type('prop("Amount")');
      document.querySelector<HTMLElement>('[data-blok-database-formula-reference-item][data-name="*"]')?.click();
      expect(input().lastChild?.textContent).toBe(' * ');

      const undo = new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true });

      input().dispatchEvent(undo);
      expect(undo.defaultPrevented).toBe(true);
      expect(tokens()).toEqual(['Amount']);
      expect(input().childNodes).toHaveLength(1);

      input().dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
      expect(input().lastChild?.textContent).toBe(' * ');
    });

    it('pastes plain text, turning references into tokens', () => {
      const options = open();

      type('');
      const paste = new Event('paste', { bubbles: true, cancelable: true });

      Object.defineProperty(paste, 'clipboardData', { value: { getData: (kind: string) => (kind === 'text/plain' ? 'prop("Amount") - 1' : '<b>x</b>') } });
      input().dispatchEvent(paste);

      expect(paste.defaultPrevented).toBe(true);
      expect(tokens()).toEqual(['Amount']);
      enter();
      expect(options.onSave).toHaveBeenCalledWith('{{property:amount}} - 1');
    });
  });

  it('previews the result while typing', () => {
    open();
    type('prop("Amount") * 3');

    expect(text('[data-blok-database-formula-preview]')).toBe('6');
  });

  it('shows a compile error through i18n, with the source it points at', () => {
    open();
    type('prop("Nope") + 1');

    expect(text('[data-blok-database-formula-error-message]')).toBe('tools.database.formula.error.unknownProperty(name=Nope)');
    expect(text('[data-blok-database-formula-error-range]')).toBe('prop("Nope")');
    expect(input().getAttribute('aria-invalid')).toBe('true');
  });

  it('shows a formula nested past the limit as an error, not a crash', () => {
    open();
    type(`${'('.repeat(100000)}1`);

    expect(text('[data-blok-database-formula-error-message]')).toBe('tools.database.formula.error.tooComplex(length=10000,depth=64)');
    expect(input().getAttribute('aria-invalid')).toBe('true');
  });

  it('saves the formula with property ids on Enter', () => {
    const options = open();

    type('prop("Amount") + 1');
    enter();

    expect(options.onSave).toHaveBeenCalledWith('{{property:amount}} + 1');
  });

  it('does not save a formula that fails to compile', () => {
    const options = open();

    type('1 +');
    enter();

    expect(options.onSave).not.toHaveBeenCalled();
  });

  // notion-spec-2 §18.3: the box is 740 wide and opens with the title "Edit formula" and a close ×.
  describe('box', () => {
    it('is 740 wide', () => {
      open();
      const popover = document.querySelector<HTMLElement>('[data-blok-popover]');

      expect(popover?.style.getPropertyValue('--width')).toBe('740px');
    });

    // §18.3: the 541-tall box sat above its row, bottom at window − 12: it is clamped like a cell editor.
    it('is placed as a covering cell editor, kept inside the window', () => {
      open();

      expect(document.querySelector('[data-blok-popover]')?.getAttribute('data-blok-popover-custom-class'))
        .toContain('blok-database-table-cell-editor');
    });

    it('heads the box with "Edit formula"', () => {
      open();

      expect(text('[data-blok-database-formula-title]')).toBe('tools.database.editFormula');
    });

    it('closes from the ×, saving a changed formula as Escape does', () => {
      const options = open();

      type('prop("Amount") + 1');
      expect(document.querySelector('[data-blok-database-formula-close]')?.getAttribute('aria-label')).toBe('tools.database.close');
      document.querySelector<HTMLButtonElement>('[data-blok-database-formula-close]')?.click();

      expect(options.onSave).toHaveBeenCalledWith('{{property:amount}} + 1');
      expect(document.querySelector('[data-blok-database-formula-editor]')).toBeNull();
    });
  });

  // notion-spec-2 §25.1: no Done or Save button in any state.
  it('has no Done button', () => {
    open();
    type('prop("Amount") + 1');

    expect(document.querySelector('[data-blok-database-formula-done]')).toBeNull();
  });

  // notion-spec-2 §25.1 (40-discard-hover.png, 41-after-discard.png).
  describe('Discard all changes', () => {
    const discard = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>('[data-blok-database-formula-discard]');

    it('shows in the title row only while a change is unsaved', () => {
      open();
      expect(discard()).toBeNull();

      type('prop("Amount") + 1');
      expect(discard()?.textContent).toBe('tools.database.formulaDiscard');
      expect(discard()?.parentElement?.hasAttribute('data-blok-database-formula-head')).toBe(true);

      type('prop("Amount") * 2');
      expect(discard()).toBeNull();
    });

    it('restores the saved formula and keeps the box open', () => {
      const options = open();

      type('prop("Amount") + 1');
      discard()?.click();

      expect(tokens()).toEqual(['Amount']);
      expect(input().lastChild?.textContent).toBe(' * 2');
      expect(discard()).toBeNull();
      expect(document.querySelector('[data-blok-database-formula-editor]')).not.toBeNull();
      input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(options.onSave).not.toHaveBeenCalled();
    });
  });

  // notion-spec-2 §25.1 (34-debug-on.png, debug-on.txt): a switch at the end of the preview line.
  describe('Debug mode', () => {
    const debug = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>('[data-blok-database-formula-debug]');

    it('is an off switch labelled "Debug mode"', () => {
      open();

      expect(debug()?.getAttribute('role')).toBe('switch');
      expect(debug()?.getAttribute('aria-checked')).toBe('false');
      expect(debug()?.textContent).toBe('tools.database.formulaDebugMode');
    });

    it('on, it tags a number result "num"', () => {
      open();
      type('prop("Amount") * 3');
      debug()?.click();

      expect(debug()?.getAttribute('aria-checked')).toBe('true');
      expect(document.querySelector('[data-blok-database-formula-result]')?.hasAttribute('data-debug')).toBe(true);
      expect(text('[data-blok-database-formula-debug-type]')).toBe('num');
    });

    // Only Notion's number tag is measured.
    it('draws no tag for other results, and none while off', () => {
      open();
      type('prop("Amount") * 3');
      expect(document.querySelector('[data-blok-database-formula-debug-type]')).toBeNull();

      debug()?.click();
      type('prop("Amount") > 3');
      expect(document.querySelector('[data-blok-database-formula-debug-type]')).toBeNull();
    });
  });

  // notion-spec-2 §18.3: Escape saves the typed formula and closes.
  describe('Escape', () => {
    const escape = (): void => {
      input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    };

    it('saves a changed formula and closes', () => {
      const options = open();

      type('prop("Amount") + 1');
      escape();

      expect(options.onSave).toHaveBeenCalledWith('{{property:amount}} + 1');
      expect(document.querySelector('[data-blok-database-formula-editor]')).toBeNull();
    });

    it('writes nothing when the formula is unchanged', () => {
      const options = open();

      escape();

      expect(options.onSave).not.toHaveBeenCalled();
      expect(document.querySelector('[data-blok-database-formula-editor]')).toBeNull();
    });

    it('closes without saving a formula that fails to compile', () => {
      const options = open();

      type('1 +');
      escape();

      expect(options.onSave).not.toHaveBeenCalled();
      expect(document.querySelector('[data-blok-database-formula-editor]')).toBeNull();
    });
  });

  // notion-spec-2 §25.1 (39-after-outside.png): a click outside keeps the typed formula.
  describe('click outside', () => {
    it('saves a changed formula and closes', async () => {
      const options = open();

      type('prop("Amount") + 1');
      pressOutside();
      await Promise.resolve();

      expect(options.onSave).toHaveBeenCalledWith('{{property:amount}} + 1');
      expect(document.querySelector('[data-blok-database-formula-editor]')).toBeNull();
    });

    it('closes without saving a formula that fails to compile', async () => {
      const options = open();

      type('1 +');
      pressOutside();
      await Promise.resolve();

      expect(options.onSave).not.toHaveBeenCalled();
    });
  });

  it('puts a new line on Shift+Enter', () => {
    const options = open();

    type('1 +');
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
    // A trailing newline needs a <br> after it, or the browser draws no line and the caret falls back.
    expect(input().lastElementChild?.hasAttribute('data-blok-database-formula-line-end')).toBe(true);
    input().append('2');
    input().dispatchEvent(new Event('input'));

    expect(options.onSave).not.toHaveBeenCalled();
    enter();
    expect(options.onSave).toHaveBeenCalledWith('1 +\n2');
  });

  it('lists properties and functions, filtered by the word being typed', () => {
    open();
    type('dateA');
    const names = [...document.querySelectorAll('[data-blok-database-formula-reference-item]')].map((el) => el.getAttribute('data-name'));

    expect(names).toEqual(['dateAdd()']);
  });

  it('inserts a property reference from the list', () => {
    open();
    type('');
    document.querySelector<HTMLElement>('[data-blok-database-formula-reference-item][data-name="prop:Amount"]')?.click();

    expect(tokens()).toEqual(['Amount']);
  });

  // notion-spec-2 §18.3, `formula-editor.png`: with the caret after `* 2` the list still shows Built-ins.
  it('keeps the list when the caret sits after a number', () => {
    open();
    type('prop("Amount") * 2');

    expect(document.querySelectorAll('[data-blok-database-formula-reference-item]').length).toBeGreaterThan(0);
  });

  const labels = (): Array<string | null> =>
    [...document.querySelectorAll('[data-blok-database-formula-reference-label]')].map((el) => el.textContent);
  const items = (): Array<string | null> =>
    [...document.querySelectorAll('[data-blok-database-formula-reference-item]')].map((el) => el.getAttribute('data-name'));

  // notion-spec-2 §25.1 (32-formula-typed.png): after an operand the list starts at Built-ins, with the operators that fit.
  it('starts at Built-ins with the ten operators after a number', () => {
    open();
    type('prop("Amount") * 2');

    expect(labels()[0]).toBe('tools.database.formulaBuiltIns');
    expect(labels()).not.toContain('tools.database.propertiesSection');
    expect(items().slice(0, 10)).toEqual(['*', '/', '+', '-', '>', '>=', '<', '<=', '==', '!=']);
    expect(items()).not.toContain('%');
    expect(items()).not.toContain('^');
    expect(document.querySelector('[data-blok-database-formula-reference-item][aria-selected="true"]')?.getAttribute('data-name')).toBe('*');
  });

  // notion-spec-2 §25.1 (`formula-typed.txt`): then only the functions a number fits, under their group headings.
  it('follows the operators with the functions that take a number, by group', () => {
    open();
    type('prop("Amount") * 2');

    expect(labels()).toEqual([
      'tools.database.formulaBuiltIns',
      'tools.database.formulaGroupGeneral',
      'tools.database.propertyTypeNumber',
      'tools.database.propertyTypeDate',
    ]);
    expect(items().slice(10, 17)).toEqual(['and()', 'or()', 'not()', 'empty()', 'format()', 'equal()', 'unequal()']);
    expect(items()[17]).toBe('formatNumber()');
    expect(items()).toContain('fromTimestamp()');
    expect(items()).not.toContain('pi()');
    expect(items()).not.toContain('upper()');
  });

  // notion-spec-2 §25.1 (37-reopen-saved.png): a saved formula reopens at Built-ins.
  it('reopens a saved formula at Built-ins', () => {
    open();

    expect(labels()[0]).toBe('tools.database.formulaBuiltIns');
    expect(labels()).not.toContain('tools.database.propertiesSection');
    expect(document.querySelector('[data-blok-database-formula-reference-item][aria-selected="true"]')?.getAttribute('data-name')).toBe('*');
  });

  // notion-spec-2 §25.1 (`formula-empty.txt`): Properties, Built-ins, then the function groups in one list.
  it('heads the empty list with Properties, Built-ins and each function group', () => {
    open();
    type('');

    expect(labels()).toEqual([
      'tools.database.propertiesSection',
      'tools.database.formulaBuiltIns',
      'tools.database.formulaGroupGeneral',
      'tools.database.propertyTypeText',
      'tools.database.propertyTypeNumber',
      'tools.database.propertyTypeDate',
      'tools.database.formulaGroupPeople',
      'tools.database.formulaGroupLists',
    ]);
  });

  // notion-spec-2 §25.1 (`formula-empty.txt`): Built-ins read not, true, false; General opens with if(), ifs().
  it('lists not, true and false as the built-ins of an empty formula', () => {
    open();
    type('');
    const builtIns = [...document.querySelectorAll('[data-blok-database-formula-reference-item="function"]')]
      .map((el) => el.getAttribute('data-name'));

    expect(builtIns.slice(0, 5)).toEqual(['not', 'true', 'false', 'if()', 'ifs()']);
    expect(builtIns).not.toContain('*');
    expect(builtIns).toContain('not()');
  });

  it('inserts true as a value and if() as an open call', () => {
    const options = open();

    type('');
    document.querySelector<HTMLElement>('[data-blok-database-formula-reference-item][data-name="if()"]')?.click();
    document.querySelector<HTMLElement>('[data-blok-database-formula-reference-item][data-name="true"]')?.click();
    input().append(', 1, 2)');
    input().dispatchEvent(new Event('input'));
    enter();

    expect(options.onSave).toHaveBeenCalledWith('if(true, 1, 2)');
  });

  it('draws each row with its type glyph', () => {
    open();
    type('');
    const glyph = (name: string): string | null | undefined =>
      document.querySelector(`[data-blok-database-formula-reference-item][data-name="${name}"] [data-blok-database-formula-reference-icon]`)?.getAttribute('data-kind');

    expect(glyph('prop:Amount')).toBe('number');
    expect(glyph('prop:Name')).toBe('title');
    expect(glyph('true')).toBe('boolean');
    type('prop("Amount") * 2');
    expect(glyph('*')).toBe('number');
    expect(glyph('>=')).toBe('boolean');
  });

  it('inserts an operator with a space on each side', () => {
    const options = open();

    type('prop("Amount")');
    document.querySelector<HTMLElement>('[data-blok-database-formula-reference-item][data-name="*"]')?.click();
    input().append('2');
    input().dispatchEvent(new Event('input'));
    enter();

    expect(options.onSave).toHaveBeenCalledWith('{{property:amount}} * 2');
  });

  // notion-spec-2 §18.3, §22.5: "Preview with <row>", the output or "No output", and "Type: <type>".
  describe('preview', () => {
    const ROWS = [{ id: 'a', title: 'Apple' }, { id: 'b', title: 'Banana' }, { id: 'c', title: 'Cherry' }];
    const rowButton = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>('[data-blok-database-formula-preview-row]');
    const picker = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-blok-database-formula-preview-picker]');
    const options = (): Element[] => [...document.querySelectorAll('[data-blok-database-formula-preview-option]')];

    it('names the row it previews with', () => {
      open({ previewRows: ROWS, previewRowId: 'b' });

      expect(text('[data-blok-database-formula-preview-label]')).toBe('tools.database.formulaPreviewWith');
      expect(text('[data-blok-database-formula-preview-row]')).toBe('Banana');
    });

    // notion-spec-2 §25.1 (31-preview-picker.png): the row is a button that opens a searchable list of rows.
    describe('row picker', () => {
      it('opens with a focused Search field, one row per database row and a check on the current one', () => {
        open({ previewRows: ROWS, previewRowId: 'b' });
        rowButton()?.click();

        const search = picker()?.querySelector('input');

        expect(rowButton()?.getAttribute('aria-expanded')).toBe('true');
        expect(search).toHaveFocus();
        expect(search?.placeholder).toBe('tools.database.searchLabel');
        expect(options().map((el) => el.textContent?.trim())).toEqual(['Apple', 'Banana', 'Cherry']);
        expect(options().map((el) => el.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
      });

      it('previews with the row picked and closes only the picker', () => {
        const preview = vi.fn((_source: string, rowId?: string) => (rowId === 'c' ? '30' : '6'));

        open({ previewRows: ROWS, previewRowId: 'a', preview });
        rowButton()?.click();
        (options()[2] as HTMLElement).click();

        expect(picker()).toBeNull();
        expect(text('[data-blok-database-formula-preview-row]')).toBe('Cherry');
        expect(text('[data-blok-database-formula-preview]')).toBe('30');
        expect(document.querySelector('[data-blok-database-formula-editor]')).not.toBeNull();
      });

      it('filters the rows by the search', () => {
        open({ previewRows: ROWS, previewRowId: 'a' });
        rowButton()?.click();
        const search = picker()?.querySelector('input');

        if (search == null) throw new Error('no search');
        search.value = 'ban';
        search.dispatchEvent(new Event('input'));

        expect(options().map((el) => el.textContent?.trim())).toEqual(['Banana']);
      });

      it('Escape closes only the picker', () => {
        const opts = open({ previewRows: ROWS, previewRowId: 'a' });

        type('prop("Amount") + 1');
        rowButton()?.click();
        picker()?.querySelector('input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

        expect(picker()).toBeNull();
        expect(document.querySelector('[data-blok-database-formula-editor]')).not.toBeNull();
        expect(opts.onSave).not.toHaveBeenCalled();
      });
    });

    it('shows "No output" and type unknown for an empty formula', () => {
      open();
      type('');

      expect(text('[data-blok-database-formula-preview]')).toBe('tools.database.formulaNoOutput');
      expect(document.querySelector('[data-blok-database-formula-preview]')?.hasAttribute('data-empty')).toBe(true);
      expect(text('[data-blok-database-formula-type]')).toBe('tools.database.formulaType(type=unknown)');
    });

    it('shows the result and its type', () => {
      open();
      type('prop("Amount") * 3');

      expect(text('[data-blok-database-formula-preview]')).toBe('6');
      expect(text('[data-blok-database-formula-type]')).toBe('tools.database.formulaType(type=number)');
    });

    it('shows "No output" with the type when the row gives nothing', () => {
      open({ preview: () => '' });
      type('prop("Amount")');

      expect(text('[data-blok-database-formula-preview]')).toBe('tools.database.formulaNoOutput');
      expect(text('[data-blok-database-formula-type]')).toBe('tools.database.formulaType(type=number)');
    });

    // research/35 §R13: `if(prop("Num") > 40, prop("Num"), "low")` showed "Type: unknown".
    it('calls a mixed result unknown', () => {
      open();
      type('if(prop("Amount") > 40, prop("Amount"), "low")');

      expect(text('[data-blok-database-formula-type]')).toBe('tools.database.formulaType(type=unknown)');
    });
  });

  // `C8-formula-open.png`, `formula-editor.png`: the help pane beside the list describes the highlighted row.
  describe('help', () => {
    it('highlights the first row and describes it', () => {
      open();
      type('');
      const first = document.querySelector('[data-blok-database-formula-reference-item]');

      expect(first?.getAttribute('aria-selected')).toBe('true');
      expect(text('[data-blok-database-formula-help-name]')).toBe('Name');
      expect(text('[data-blok-database-formula-help-description]'))
        .toBe('tools.database.formulaPropertyHelp(type=tools.database.propertyTypeTitle)');
      expect(document.querySelector('[data-blok-database-formula-help-example] [data-blok-database-formula-token]')?.getAttribute('data-property')).toBe('Name');
    });

    it('follows the row under the pointer', () => {
      open();
      type('');
      const row = '[data-blok-database-formula-reference-item][data-name="if()"]';

      document.querySelector(row)?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

      expect(document.querySelector(row)?.getAttribute('aria-selected')).toBe('true');
      expect(text('[data-blok-database-formula-help-name]')).toBe('if()');
      expect(document.querySelector('[data-blok-database-formula-help-description]')).toBeNull();
    });
  });

  it('leaves the formula itself out of its own property list', () => {
    open();
    type('');

    expect(document.querySelector('[data-name="prop:Double"]')).toBeNull();
  });
});
