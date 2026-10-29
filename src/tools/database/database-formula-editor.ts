import type { I18n } from '../../../types';
import { IconCheck, IconCheckbox, IconChevronDown, IconCross, IconHash, IconPageEmpty } from '../../components/icons';
import { propertyTypeMeta } from './database-property-types';
import { FormulaField, renderFormulaInto } from './database-formula-field';
import { CellPopover } from './cells/cell-popover';
import { FORMULA_FUNCTION_NAMES, formatFormulaForDisplay, formulaErrorKey, serializeFormula } from './formula';
import type { CompileResult, FormulaType } from './formula';
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
  preview?: (source: string, rowId?: string) => string | null;
  /** The rows "Preview with" can pick, in the view's order. */
  previewRows?: ReadonlyArray<{ id: string; title: string }>;
  /** The row the preview starts with. Defaults to the first. */
  previewRowId?: string;
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
  /** The glyph: a property's type, or an operator's result. */
  icon?: { kind: string; svg: string };
  /** The help pane's line under the name. Built-ins have none yet. */
  description?: string;
}

/**
 * notion-spec-2 §18.3 "Type: unknown" (empty), §22.5 "Type: number", research/35
 * "unknown" for a mixed `if`. The other names are Blok's: Notion's are unmeasured.
 */
const typeLabel = (type: FormulaType | null): string => {
  if (type === null || type.kind === 'empty' || type.kind === 'any') return 'unknown';

  return type.kind;
};

/**
 * notion-spec-2 §25.1 (`32-formula-typed.png`): Built-ins open with these ten, # for
 * arithmetic and a checkbox for comparisons. `%` and `^` still parse; Notion lists neither.
 */
const OPERATORS: ReadonlyArray<[string, 'number' | 'boolean']> = [
  ['*', 'number'], ['/', 'number'], ['+', 'number'], ['-', 'number'],
  ['>', 'boolean'], ['>=', 'boolean'], ['<', 'boolean'], ['<=', 'boolean'],
  ['==', 'boolean'], ['!=', 'boolean'],
];

const quote = (name: string): string => `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** The word the caret sits at the end of. A number is not a word: after `* 2` the whole list stays. */
const wordBefore = (text: string, caret: number): string => /[\p{L}_$][\p{L}\p{N}_$]*$/u.exec(text.slice(0, caret))?.[0] ?? '';

/** notion-spec-2 §25.1: after a number, a closed call or a string the list offers only Built-ins. */
const endsInOperand = (text: string, caret: number): boolean => /[\p{N})"\]]\s*$/u.test(text.slice(0, caret));

/**
 * Notion's formula editor (H-fx): the expression at the top, a live preview,
 * the compile error, and a list of properties and functions. The property
 * stores ids; the editor shows names.
 */
class FormulaEditor implements FormulaEditorHandle {
  private readonly root = document.createElement('div');
  private readonly field: FormulaField;
  private readonly input: HTMLElement;
  private readonly preview = document.createElement('div');
  private readonly error = document.createElement('div');
  private readonly list = document.createElement('div');
  private readonly type = document.createElement('span');
  private readonly help = document.createElement('div');
  private readonly popover: CellPopover;
  /** The row the help pane describes, by `data-name`. */
  private active: string | null = null;
  /** Whether the list showed only Built-ins last time: a switch highlights its first row again. */
  private builtInsOnly = false;
  private open = true;
  /** The formula as it opened: Escape on it writes nothing. */
  private readonly initial: string;
  private readonly rowButton = document.createElement('button');
  private rowId: string | undefined;
  private picker: HTMLElement | null = null;
  /** notion-spec-2 §25.1: shown left of the × only while the formula differs from the saved one. */
  private readonly discard = document.createElement('button');
  private readonly result = document.createElement('div');
  private debug = false;

  constructor(anchor: HTMLElement, private readonly options: FormulaEditorOptions) {
    const t = (key: string): string => options.i18n.t(key);

    this.root.setAttribute('data-blok-database-formula-editor', '');
    this.field = new FormulaField(options.schema, () => this.refresh());
    this.input = this.field.element;
    this.input.setAttribute('data-blok-database-formula-input', '');
    this.input.setAttribute('data-blok-field', 'text');
    this.input.setAttribute('aria-label', t('tools.database.formulaLabel'));
    this.input.setAttribute('data-placeholder', t('tools.database.formulaPlaceholder'));
    this.field.reset(formatFormulaForDisplay(options.property.formula?.expression ?? '', options.schema, options.relatedSchema ?? []));
    this.initial = this.field.value;
    this.preview.setAttribute('data-blok-database-formula-preview', '');
    this.preview.setAttribute('aria-live', 'polite');
    this.error.setAttribute('data-blok-database-formula-error', '');
    this.error.setAttribute('role', 'alert');
    this.list.setAttribute('data-blok-database-formula-reference', '');
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', t('tools.database.formulaReference'));
    this.type.setAttribute('data-blok-database-formula-type', '');
    this.help.setAttribute('data-blok-database-formula-help', '');

    const head = document.createElement('div');
    const title = document.createElement('span');
    const close = document.createElement('button');

    head.setAttribute('data-blok-database-formula-head', '');
    title.setAttribute('data-blok-database-formula-title', '');
    title.textContent = t('tools.database.editFormula');
    close.type = 'button';
    close.setAttribute('data-blok-database-formula-close', '');
    close.setAttribute('aria-label', t('tools.database.close'));
    close.innerHTML = IconCross;
    close.addEventListener('click', () => this.leave(true));
    this.discard.type = 'button';
    this.discard.setAttribute('data-blok-database-formula-discard', '');
    this.discard.textContent = t('tools.database.formulaDiscard');
    this.discard.addEventListener('click', () => {
      this.field.reset(this.initial);
      this.input.focus();
      this.field.setCaret(this.initial.length);
      this.refresh();
    });
    head.append(title, close);
    this.root.append(head, this.input, this.renderPreviewArea(), this.error, this.renderPanes());

    this.root.addEventListener('pointerdown', (event) => {
      const target = event.target instanceof Node ? event.target : null;

      if (this.picker !== null && !this.picker.contains(target) && !this.rowButton.contains(target)) this.closePicker();
    });
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        this.save();
      }
    });

    this.popover = new CellPopover({
      anchor,
      content: this.root,
      // notion-spec-2 §18.3: the Edit formula box is 740 wide, and kept inside the window (bottom at window − 12).
      minWidth: '740px',
      cover: true,
      // §25.1: Escape in the row picker closes only the picker.
      onEscape: () => (this.picker === null ? this.leave(true) : this.closePicker()),
      // §25.1 (39-after-outside.png): a click outside keeps the typed formula.
      onDismiss: () => this.leave(false),
    });
    this.refresh();
    this.popover.show();
    this.input.focus();
    this.field.setCaret(this.initial.length);
    // The list depends on the text before the caret, which was unset at the first render.
    this.renderReference();
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

  /**
   * notion-spec-2 §18.3, §25.1: Escape, × and a click outside all save the typed formula.
   * One that does not compile closes unsaved (unmeasured).
   */
  private leave(closePopover: boolean): void {
    const compiled = this.options.compile(this.field.value);

    if (this.field.value !== this.initial && compiled.ok) {
      this.options.onSave(serializeFormula(compiled.formula));
    }
    this.finish(closePopover);
  }

  /** "Preview with <row>" over the output and its "Type: …" badge. */
  private renderPreviewArea(): HTMLElement {
    const area = document.createElement('div');
    const top = document.createElement('div');
    const result = this.result;

    area.setAttribute('data-blok-database-formula-preview-area', '');
    top.setAttribute('data-blok-database-formula-preview-head', '');
    result.setAttribute('data-blok-database-formula-result', '');
    const rows = this.options.previewRows ?? [];

    this.rowId = rows.find((row) => row.id === this.options.previewRowId)?.id ?? rows.at(0)?.id;
    if (this.rowId !== undefined) {
      const label = document.createElement('span');

      label.setAttribute('data-blok-database-formula-preview-label', '');
      label.textContent = this.options.i18n.t('tools.database.formulaPreviewWith');
      this.rowButton.type = 'button';
      this.rowButton.setAttribute('data-blok-database-formula-preview-row', '');
      this.rowButton.setAttribute('aria-haspopup', 'listbox');
      this.rowButton.setAttribute('aria-expanded', 'false');
      this.rowButton.addEventListener('click', () => (this.picker === null ? this.openPicker() : this.closePicker()));
      this.renderRowButton();
      top.append(label, this.rowButton);
    }
    top.append(this.renderDebugSwitch());
    result.append(this.preview, this.type);
    area.append(top, result);

    return area;
  }

  /** notion-spec-2 §25.1 (debug-on.txt): a 30x18 switch at the end of the preview line, "Debug mode" after it. */
  private renderDebugSwitch(): HTMLElement {
    const button = document.createElement('button');
    const track = document.createElement('span');
    const label = document.createElement('span');

    button.type = 'button';
    button.setAttribute('role', 'switch');
    button.setAttribute('aria-checked', 'false');
    button.setAttribute('data-blok-database-formula-debug', '');
    track.setAttribute('data-blok-database-switch-track', '');
    track.append(document.createElement('span'));
    label.textContent = this.options.i18n.t('tools.database.formulaDebugMode');
    button.append(track, label);
    button.addEventListener('click', () => {
      this.debug = !this.debug;
      button.setAttribute('aria-checked', String(this.debug));
      this.result.toggleAttribute('data-debug', this.debug);
      this.refresh();
    });

    return button;
  }

  private renderRowButton(): void {
    const title = document.createElement('span');

    title.textContent = this.options.previewRows?.find((row) => row.id === this.rowId)?.title ?? '';
    this.rowButton.replaceChildren(glyph('data-blok-database-formula-preview-icon', IconPageEmpty), title, glyph('data-blok-database-formula-preview-chevron', IconChevronDown));
  }

  /** notion-spec-2 §25.1 (31-preview-picker.png): a Search field, then one row per database row, ✓ on the current one. */
  private openPicker(): void {
    const picker = document.createElement('div');
    const search = document.createElement('input');
    const list = document.createElement('div');
    const label = this.options.i18n.t('tools.database.searchLabel');
    const fill = (): void => {
      const query = search.value.trim().toLowerCase();

      list.replaceChildren(...(this.options.previewRows ?? [])
        .filter((row) => row.title.toLowerCase().includes(query))
        .map((row) => this.renderPickerOption(row)));
    };

    picker.setAttribute('data-blok-database-formula-preview-picker', '');
    search.type = 'text';
    search.placeholder = label;
    search.setAttribute('aria-label', label);
    search.setAttribute('data-blok-field', 'text');
    search.addEventListener('input', fill);
    search.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      list.querySelector<HTMLElement>('[data-blok-database-formula-preview-option]')?.click();
    });
    list.setAttribute('role', 'listbox');
    picker.append(search, list);
    fill();
    this.picker = picker;
    this.rowButton.setAttribute('aria-expanded', 'true');
    this.rowButton.after(picker);
    picker.style.left = `${this.rowButton.offsetLeft}px`;
    search.focus();
  }

  private renderPickerOption(row: { id: string; title: string }): HTMLElement {
    const option = document.createElement('div');
    const title = document.createElement('span');
    const selected = row.id === this.rowId;

    option.setAttribute('data-blok-database-formula-preview-option', '');
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(selected));
    title.textContent = row.title;
    option.append(glyph('data-blok-database-formula-preview-icon', IconPageEmpty), title);
    if (selected) option.append(glyph('data-blok-database-formula-preview-check', IconCheck));
    option.addEventListener('click', () => {
      this.rowId = row.id;
      this.renderRowButton();
      this.closePicker();
      this.refresh();
    });

    return option;
  }

  private closePicker(): void {
    this.picker?.remove();
    this.picker = null;
    this.rowButton.setAttribute('aria-expanded', 'false');
    this.input.focus();
  }

  /** The list on the left, its help on the right. */
  private renderPanes(): HTMLElement {
    const panes = document.createElement('div');

    panes.setAttribute('data-blok-database-formula-panes', '');
    this.list.addEventListener('mousemove', (event) => {
      const item = event.target instanceof Element ? event.target.closest('[data-blok-database-formula-reference-item]') : null;
      const name = item?.getAttribute('data-name') ?? null;

      if (name === null || name === this.active) return;
      this.active = name;
      // In place: a rebuilt list would lose its scroll.
      this.list.querySelectorAll('[data-blok-database-formula-reference-item]').forEach((el) => {
        el.setAttribute('aria-selected', String(el === item));
      });
      this.renderHelp([...this.properties(), ...this.builtIns()].find((ref) => ref.name === name));
    });
    panes.append(this.list, this.help);

    return panes;
  }

  private save(): void {
    const compiled = this.options.compile(this.field.value);

    if (!compiled.ok) {
      this.refresh();

      return;
    }
    this.options.onSave(serializeFormula(compiled.formula));
    this.finish(true);
  }

  private refresh(): void {
    const source = this.field.value;
    const compiled = this.options.compile(source);

    this.error.replaceChildren();
    const output = compiled.ok && source.trim() !== '' ? this.options.preview?.(source, this.rowId) ?? '' : '';

    this.preview.toggleAttribute('data-empty', output === '');
    this.preview.textContent = output === '' ? this.options.i18n.t('tools.database.formulaNoOutput') : output;
    // Only Notion's number tag is measured ("10 num").
    if (this.debug && output !== '' && compiled.ok && compiled.resultType.kind === 'number') {
      const tag = document.createElement('span');

      tag.setAttribute('data-blok-database-formula-debug-type', '');
      tag.textContent = 'num';
      this.preview.append(tag);
    }
    if (source === this.initial) {
      this.discard.remove();
    } else if (!this.discard.isConnected) {
      this.root.querySelector('[data-blok-database-formula-close]')?.before(this.discard);
    }
    this.type.textContent = this.options.i18n.t('tools.database.formulaType', {
      type: typeLabel(compiled.ok && source.trim() !== '' ? compiled.resultType : null),
    });
    if (compiled.ok) {
      this.input.removeAttribute('aria-invalid');
    } else {
      const { code, params, start, end } = compiled.error;
      const message = document.createElement('span');
      const range = document.createElement('code');

      this.input.setAttribute('aria-invalid', 'true');
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

  private properties(): Reference[] {
    return this.options.schema
      .filter((p) => p.id !== this.options.property.id)
      .map((p): Reference => ({
        name: `prop:${p.name}`,
        label: p.name,
        insert: `prop(${quote(p.name)})`,
        kind: 'property',
        icon: { kind: p.type, svg: propertyTypeMeta(p.type).icon },
        // `C8-formula-open.png`: "URL property."
        description: this.options.i18n.t('tools.database.formulaPropertyHelp', { type: this.options.i18n.t(propertyTypeMeta(p.type).labelKey) }),
      }));
  }

  private builtIns(): Reference[] {
    const operators = OPERATORS.map(([op, result]): Reference => ({
      name: op,
      label: op,
      insert: ` ${op} `,
      kind: 'function',
      icon: { kind: result, svg: result === 'number' ? IconHash : IconCheckbox },
    }));
    const functions = FORMULA_FUNCTION_NAMES
      .filter((name) => name !== 'prop')
      .map((name): Reference => ({ name, label: name, insert: `${name}(`, kind: 'function' }));

    return [...operators, ...functions];
  }

  private renderReference(): void {
    const caret = this.field.caret();
    const word = wordBefore(this.field.value, caret).toLowerCase();
    const afterOperand = word === '' && endsInOperand(this.field.value, caret);
    const matches = (ref: Reference): boolean => word === '' || ref.label.toLowerCase().startsWith(word);
    const section = (labelKey: string, refs: Reference[]): HTMLElement[] => {
      const shown = refs.filter(matches);

      if (shown.length === 0) return [];
      const label = document.createElement('div');

      label.setAttribute('data-blok-database-formula-reference-label', '');
      label.setAttribute('role', 'presentation');
      label.textContent = this.options.i18n.t(labelKey);

      return [label, ...shown.map((ref) => this.renderItem(ref))];
    };

    if (afterOperand !== this.builtInsOnly) this.active = null;
    this.builtInsOnly = afterOperand;
    const properties = afterOperand ? [] : this.properties();
    const shown = [...properties, ...this.builtIns()].filter(matches);
    const active = shown.find((ref) => ref.name === this.active) ?? shown.at(0);

    this.active = active?.name ?? null;
    this.list.replaceChildren(
      ...section('tools.database.propertiesSection', properties),
      ...section('tools.database.formulaBuiltIns', this.builtIns())
    );
    this.renderHelp(active);
  }

  /** `C8-formula-open.png`: the name with its glyph, the description, then a bare example. */
  private renderHelp(ref: Reference | undefined): void {
    this.help.replaceChildren();
    if (ref === undefined) return;
    const name = document.createElement('div');
    const icon = document.createElement('span');
    const label = document.createElement('span');

    name.setAttribute('data-blok-database-formula-help-name', '');
    icon.setAttribute('data-blok-database-formula-reference-icon', '');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = ref.icon?.svg ?? '';
    label.textContent = ref.label;
    name.append(icon, label);
    this.help.append(name);
    if (ref.description === undefined) return;
    const description = document.createElement('div');
    const example = document.createElement('code');

    description.setAttribute('data-blok-database-formula-help-description', '');
    description.textContent = ref.description;
    example.setAttribute('data-blok-database-formula-help-example', '');
    renderFormulaInto(example, ref.insert, this.options.schema);
    this.help.append(description, example);
  }

  private renderItem(ref: Reference): HTMLElement {
    const item = document.createElement('div');
    const icon = document.createElement('span');
    const label = document.createElement('span');

    item.setAttribute('data-blok-database-formula-reference-item', ref.kind);
    item.setAttribute('data-name', ref.name);
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(ref.name === this.active));
    icon.setAttribute('data-blok-database-formula-reference-icon', '');
    icon.setAttribute('aria-hidden', 'true');
    if (ref.icon !== undefined) {
      icon.setAttribute('data-kind', ref.icon.kind);
      icon.innerHTML = ref.icon.svg;
    }
    label.textContent = ref.label;
    item.append(icon, label);
    item.addEventListener('mousedown', (event) => event.preventDefault());
    item.addEventListener('click', () => this.insert(ref.insert));

    return item;
  }

  /** Replaces the word at the caret with `text`. */
  private insert(text: string): void {
    const caret = this.field.caret();

    this.input.focus();
    this.field.replace(caret - wordBefore(this.field.value, caret).length, caret, text);
  }
}

const glyph = (attribute: string, svg: string): HTMLElement => {
  const holder = document.createElement('span');

  holder.setAttribute(attribute, '');
  holder.setAttribute('aria-hidden', 'true');
  holder.innerHTML = svg;

  return holder;
};

export const openFormulaEditor = (anchor: HTMLElement, options: FormulaEditorOptions): FormulaEditorHandle =>
  new FormulaEditor(anchor, options);
