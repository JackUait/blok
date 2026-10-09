import { IconCheck } from '../../../components/icons';
import { safeHref } from '../../../components/utils/sanitize-url';
import type { PropertyDefinition, PropertyValue, SelectOption } from '../types';
import { formatDateText, resolveLocale } from './date-format';
import { optionColorOf } from './option-colors';
import type { CellContext } from './types';

export const optionsFor = (property: PropertyDefinition, ctx: Pick<CellContext, 'options'>): SelectOption[] =>
  ctx.options ?? property.config?.options ?? [];

/** A colored option pill. Colors come from `[data-color]` in database.css. */
export const createOptionPill = (option: Pick<SelectOption, 'label' | 'color'>): HTMLSpanElement => {
  const pill = document.createElement('span');

  pill.setAttribute('data-blok-database-option-pill', '');
  pill.setAttribute('data-color', optionColorOf(option));
  pill.textContent = option.label;

  return pill;
};

const renderCheckbox = (cell: HTMLElement, value: PropertyValue | undefined, ctx: CellContext): void => {
  const checked = value === true;
  const box = document.createElement('span');

  box.setAttribute('data-blok-database-checkbox', '');
  box.setAttribute('data-state', checked ? 'checked' : 'unchecked');
  box.setAttribute('aria-hidden', 'true');
  if (checked) {
    box.innerHTML = IconCheck;
  }

  const state = document.createElement('span');

  state.setAttribute('data-blok-database-sr-only', '');
  state.textContent = ctx.i18n.t(checked ? 'tools.database.checkboxChecked' : 'tools.database.checkboxUnchecked');
  cell.append(box, state);
};

function renderUrl(cell: HTMLElement, url: string, ctx: CellContext): void {
  const href = safeHref(url);

  if (href === null) {
    cell.append(url);

    return;
  }

  const link = document.createElement('a');

  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = url;
  link.setAttribute('data-blok-database-cell-link', '');
  // A plain click edits the cell; Cmd/Ctrl-click opens the link.
  link.addEventListener('click', (event) => {
    if (!ctx.readOnly && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
    }
  });
  cell.appendChild(link);
}

const isEmpty = (value: PropertyValue | undefined): boolean =>
  value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);

/**
 * Read-only display of one cell value. Never parses the value as HTML. The
 * element carries `data-blok-database-cell="<type>"`, and `data-empty` when
 * there is no value.
 */
export const renderCellValue = (property: PropertyDefinition, value: PropertyValue | undefined, ctx: CellContext): HTMLElement => {
  const cell = document.createElement('span');

  cell.setAttribute('data-blok-database-cell', property.type);
  if (isEmpty(value) && property.type !== 'checkbox') {
    cell.setAttribute('data-empty', '');
  }

  switch (property.type) {
    case 'select':
    case 'multiSelect': {
      const options = optionsFor(property, ctx);
      const single = typeof value === 'string' && value !== '' ? [value] : [];
      const ids = Array.isArray(value) ? value : single;

      ids
        .map((id) => options.find((option) => option.id === id))
        .filter((option): option is SelectOption => option !== undefined)
        .forEach((option) => cell.appendChild(createOptionPill(option)));
      break;
    }
    case 'checkbox':
      renderCheckbox(cell, value, ctx);
      break;
    case 'date':
      cell.textContent = formatDateText(value, resolveLocale(ctx.locale), ctx.hourCycle)
        ?? (typeof value === 'string' ? value : '');
      break;
    case 'url':
      if (typeof value === 'string' && value !== '') {
        renderUrl(cell, value, ctx);
      }
      break;
    case 'title':
    case 'text':
    case 'number':
    case 'richText':
      cell.textContent = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
      break;
  }

  return cell;
};
