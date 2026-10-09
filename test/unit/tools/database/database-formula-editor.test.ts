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

const input = (): HTMLTextAreaElement => {
  const el = document.querySelector<HTMLTextAreaElement>('[data-blok-database-formula-input]');

  if (el === null) throw new Error('no input');

  return el;
};

const type = (text: string): void => {
  input().value = text;
  input().dispatchEvent(new Event('input'));
};

const text = (selector: string): string => document.querySelector(selector)?.textContent ?? '';

describe('formula editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('shows the stored formula with property names', () => {
    open();

    expect(input().value).toBe('prop("Amount") * 2');
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

  it('saves the formula with property ids on Enter', () => {
    const options = open();

    type('prop("Amount") + 1');
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(options.onSave).toHaveBeenCalledWith('{{property:amount}} + 1');
  });

  it('does not save a formula that fails to compile', () => {
    const options = open();

    type('1 +');
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(options.onSave).not.toHaveBeenCalled();
  });

  it('keeps a new line on Shift+Enter', () => {
    const options = open();
    const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true });

    input().dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(options.onSave).not.toHaveBeenCalled();
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

    expect(input().value).toBe('prop("Amount")');
  });

  it('leaves the formula itself out of its own property list', () => {
    open();
    type('');

    expect(document.querySelector('[data-name="prop:Double"]')).toBeNull();
  });
});
