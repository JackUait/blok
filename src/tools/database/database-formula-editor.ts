import type { I18n } from '../../../types';
import { CellPopover } from './cells/cell-popover';
import { FORMULA_FUNCTION_NAMES, formatFormulaForDisplay, formulaErrorKey, serializeFormula } from './formula';
import type { CompileResult } from './formula';
import type { PropertyDefinition } from './types';

export interface FormulaEditorOptions {
  i18n: Pick<I18n, 't'>;
  /** The formula property being edited. */
  property: PropertyDefinition;
  /** This database's schema, for names. */
  schema: PropertyDefinition[];
  /** Schemas of related databases, for `current.prop()` names. */
  relatedSchema?: PropertyDefinition[];
  /** Compiles against the database, cycles and depth included. */
  compile: (source: string) => CompileResult;
  /** The result for one row, as text, or null when there is no row to show. */
  preview?: (source: string) => string | null;
  /** The stored form, property names replaced by ids. */
  onSave: (stored: string) => void;
  onClose?: () => void;
}

export interface FormulaEditorHandle {
  close(): void;
}

interface Reference {
  name: string;
  label: string;
  insert: string;
  kind: 'property' | 'function';
}

const quote = (name: string): string => `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** The word the caret sits at the end of, for filtering the reference list. */
const wordBefore = (text: string, caret: number): string => /[\p{L}\p{N}_$]*$/u.exec(text.slice(0, caret))?.[0] ?? '';

/**
 * Notion's formula editor (H-fx): the expression at the top, a live preview,
 * the compile error, and a list of properties and functions. The property
 * stores ids; the editor shows names.
 */
class FormulaEditor implements FormulaEditorHandle {
  private readonly root = document.createElement('div');
  private readonly input = document.createElement('textarea');
  private readonly preview = document.createElement('div');
  private readonly error = document.createElement('div');
  private readonly list = document.createElement('div');
  private readonly popover: CellPopover;
  private open = true;

  constructor(anchor: HTMLElement, private readonly options: FormulaEditorOptions) {
    const t = (key: string): string => options.i18n.t(key);

    this.root.setAttribute('data-blok-database-formula-editor', '');
    this.input.setAttribute('data-blok-database-formula-input', '');
    this.input.setAttribute('aria-label', t('tools.database.formulaLabel'));
    this.input.placeholder = t('tools.database.formulaPlaceholder');
    this.input.rows = 3;
    this.input.spellcheck = false;
    this.input.value = formatFormulaForDisplay(options.property.formula?.expression ?? '', options.schema, options.relatedSchema ?? []);
    this.preview.setAttribute('data-blok-database-formula-preview', '');
    this.preview.setAttribute('aria-live', 'polite');
    this.error.setAttribute('data-blok-database-formula-error', '');
    this.error.setAttribute('role', 'alert');
    this.list.setAttribute('data-blok-database-formula-reference', '');
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', t('tools.database.formulaReference'));

    const done = document.createElement('button');

    done.type = 'button';
    done.setAttribute('data-blok-database-formula-done', '');
    done.textContent = t('tools.database.formulaDone');
    done.addEventListener('click', () => this.save());
    this.root.append(this.input, this.preview, this.error, this.list, done);

    this.input.addEventListener('input', () => this.refresh());
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        this.save();
      }
    });

    this.popover = new CellPopover({
      anchor,
      content: this.root,
      minWidth: '400px',
      onEscape: () => this.finish(true),
      onDismiss: () => this.finish(false),
    });
    this.refresh();
    this.popover.show();
    this.input.focus();
  }

  close(): void {
    this.finish(true);
  }

  private finish(closePopover: boolean): void {
    if (!this.open) return;
    this.open = false;
    if (closePopover) this.popover.close();
    this.options.onClose?.();
  }

  private save(): void {
    const compiled = this.options.compile(this.input.value);

    if (!compiled.ok) {
      this.refresh();

      return;
    }
    this.options.onSave(serializeFormula(compiled.formula));
    this.finish(true);
  }

  private refresh(): void {
    const source = this.input.value;
    const compiled = this.options.compile(source);

    this.error.replaceChildren();
    if (compiled.ok) {
      this.input.removeAttribute('aria-invalid');
      this.preview.textContent = this.options.preview?.(source) ?? '';
    } else {
      const { code, params, start, end } = compiled.error;
      const message = document.createElement('span');
      const range = document.createElement('code');

      this.input.setAttribute('aria-invalid', 'true');
      this.preview.textContent = '';
      message.setAttribute('data-blok-database-formula-error-message', '');
      message.textContent = this.options.i18n.t(formulaErrorKey(code), params);
      range.setAttribute('data-blok-database-formula-error-range', '');
      range.setAttribute('data-start', String(start));
      range.setAttribute('data-end', String(end));
      range.textContent = source.slice(start, end);
      this.error.append(message, ...(end > start ? [range] : []));
    }
    this.renderReference();
  }

  private references(): Reference[] {
    const properties = this.options.schema
      .filter((p) => p.id !== this.options.property.id)
      .map((p): Reference => ({ name: `prop:${p.name}`, label: p.name, insert: `prop(${quote(p.name)})`, kind: 'property' }));
    const functions = FORMULA_FUNCTION_NAMES
      .filter((name) => name !== 'prop')
      .map((name): Reference => ({ name, label: name, insert: `${name}(`, kind: 'function' }));

    return [...properties, ...functions];
  }

  private renderReference(): void {
    const word = wordBefore(this.input.value, this.input.selectionEnd).toLowerCase();
    const shown = this.references().filter((ref) => word === '' || ref.label.toLowerCase().startsWith(word));

    this.list.replaceChildren(...shown.map((ref) => {
      const item = document.createElement('div');

      item.setAttribute('data-blok-database-formula-reference-item', ref.kind);
      item.setAttribute('data-name', ref.name);
      item.setAttribute('role', 'option');
      item.textContent = ref.label;
      item.addEventListener('mousedown', (event) => event.preventDefault());
      item.addEventListener('click', () => this.insert(ref.insert));

      return item;
    }));
  }

  /** Replaces the word at the caret with `text`. */
  private insert(text: string): void {
    const value = this.input.value;
    const caret = this.input.selectionEnd;
    const start = caret - wordBefore(value, caret).length;

    this.input.value = `${value.slice(0, start)}${text}${value.slice(caret)}`;
    this.input.selectionStart = start + text.length;
    this.input.selectionEnd = start + text.length;
    this.input.focus();
    this.refresh();
  }
}

export const openFormulaEditor = (anchor: HTMLElement, options: FormulaEditorOptions): FormulaEditorHandle =>
  new FormulaEditor(anchor, options);
