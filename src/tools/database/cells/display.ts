import { IconCheck } from '../../../components/icons';
import { safeHref, safeImageSrc } from '../../../components/utils/sanitize-url';
import type { PropertyDefinition, PropertyValue, SelectOption } from '../types';
import { filesOf, personIdsOf, statusGroupOf } from '../property-values';
import { relationIdsOf } from '../relation-values';
import { formatDateDisplay, resolveLocale } from './date-format';
import { formatNumberValue, numberFill } from './number-format';
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
  renderCheckState(cell, value === true, ctx);
};

const renderCheckState = (cell: HTMLElement, checked: boolean, ctx: CellContext): void => {
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

const renderUrl = (cell: HTMLElement, url: string, ctx: CellContext): void => {
  renderLink(cell, url, safeHref(url), ctx);
};

/** `?` and `&` are encoded, so an address cannot add `?bcc=` or other headers. */
export const mailtoHref = (email: string): string | null =>
  email.trim() === '' ? null : safeHref(`mailto:${encodeURIComponent(email.trim()).replace(/%40/g, '@')}`);

/** Only dialable characters reach `tel:`. */
export const telHref = (phone: string): string | null => {
  const dialable = phone.replace(/[^\d+*#]/g, '');

  return /\d/.test(dialable) ? safeHref(`tel:${dialable}`) : null;
};

const renderLink = (cell: HTMLElement, text: string, href: string | null, ctx: CellContext): void => {
  if (href === null) {
    cell.append(text);

    return;
  }

  const link = document.createElement('a');

  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = text;
  link.setAttribute('data-blok-database-cell-link', '');
  // A plain click edits the cell; Cmd/Ctrl-click opens the link.
  link.addEventListener('click', (event) => {
    if (!ctx.readOnly && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
    }
  });
  cell.appendChild(link);
};

const toNumber = (value: PropertyValue | undefined): number | undefined => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;

  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

const renderNumber = (cell: HTMLElement, property: PropertyDefinition, value: PropertyValue | undefined, ctx: CellContext): void => {
  const n = toNumber(value);

  if (n === undefined) {
    cell.replaceChildren(typeof value === 'string' ? value : '');

    return;
  }

  const display = property.number ?? {};
  const text = document.createElement('span');

  text.setAttribute('data-blok-database-number-text', '');
  text.textContent = formatNumberValue(n, display, resolveLocale(ctx.locale));
  cell.appendChild(text);

  if (display.showAs !== 'bar' && display.showAs !== 'ring') {
    return;
  }

  const gauge = document.createElement('span');

  gauge.setAttribute(display.showAs === 'bar' ? 'data-blok-database-number-bar' : 'data-blok-database-number-ring', '');
  gauge.setAttribute('data-color', optionColorOf({ color: display.color }));
  gauge.setAttribute('aria-hidden', 'true');
  gauge.style.setProperty('--blok-database-number-fill', `${Math.round(numberFill(n, display) * 100)}%`);
  cell.appendChild(gauge);
};

const renderStatus = (cell: HTMLElement, property: PropertyDefinition, value: PropertyValue | undefined, ctx: CellContext): void => {
  const id = typeof value === 'string' ? value : '';
  const group = id === '' ? undefined : statusGroupOf(property, id);

  if (property.status?.showAs === 'checkbox') {
    renderCheckState(cell, group?.kind === 'complete', ctx);

    return;
  }

  const option = optionsFor(property, ctx).find((o) => o.id === id);

  if (option === undefined) {
    return;
  }

  const pill = createOptionPill(option);

  pill.setAttribute('data-status-group', group?.kind ?? 'todo');
  cell.appendChild(pill);
};

const renderPeople = (cell: HTMLElement, value: PropertyValue | undefined, ctx: CellContext): void => {
  for (const id of personIdsOf(value)) {
    const person = ctx.people?.find((p) => p.id === id);
    const chip = document.createElement('span');
    const name = person?.name ?? ctx.i18n.t('tools.database.personUnknown');
    const avatar = person?.avatarUrl === undefined ? null : safeImageSrc(person.avatarUrl);

    chip.setAttribute('data-blok-database-person-chip', '');
    chip.setAttribute('data-person-id', id);
    if (avatar !== null) {
      const img = document.createElement('img');

      img.src = avatar;
      img.alt = '';
      img.setAttribute('data-blok-database-person-avatar', '');
      chip.appendChild(img);
    } else {
      const initial = document.createElement('span');

      // Drawn by CSS from the attribute, so the chip's text stays the name alone.
      initial.setAttribute('data-blok-database-person-initial', person === undefined ? '' : [...name][0] ?? '');
      initial.setAttribute('aria-hidden', 'true');
      chip.appendChild(initial);
    }
    chip.append(name);
    cell.appendChild(chip);
  }
};

const renderFiles = (cell: HTMLElement, value: PropertyValue | undefined, ctx: CellContext): void => {
  for (const file of filesOf(value)) {
    const chip = document.createElement('span');

    chip.setAttribute('data-blok-database-file-chip', '');
    chip.setAttribute('data-file-id', file.id);
    renderLink(chip, file.name, safeHref(file.url), ctx);
    cell.appendChild(chip);
  }
};

const renderRelation = (cell: HTMLElement, property: PropertyDefinition, value: PropertyValue | undefined, ctx: CellContext): void => {
  for (const id of relationIdsOf(value)) {
    const title = ctx.relationTitle?.(property, id);
    const chip = document.createElement('span');
    const open = ctx.openRelated;

    chip.setAttribute('data-blok-database-relation-chip', '');
    chip.setAttribute('data-row-id', id);
    chip.textContent = title === undefined || title === '' ? ctx.i18n.t('tools.database.relationUntitled') : title;
    if (open !== undefined) {
      chip.setAttribute('role', 'link');
      chip.tabIndex = -1;
      chip.addEventListener('click', (event) => {
        // The chip opens the row; the cell around it must not open its editor.
        event.stopPropagation();
        open(property, id);
      });
    }
    cell.appendChild(chip);
  }
};

const isEmpty = (value: PropertyValue | undefined): boolean =>
  value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);

/**
 * Read-only display of one cell value. Never parses the value as HTML. The
 * element carries `data-blok-database-cell="<type>"`, and `data-empty` when
 * there is no value.
 */
export const renderCellValue = (property: PropertyDefinition, value: PropertyValue | undefined, ctx: CellContext): HTMLElement => {
  if (property.type === 'formula' || property.type === 'rollup') {
    const shown = ctx.valueProperty?.(property) ?? { ...property, type: 'text' };
    const computed = renderCellValue(shown.type === property.type ? { ...shown, type: 'text' } : shown, value, ctx);

    computed.setAttribute('data-blok-database-cell', property.type);
    computed.setAttribute('data-result-type', shown.type);

    return computed;
  }
  const cell = document.createElement('span');

  cell.setAttribute('data-blok-database-cell', property.type);
  if (isEmpty(value) && property.type !== 'checkbox') {
    cell.setAttribute('data-empty', '');
  }

  switch (property.type) {
    case 'select':
    case 'multiSelect': {
      const options = optionsFor(property, ctx);

      personIdsOf(value ?? null)
        .map((id) => options.find((option) => option.id === id))
        .filter((option): option is SelectOption => option !== undefined)
        .forEach((option) => cell.appendChild(createOptionPill(option)));
      break;
    }
    case 'status':
      renderStatus(cell, property, value, ctx);
      break;
    case 'checkbox':
      renderCheckbox(cell, value, ctx);
      break;
    case 'date':
    case 'createdTime':
    case 'lastEditedTime':
      cell.textContent = formatDateDisplay(value, resolveLocale(ctx.locale), property.date, ctx.now, ctx.hourCycle)
        ?? (typeof value === 'string' ? value : '');
      break;
    case 'url':
      if (typeof value === 'string' && value !== '') {
        renderUrl(cell, value, ctx);
      }
      break;
    case 'email':
      if (typeof value === 'string' && value !== '') {
        renderLink(cell, value, mailtoHref(value), ctx);
      }
      break;
    case 'phone':
      if (typeof value === 'string' && value !== '') {
        renderLink(cell, value, telHref(value), ctx);
      }
      break;
    case 'number':
      renderNumber(cell, property, value, ctx);
      break;
    case 'person':
    case 'createdBy':
    case 'lastEditedBy':
      renderPeople(cell, value, ctx);
      break;
    case 'files':
      renderFiles(cell, value, ctx);
      break;
    case 'relation':
      renderRelation(cell, property, value, ctx);
      break;
    case 'uniqueId': {
      const n = toNumber(value);
      const prefix = property.uniqueId?.prefix;

      cell.textContent = n === undefined ? '' : `${prefix !== undefined && prefix !== '' ? `${prefix}-` : ''}${n}`;
      break;
    }
    case 'title':
    case 'text':
    case 'richText':
      cell.textContent = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
      break;
    default:
      // A type from a newer client shows empty.
      break;
  }

  return cell;
};
