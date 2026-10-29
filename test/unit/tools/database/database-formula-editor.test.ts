import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openFormulaEditor } from '../../../../src/tools/database/database-formula-editor';
import type { FormulaEditorOptions } from '../../../../src/tools/database/database-formula-editor';
import { compileFormula } from '../../../../src/tools/database/formula';
import type { PropertyDefinition } from '../../../../src/tools/database/types';

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

  it('puts a new line on Shift+Enter', () => {
    const options = open();

    type('1 +');
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
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

    expect(names).toEqual(['dateAdd']);
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

  // `C8-formula-open.png`, `formula-editor.png`: a "Properties" section, then "Built-ins".
  it('heads properties with "Properties" and built-ins with "Built-ins"', () => {
    open();
    type('');
    const labels = [...document.querySelectorAll('[data-blok-database-formula-reference-label]')].map((el) => el.textContent);

    expect(labels).toEqual(['tools.database.propertiesSection', 'tools.database.formulaBuiltIns']);
  });

  // `formula-editor.png`: Built-ins open with the operators * / + - > >= <, # for number and a checkbox for compare.
  it('lists the operators first among built-ins, in Notion\'s order', () => {
    open();
    type('');
    const builtIns = [...document.querySelectorAll('[data-blok-database-formula-reference-item="function"]')]
      .map((el) => el.getAttribute('data-name'));

    expect(builtIns.slice(0, 7)).toEqual(['*', '/', '+', '-', '>', '>=', '<']);
  });

  it('draws each row with its type glyph', () => {
    open();
    type('');
    const glyph = (name: string): string | null | undefined =>
      document.querySelector(`[data-blok-database-formula-reference-item][data-name="${name}"] [data-blok-database-formula-reference-icon]`)?.getAttribute('data-kind');

    expect(glyph('prop:Amount')).toBe('number');
    expect(glyph('prop:Name')).toBe('title');
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
    it('names the row it previews with', () => {
      open({ previewRow: 'Banana' });

      expect(text('[data-blok-database-formula-preview-label]')).toBe('tools.database.formulaPreviewWith');
      expect(text('[data-blok-database-formula-preview-row]')).toBe('Banana');
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
      const row = '[data-blok-database-formula-reference-item][data-name="*"]';

      document.querySelector(row)?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

      expect(document.querySelector(row)?.getAttribute('aria-selected')).toBe('true');
      expect(text('[data-blok-database-formula-help-name]')).toBe('*');
      expect(document.querySelector('[data-blok-database-formula-help-description]')).toBeNull();
    });
  });

  it('leaves the formula itself out of its own property list', () => {
    open();
    type('');

    expect(document.querySelector('[data-name="prop:Double"]')).toBeNull();
  });
});
