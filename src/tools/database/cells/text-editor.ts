import type { PropertyDefinition, PropertyValue } from '../types';
import { CellPopover, coverMinWidth } from './cell-popover';
import { resolveLocale } from './date-format';
import { formatNumberValue, parseNumberText } from './number-format';
import type { CellEditorContext, CellEditorHandle } from './types';

type Outcome = { kind: 'commit'; value: PropertyValue } | { kind: 'cancel' };

/** A number entry in its property's format: '' clears to null, anything not a number is rejected. */
const parseNumberEntry = (text: string, property: PropertyDefinition, locale: string): Outcome | null => {
  const parsed = parseNumberText(text, property.number ?? {}, locale);

  return parsed === undefined ? null : { kind: 'commit', value: parsed };
};

/** research/16 §4: Notion's url, email and phone editors. */
const INPUT_TYPES: Partial<Record<PropertyDefinition['type'], string>> = { url: 'url', email: 'email', phone: 'tel' };

/** research/22 §3, research/23 §3c, research/30 B20: Escape saves every text-like value. */
const escapeCommits = (type: PropertyDefinition['type']): boolean =>
  type === 'title' || type === 'text' || type === 'richText' || type === 'number' || type === 'url'
  || type === 'email' || type === 'phone';

/** notion-spec-2 §19.7: a number opens as its cell shows it ("$42.00", "3550%"). */
const initialText = (property: PropertyDefinition, value: PropertyValue | undefined, locale: string): string => {
  // A number stored as text shows as a number in its cell too (display.ts).
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;

  if (property.type === 'number' && typeof n === 'number' && Number.isFinite(n)) {
    return formatNumberValue(n, property.number ?? {}, locale);
  }

  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
};

/**
 * Inline editor for title, text, url, number and rich text read as text.
 * Enter and a press outside commit. Escape commits or cancels by type (see
 * escapeCommits). Text takes Shift+Enter as a newline.
 */
export const openTextEditor = (
  property: PropertyDefinition,
  value: PropertyValue | undefined,
  anchor: HTMLElement,
  ctx: CellEditorContext,
  footer?: HTMLElement,
  header?: HTMLElement,
  escapeCancels = false
): CellEditorHandle => {
  const multiline = property.type === 'text' || property.type === 'richText';
  const field = document.createElement(multiline ? 'textarea' : 'input');
  const locale = resolveLocale(ctx.locale);
  const original = initialText(property, value, locale);
  const content = document.createElement('div');

  field.setAttribute('data-blok-database-cell-input', property.type);
  field.setAttribute('aria-label', property.name);
  if (field instanceof HTMLInputElement) {
    field.type = INPUT_TYPES[property.type] ?? 'text';
    if (property.type === 'number') {
      field.inputMode = 'decimal';
    }
  } else {
    field.rows = 1;
  }
  field.value = original;
  // url and email inputs trim the value: compare against what the field holds, or opening and closing writes.
  const shown = field.value;

  field.value = ctx.initialText ?? shown;
  if (header !== undefined) content.appendChild(header);
  content.appendChild(field);
  if (footer !== undefined) content.appendChild(footer);

  const resolve = (): Outcome | null => {
    // The shown number may be rounded: left as shown, the stored value stays.
    if (property.type === 'number' && field.value === shown) {
      return { kind: 'cancel' };
    }
    if (property.type === 'number') {
      return parseNumberEntry(field.value, property, locale);
    }

    return { kind: 'commit', value: field.value };
  };

  const state = { open: true };
  const popover = new CellPopover({
    anchor,
    cover: ctx.coverCell,
    content,
    minWidth: coverMinWidth(anchor, ctx.coverCell, 240),
    onEscape: () => finish(!escapeCancels && escapeCommits(property.type) ? resolve() ?? { kind: 'cancel' } : { kind: 'cancel' }),
    onDismiss: () => finish(resolve() ?? { kind: 'cancel' }, false),
  });

  const finish = (outcome: Outcome, closePopover = true): void => {
    if (!state.open) {
      return;
    }
    state.open = false;
    if (closePopover) {
      popover.close();
    }
    const unchanged = outcome.kind === 'commit' && (
      property.type === 'number'
        ? outcome.value === (typeof value === 'number' ? value : null)
        : outcome.value === shown
    );

    if (outcome.kind === 'commit' && !unchanged) {
      ctx.onCommit(outcome.value);
    } else {
      ctx.onCancel?.();
    }
    ctx.onClose?.();
  };

  // A textarea grows down with its text, as Notion's does.
  const fit = (): void => {
    if (field instanceof HTMLTextAreaElement) {
      field.style.height = 'auto';
      field.style.height = `${field.scrollHeight}px`;
    }
  };

  field.addEventListener('input', () => {
    field.removeAttribute('aria-invalid');
    fit();
    ctx.onDraft?.(field.value);
  });
  field.addEventListener('keydown', (event: Event) => {
    if (!(event instanceof KeyboardEvent) || event.isComposing) {
      return;
    }
    // A header or footer has its own controls, so Tab must still reach them.
    if (event.key === 'Tab' && ctx.tabCloses === true && header === undefined && footer === undefined) {
      event.preventDefault();
      finish(resolve() ?? { kind: 'cancel' });

      return;
    }
    if (event.key !== 'Enter' || (multiline && event.shiftKey)) {
      return;
    }
    event.preventDefault();
    const outcome = resolve();

    if (outcome === null) {
      field.setAttribute('aria-invalid', 'true');

      return;
    }
    finish(outcome);
  });

  popover.show();
  fit();
  field.focus();
  // An email input has no selection API: setSelectionRange throws there.
  if (!(field instanceof HTMLInputElement && field.type === 'email')) {
    field.setSelectionRange(field.value.length, field.value.length);
  }

  return {
    get isOpen() {
      return state.open;
    },
    close: () => finish(resolve() ?? { kind: 'cancel' }),
    cancel: () => finish({ kind: 'cancel' }),
  };
};
