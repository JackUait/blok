import { IconAlarm, IconCheck, IconPageEmpty, IconWarning } from '../../../components/icons';
import { DATA_ATTR } from '../../../components/constants/data-attributes';
import { hide as hideHint, onHover, show as showHint } from '../../../components/utils/tooltip';
import { safeHref, safeImageSrc, urlScheme } from '../../../components/utils/sanitize-url';
import type { PlaceValue, PropertyDefinition, PropertyValue, SelectOption } from '../types';
import { filesOf, personIdsOf, statusGroupOf } from '../property-values';
import { relationIdsOf } from '../relation-values';
import { isPlaceValue, placeText, verificationStatus } from '../tier3-values';
import { reminderDueAt } from '../reminders';
import { formatDateDisplay, resolveLocale } from './date-format';
import { formatNumberValue, numberFill } from './number-format';
import { optionColorOf, shownStatusOption } from './option-colors';
import type { CellContext } from './types';
import type { FormulaProblem } from '../computed-properties';
import { formulaErrorKey } from '../formula';

export const optionsFor = (property: PropertyDefinition, ctx: Pick<CellContext, 'options'>): SelectOption[] =>
  ctx.options ?? property.config?.options ?? [];

/** A set reminder: an alarm after the date, and the date in the accent (database.css `[data-reminder]`). */
const renderReminder = (cell: HTMLElement, label: string): void => {
  const alarm = document.createElement('span');

  cell.setAttribute('data-reminder', '');
  alarm.setAttribute('data-blok-database-date-reminder', '');
  alarm.setAttribute('role', 'img');
  alarm.setAttribute('aria-label', label);
  alarm.innerHTML = IconAlarm;
  cell.appendChild(alarm);
};

/** A colored option pill. Colors come from `[data-color]` in database.css. */
export const createOptionPill = (option: Pick<SelectOption, 'label' | 'color'>): HTMLSpanElement => {
  const pill = document.createElement('span');

  pill.setAttribute('data-blok-database-option-pill', '');
  pill.setAttribute('data-color', optionColorOf(option));
  pill.textContent = option.label;

  return pill;
};

/** A group header's pill: a status option looks as its cell draws it, dot and all. */
export const createGroupPill = (option: SelectOption, property: PropertyDefinition | undefined): HTMLSpanElement => {
  // Grouped by status group, the "option" is a group: its header look is unmeasured, so it stays plain.
  const group = property?.type === 'status' ? statusGroupOf(property, option.id) : undefined;

  if (group === undefined) {
    return createOptionPill(option);
  }
  const pill = createOptionPill(shownStatusOption(option));

  pill.setAttribute('data-status-group', group.kind);

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

/** notion-spec-2 §22.1: the scheme and `www.` are hidden. */
const shortUrl = (url: string): string => url.replace(/^https?:\/\//i, '').replace(/^www\./i, '');

/** notion-spec-2 §22.1: a path of 13+ characters shows its first 4, "…", its last 6, at any width. The threshold was read with an 11-character host only. */
const cutPath = (path: string): string => (path.length < 13 ? path : `${path.slice(0, 4)}…${path.slice(-6)}`);

/** research/22 §3: Notion links a typed "example.org" to http://example.org/. Without it the href resolves against the page. */
const urlHref = (url: string): string | null =>
  safeHref(urlScheme(url) === null && /^[^/#?.\s]+\.[^\s]/.test(url.trim()) ? `http://${url.trim()}` : url);

/** notion-spec-2 §18.1, §20.7: a short address greys its path unless the property shows the full URL. */
const renderUrl = (cell: HTMLElement, url: string, ctx: CellContext, showFullUrl: boolean): void => {
  const href = urlHref(url);
  const short = href !== null && ctx.shortUrls === true;
  const text = short ? shortUrl(url) : url;
  const at = text.search(/[/?#]/);
  const scheme = urlScheme(url);
  // Another scheme keeps its own slashes, so it is never cut.
  const cut = short && !showFullUrl && at > 0 && (scheme === null || /^https?:$/i.test(scheme));

  const host = text.slice(0, at);
  const path = cutPath(text.slice(at));

  renderLink(cell, cut ? host + path : text, href, ctx, ctx.followLinks);
  const link = cell.querySelector('a');

  if (!cut || link === null) return;
  const grey = document.createElement('span');

  grey.setAttribute('data-blok-database-url-path', '');
  grey.textContent = path;
  link.replaceChildren(host, grey);
};

/** `?` and `&` are encoded, so an address cannot add `?bcc=` or other headers. */
export const mailtoHref = (email: string): string | null =>
  email.trim() === '' ? null : safeHref(`mailto:${encodeURIComponent(email.trim()).replace(/%40/g, '@')}`);

/** Only dialable characters reach `tel:`. */
export const telHref = (phone: string): string | null => {
  const dialable = phone.replace(/[^\d+*#]/g, '');

  return /\d/.test(dialable) ? safeHref(`tel:${dialable}`) : null;
};

const renderLink = (cell: HTMLElement, text: string, href: string | null, ctx: CellContext, follow = false): void => {
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
  if (follow || ctx.readOnly) {
    // Core's own link click would window.open the href without noopener; the browser follows target and rel.
    link.setAttribute(DATA_ATTR.linkOwner, '');
  }
  // Without `follow` a plain click edits the cell; Cmd/Ctrl-click opens the link.
  link.addEventListener('click', (event) => {
    if (!follow && !ctx.readOnly && !event.metaKey && !event.ctrlKey) {
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
  const shownAs = display.showAs === 'bar' || display.showAs === 'ring' ? display.showAs : undefined;
  const label = formatNumberValue(n, display, resolveLocale(ctx.locale));

  if (shownAs === undefined || display.showNumber !== false) {
    const text = document.createElement('span');

    text.setAttribute('data-blok-database-number-text', '');
    text.textContent = label;
    cell.appendChild(text);
  }

  if (shownAs === undefined) {
    return;
  }

  const gauge = document.createElement('span');
  const fill = Math.round(numberFill(n, display) * 100);

  gauge.setAttribute(shownAs === 'bar' ? 'data-blok-database-number-bar' : 'data-blok-database-number-ring', '');
  gauge.setAttribute('data-color', optionColorOf({ color: display.color }));
  if (cell.childElementCount === 0) {
    // With no number beside it, the gauge is what a screen reader reads.
    gauge.setAttribute('role', 'img');
    gauge.setAttribute('aria-label', label);
  } else {
    gauge.setAttribute('aria-hidden', 'true');
  }
  gauge.style.setProperty('--blok-database-number-fill', `${fill}%`);
  if (shownAs === 'ring') gauge.appendChild(ringSvg(fill));
  cell.appendChild(gauge);
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/** notion-spec-2 §7: viewBox 14 drawn at 21px, so the 2-unit stroke is 3px. Colours come from database.css. */
const ringSvg = (fill: number): SVGSVGElement => {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const circle = (attribute: string): SVGCircleElement => {
    const c = document.createElementNS(SVG_NS, 'circle');

    c.setAttribute(attribute, '');
    c.setAttribute('cx', '7');
    c.setAttribute('cy', '7');
    c.setAttribute('r', '6');
    c.setAttribute('fill', 'none');
    c.setAttribute('stroke-width', '2');
    svg.appendChild(c);

    return c;
  };

  svg.setAttribute('viewBox', '0 0 14 14');
  circle('data-blok-database-number-ring-track');
  // A round cap would draw a dot at zero.
  if (fill > 0) {
    const arc = circle('data-blok-database-number-ring-arc');

    arc.setAttribute('pathLength', '100');
    arc.setAttribute('stroke-dasharray', `${fill} 100`);
    arc.setAttribute('stroke-linecap', 'round');
    arc.setAttribute('transform', 'rotate(-90 7 7)');
  }

  return svg;
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

  const pill = createOptionPill(shownStatusOption(option));

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

/** An anonymous form answer's author (research/23 §6): a blank round avatar and "Anonymous". */
const renderAnonymous = (cell: HTMLElement, ctx: CellContext): void => {
  const chip = document.createElement('span');
  const avatar = document.createElement('span');

  chip.setAttribute('data-blok-database-person-chip', '');
  chip.setAttribute('data-anonymous', '');
  avatar.setAttribute('data-blok-database-person-initial', '');
  avatar.setAttribute('aria-hidden', 'true');
  chip.append(avatar, ctx.i18n.t('tools.database.personAnonymous'));
  cell.appendChild(chip);
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

/**
 * notion-spec-2 §21.3, §21.4: a file chip whose name is cut shows the full
 * name 6px below it. A name that fits shows nothing. Wired by the table, the
 * side peek and the gallery card, where Notion was measured.
 */
export const bindFileNameHint = (chip: HTMLElement): void => {
  // The link carries `text-overflow`; an unsafe href leaves the name as bare text in the chip.
  const name = chip.querySelector<HTMLElement>('[data-blok-database-cell-link]') ?? chip;
  const pointer = { touch: false };

  chip.addEventListener('pointerenter', (event) => {
    pointer.touch = event.pointerType === 'touch';
  });
  chip.addEventListener('mouseenter', () => {
    const popover = document.querySelector('[data-blok-popover-opened="true"]');

    if (pointer.touch || (popover !== null && !popover.contains(chip)) || name.scrollWidth <= name.clientWidth) return;
    showHint(chip, name.textContent ?? '', { placement: 'bottom', gap: 6 });
  });
  chip.addEventListener('mouseleave', hideHint);
  // A press opens the editor, which the hint would cover.
  chip.addEventListener('pointerdown', hideHint, { capture: true });
};

const renderRelation = (cell: HTMLElement, property: PropertyDefinition, value: PropertyValue | undefined, ctx: CellContext): void => {
  for (const id of relationIdsOf(value)) {
    const title = ctx.relationTitle?.(property, id);
    const chip = document.createElement('span');
    const open = ctx.openRelated;

    const icon = document.createElement('span');
    const name = document.createElement('span');

    chip.setAttribute('data-blok-database-relation-chip', '');
    chip.setAttribute('data-row-id', id);
    icon.setAttribute('data-blok-database-relation-chip-icon', '');
    icon.setAttribute('aria-hidden', 'true');
    const emoji = ctx.relationIcon?.(property, id);

    // notion-spec-2 §21.6: CSS draws the emoji, so the chip's textContent stays the bare title.
    if (emoji !== undefined && emoji !== '') {
      icon.setAttribute('data-emoji', emoji);
    } else {
      // Without the markup's whitespace, for the same reason.
      icon.innerHTML = IconPageEmpty.trim().replace(/>\s+</g, '><');
    }
    name.setAttribute('data-blok-database-relation-chip-title', '');
    name.textContent = title === undefined || title === '' ? ctx.i18n.t('tools.database.relationUntitled') : title;
    chip.append(icon, name);
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
  value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
  || (isPlaceValue(value) && placeText(value) === '');

const VERIFICATION_LABEL_KEYS = {
  verified: 'tools.database.verificationVerified',
  expired: 'tools.database.verificationExpired',
  unverified: 'tools.database.verificationUnverified',
} as const;

/** Hovering a place shows its name, address and, if the host can draw one, a small map (research/20 §1d). */
const attachPlaceCard = (cell: HTMLElement, place: PlaceValue, ctx: CellContext): void => {
  const card = document.createElement('div');
  const name = document.createElement('div');
  const title = placeText(place);

  card.setAttribute('data-blok-database-place-card', '');
  name.setAttribute('data-blok-database-place-card-name', '');
  name.textContent = title;
  card.appendChild(name);
  if (place.address !== undefined && place.address !== '' && place.address !== title) {
    const address = document.createElement('div');

    address.setAttribute('data-blok-database-place-card-address', '');
    address.textContent = place.address;
    card.appendChild(address);
  }
  const renderPlace = ctx.renderPlace;

  if (renderPlace !== undefined) {
    const map = document.createElement('div');
    const state: { handle: { destroy(): void } | null; drawn: boolean; frame: number | null; hovered: boolean } = { handle: null, drawn: false, frame: null, hovered: false };
    // The hint attaches the card after its delay and marks it closed on hide.
    const shown = (): boolean => card.isConnected && card.closest('[data-state="closed"]') === null;
    const watch = (): void => {
      state.frame = null;
      if (!state.drawn && shown()) {
        state.drawn = true;
        try {
          state.handle = renderPlace(map, place) ?? null;
        } catch {
          map.remove();

          return;
        }
      }
      if (state.drawn && !shown()) {
        // One live map at a time: a WebGL map per hovered cell would run out of contexts.
        state.handle?.destroy();
        state.handle = null;
        state.drawn = false;
        map.replaceChildren();

        return;
      }
      // Waiting for a card that will not come: the pointer left before the hint showed.
      if (!state.drawn && !state.hovered) return;
      state.frame = requestAnimationFrame(watch);
    };

    map.setAttribute('data-blok-database-place-card-map', '');
    card.appendChild(map);
    cell.addEventListener('mouseenter', () => {
      state.hovered = true;
      if (state.frame === null) state.frame = requestAnimationFrame(watch);
    });
    cell.addEventListener('mouseleave', () => {
      state.hovered = false;
    });
  }
  // notion-spec-2 §19.18: a white card, left edge on the table cell, 6px below the row. The delay stays Blok's hint delay.
  onHover(cell, card, {
    placement: 'bottom',
    align: 'start',
    gap: 6,
    surface: true,
    anchor: (trigger) => trigger.closest<HTMLElement>('[data-blok-database-table-cell]') ?? trigger,
  });
};

/** A formula with no value: a muted mark, the reason as its label and its hover hint. */
const renderFormulaProblem = (problem: FormulaProblem, ctx: CellContext): HTMLElement => {
  const cell = document.createElement('span');
  const mark = document.createElement('span');
  const reason = problem.kind === 'limit'
    ? ctx.i18n.t('tools.database.formulaLimitReached')
    : ctx.i18n.t(formulaErrorKey(problem.code), problem.params);

  cell.setAttribute('data-blok-database-cell', 'formula');
  cell.setAttribute('data-formula-error', problem.kind);
  mark.setAttribute('data-blok-database-formula-error', '');
  mark.setAttribute('role', 'img');
  mark.setAttribute('aria-label', reason);
  mark.innerHTML = IconWarning;
  cell.appendChild(mark);
  onHover(cell, reason);

  return cell;
};

/**
 * Show original or unique values of a Number (notion-spec-2 §13, §14.5): the
 * value is the ", "-joined list, and String() of a finite number never holds
 * ", ". Each number takes the rollup's format; a gauge draws one item per
 * number, with no comma.
 */
const renderNumberList = (cell: HTMLElement, property: PropertyDefinition, value: PropertyValue | undefined, ctx: CellContext): void => {
  const display = property.number ?? {};
  const numbers = (typeof value === 'string' && value !== '' ? value.split(', ') : []).map(toNumber);

  cell.setAttribute('data-blok-database-number-list', '');
  if (display.showAs !== 'bar' && display.showAs !== 'ring') {
    cell.replaceChildren(numbers.map((n) => (n === undefined ? '' : formatNumberValue(n, display, resolveLocale(ctx.locale)))).join(', '));

    return;
  }
  numbers.forEach((n) => {
    const item = document.createElement('span');

    item.setAttribute('data-blok-database-number-item', '');
    renderNumber(item, property, n, ctx);
    cell.appendChild(item);
  });
};

/**
 * Read-only display of one cell value. Never parses the value as HTML. The
 * element carries `data-blok-database-cell="<type>"`, and `data-empty` when
 * there is no value.
 */
export const renderCellValue = (property: PropertyDefinition, value: PropertyValue | undefined, ctx: CellContext): HTMLElement => {
  const problem = property.type === 'formula' && ctx.rowId !== undefined ? ctx.formulaProblem?.(property, ctx.rowId) : undefined;

  if (problem !== undefined) return renderFormulaProblem(problem, ctx);
  if (property.type === 'formula' || property.type === 'rollup') {
    const shown = ctx.valueProperty?.(property) ?? { ...property, type: 'text' };
    const computed = renderCellValue(shown.type === property.type ? { ...shown, type: 'text' } : shown, value, ctx);

    if (property.type === 'rollup' && shown.type === 'text' && shown.number !== undefined) {
      computed.replaceChildren();
      renderNumberList(computed, shown, value, ctx);
    }

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
      cell.textContent = formatDateDisplay(value, resolveLocale(ctx.locale), property.date, ctx.now, ctx.hourCycle, ctx.i18n)
        ?? (typeof value === 'string' ? value : '');
      if (property.type === 'date' && ctx.reminder !== undefined && reminderDueAt(value, ctx.reminder, property.date?.timeZone) !== null) {
        renderReminder(cell, ctx.i18n.t('tools.database.dateReminderSet', { reminder: ctx.i18n.t(`tools.database.dateRemind.${ctx.reminder}`) }));
      }
      break;
    case 'url':
      if (typeof value === 'string' && value !== '') {
        renderUrl(cell, value, ctx, property.url?.showFullUrl === true);
      }
      break;
    case 'email':
      if (typeof value === 'string' && value !== '') {
        renderLink(cell, value, mailtoHref(value), ctx, ctx.followLinks);
      }
      break;
    case 'phone':
      if (typeof value === 'string' && value !== '') {
        renderLink(cell, value, telHref(value), ctx, ctx.followLinks);
      }
      break;
    case 'number':
      renderNumber(cell, property, value, ctx);
      break;
    case 'createdBy':
      if (ctx.anonymous === true && personIdsOf(value).length === 0) {
        cell.removeAttribute('data-empty');
        renderAnonymous(cell, ctx);
      } else {
        renderPeople(cell, value, ctx);
      }
      break;
    case 'person':
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
    case 'button': {
      // The database tool runs the actions from one delegated click listener.
      const button = document.createElement('button');
      const label = property.button?.label;

      button.type = 'button';
      button.setAttribute('data-blok-database-button', '');
      button.setAttribute('data-property-id', property.id);
      button.textContent = label !== undefined && label !== '' ? label : property.name;
      button.disabled = ctx.readOnly;
      cell.removeAttribute('data-empty');
      cell.appendChild(button);
      break;
    }
    case 'place':
      cell.textContent = placeText(value);
      if (isPlaceValue(value) && placeText(value) !== '') attachPlaceCard(cell, value, ctx);
      break;
    case 'verification': {
      const status = verificationStatus(value, ctx.now);

      cell.setAttribute('data-verification', status);
      // Unverified is a state with a label, so the peek and cards show it as the table does.
      cell.removeAttribute('data-empty');
      cell.textContent = ctx.i18n.t(VERIFICATION_LABEL_KEYS[status]);
      break;
    }
    default:
      // A type from a newer client shows empty.
      break;
  }

  return cell;
};
