import type { PropertyDefinition, PropertyValue } from '../types';
import { CellPopover } from './cell-popover';
import type { CellEditorContext, CellEditorHandle } from './types';

type Outcome = { kind: 'commit'; value: PropertyValue } | { kind: 'cancel' };

/** A number entry: '' clears to null, anything not finite is rejected. */
const parseNumberEntry = (text: string): Outcome | null => {
  const trimmed = text.trim();

  if (trimmed === '') {
    return { kind: 'commit', value: null };
  }
  const parsed = Number(trimmed);

  return Number.isFinite(parsed) ? { kind: 'commit', value: parsed } : null;
};

const initialText = (value: PropertyValue | undefined): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';

/**
 * Inline editor for title, text, url, number and rich text read as text.
 * Enter commits, Escape cancels, a press outside commits. Text takes
 * Shift+Enter as a newline.
 */
export const openTextEditor = (
  property: PropertyDefinition,
  value: PropertyValue | undefined,
  anchor: HTMLElement,
  ctx: CellEditorContext
): CellEditorHandle => {
  const multiline = property.type === 'text' || property.type === 'richText';
  const field = document.createElement(multiline ? 'textarea' : 'input');
  const original = initialText(value);
  const content = document.createElement('div');

  field.setAttribute('data-blok-database-cell-input', property.type);
  field.setAttribute('aria-label', property.name);
  field.value = original;
  if (field instanceof HTMLInputElement) {
    field.type = 'text';
    if (property.type === 'number') {
      field.inputMode = 'decimal';
    } else if (property.type === 'url') {
      field.inputMode = 'url';
    }
  } else {
    field.rows = 1;
  }
  content.appendChild(field);

  const resolve = (): Outcome | null => {
    if (property.type === 'number') {
      return parseNumberEntry(field.value);
    }

    return { kind: 'commit', value: field.value };
  };

  const state = { open: true };
  const popover = new CellPopover({
    anchor,
    content,
    minWidth: `${Math.max(anchor.getBoundingClientRect().width, 240)}px`,
    onEscape: () => finish({ kind: 'cancel' }),
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
        : outcome.value === original
    );

    if (outcome.kind === 'commit' && !unchanged) {
      ctx.onCommit(outcome.value);
    } else {
      ctx.onCancel?.();
    }
    ctx.onClose?.();
  };

  field.addEventListener('input', () => field.removeAttribute('aria-invalid'));
  field.addEventListener('keydown', (event: Event) => {
    if (!(event instanceof KeyboardEvent) || event.key !== 'Enter' || event.isComposing || (multiline && event.shiftKey)) {
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
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);

  return {
    get isOpen() {
      return state.open;
    },
    close: () => finish(resolve() ?? { kind: 'cancel' }),
    cancel: () => finish({ kind: 'cancel' }),
  };
};
