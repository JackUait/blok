import { nanoid } from 'nanoid';
import { htmlToPlainText } from '../../components/utils/plain-text';
import { DatabaseModel } from './database-model';
import { parseDateValue } from './cells/date-value';
import { toIsoDay, toIsoTime } from './cells/date-format';
import { pickOptionColor } from './cells/option-colors';
import {
  createDefaultStatusSettings,
  filesOf,
  isComputedType,
  personIdsOf,
  readPropertyValue,
} from './property-values';
import type { OutputData } from '../../../types';
import type {
  ConvertedValue,
  DatabaseRow,
  DatabaseRowData,
  FileValue,
  PropertyDefinition,
  PropertyType,
  PropertyValue,
  SelectOption,
} from './types';

/** Every type a property can change to or from. The title never changes type. */
export const CONVERTIBLE_TYPES: readonly PropertyType[] = [
  'text', 'number', 'select', 'multiSelect', 'status', 'date', 'checkbox', 'url', 'email', 'phone',
  'person', 'files', 'richText', 'uniqueId', 'createdTime', 'lastEditedTime', 'createdBy', 'lastEditedBy',
];

/** A row as the planner reads it: values, metadata, and what earlier changes kept. */
export type ConvertibleRow = DatabaseRow & Pick<DatabaseRowData, 'convertedValues'>;

export interface TypeChangeWrite {
  rowId: string;
  value: PropertyValue;
  /**
   * The original, kept because the new type could not hold it. `null` clears
   * a kept original that this change restored or made stale.
   */
  stash?: ConvertedValue | null;
}

export interface TypeChangePlan {
  /** The property with its new type and any options the change created. */
  property: PropertyDefinition;
  /** Only rows whose stored value changes. */
  writes: TypeChangeWrite[];
}

/** Find or make an option for a label. Returns undefined when the target cannot take new options. */
type EnsureOption = (label: string) => string | undefined;

const OPTION_TYPES: ReadonlySet<PropertyType> = new Set<PropertyType>(['select', 'multiSelect', 'status']);

const TRUE_WORDS = new Set(['true', 'yes', '1', 'checked', '✓', '✔', 'x']);

const LIST_SEPARATOR = ', ';

const isEmptyValue = (value: PropertyValue | undefined): boolean =>
  value === undefined || value === null || value === '' || value === false
  || (Array.isArray(value) && value.length === 0)
  || (typeof value === 'object' && value !== null && !Array.isArray(value) && value.blocks.length === 0);

const optionLabel = (property: PropertyDefinition, id: string): string | undefined =>
  property.config?.options.find((o) => o.id === id)?.label;

const segmentText = (text: unknown): string => {
  if (typeof text === 'string') return htmlToPlainText(text);
  if (!Array.isArray(text)) return '';

  return text.map((seg: unknown) => (typeof seg === 'object' && seg !== null && 'text' in seg && typeof seg.text === 'string' ? seg.text : '')).join('');
};

const documentText = (value: OutputData): string =>
  value.blocks.map((block) => segmentText((block.data as Record<string, unknown> | undefined)?.text)).filter((t) => t !== '').join('\n');

/** A value as text. Lists join with ", ", as Notion writes them. */
export const valueToText = (value: PropertyValue | undefined, property: PropertyDefinition): string => {
  if (value === undefined || value === null) return '';

  switch (property.type) {
    case 'select':
    case 'status':
      return typeof value === 'string' ? optionLabel(property, value) ?? '' : '';
    case 'multiSelect':
      return personIdsOf(value).map((id) => optionLabel(property, id) ?? '').filter((l) => l !== '').join(LIST_SEPARATOR);
    case 'checkbox':
      return value === true ? 'true' : '';
    case 'person':
    case 'createdBy':
    case 'lastEditedBy':
      return personIdsOf(value).join(LIST_SEPARATOR);
    case 'files':
      return filesOf(value).map((file) => file.url).join(LIST_SEPARATOR);
    case 'uniqueId': {
      const prefix = property.uniqueId?.prefix;

      return typeof value === 'number' ? `${prefix !== undefined && prefix !== '' ? `${prefix}-` : ''}${value}` : '';
    }
    case 'createdTime':
    case 'lastEditedTime': {
      const time = typeof value === 'string' ? new Date(value) : null;

      return time === null || Number.isNaN(time.getTime()) ? '' : `${toIsoDay(time)}T${toIsoTime(time)}`;
    }
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
    case 'number':
    case 'date':
    case 'richText':
    default:
      if (typeof value === 'string') return value;
      if (typeof value === 'number') return String(value);
      if (typeof value === 'object' && !Array.isArray(value)) return documentText(value);

      return '';
  }
};

const parseNumber = (text: string): number | null => {
  const cleaned = text.replace(/[\s,]/g, '').replace(/^[^\d+\-.]+/, '').replace(/[^\d.]+$/, '');
  const n = cleaned === '' ? NaN : Number(cleaned);

  return Number.isFinite(n) ? n : null;
};

const parseDate = (text: string): string | null => {
  if (parseDateValue(text) !== null) return text;
  const time = Date.parse(text);

  return Number.isNaN(time) ? null : toIsoDay(new Date(time));
};

const splitList = (text: string): string[] => text.split(',').map((part) => part.trim()).filter((part) => part !== '');

const fileFromUrl = (url: string, mint: () => string): FileValue | null => {
  if (!/^https?:\/\//i.test(url)) return null;
  const name = decodeURIComponent(url.split(/[?#]/)[0].split('/').filter((s) => s !== '').at(-1) ?? url);

  return { id: mint(), name, url };
};

/** Text as a value of `to`. */
const textToValue = (text: string, to: PropertyDefinition, ensure: EnsureOption, mint: () => string): PropertyValue => {
  if (text === '') return null;

  switch (to.type) {
    case 'number': return parseNumber(text);
    case 'checkbox': return TRUE_WORDS.has(text.trim().toLowerCase());
    case 'date': return parseDate(text);
    case 'select':
    case 'status':
      return ensure(text.trim()) ?? null;
    case 'multiSelect': {
      const ids = splitList(text).map((label) => ensure(label)).filter((id): id is string => id !== undefined);

      return ids.length > 0 ? [...new Set(ids)] : null;
    }
    case 'files': {
      const files = splitList(text).map((url) => fileFromUrl(url, mint)).filter((f): f is FileValue => f !== null);

      return files.length > 0 ? files : null;
    }
    case 'richText':
      return { blocks: [{ id: mint(), type: 'paragraph', data: { text } }] };
    // A person is known by id only; a name typed as text cannot be matched.
    case 'person':
    case 'uniqueId':
    case 'createdTime':
    case 'lastEditedTime':
    case 'createdBy':
    case 'lastEditedBy':
      return null;
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
    default:
      return text;
  }
};

/**
 * One value from one type to another. Option, person and file values move
 * directly when both sides share the shape; everything else goes through text.
 */
export const convertValue = (
  value: PropertyValue | undefined,
  from: PropertyDefinition,
  to: PropertyDefinition,
  ensure: EnsureOption,
  mint: () => string = nanoid
): PropertyValue => {
  if (isEmptyValue(value) || value === undefined) return to.type === 'checkbox' ? false : null;

  if (OPTION_TYPES.has(from.type) && OPTION_TYPES.has(to.type)) {
    const ids = personIdsOf(value);

    return to.type === 'multiSelect' ? ids : ids[0] ?? null;
  }
  if (['person', 'createdBy', 'lastEditedBy'].includes(from.type) && to.type === 'person') {
    return personIdsOf(value).map((id) => ({ id }));
  }
  if (from.type === 'uniqueId' && to.type === 'number') {
    return typeof value === 'number' ? value : null;
  }
  if ((from.type === 'createdTime' || from.type === 'lastEditedTime') && to.type === 'date') {
    return valueToText(value, from);
  }

  return textToValue(valueToText(value, from), to, ensure, mint);
};

/** Option lookup by label that never creates one. */
const lookupIn = (property: PropertyDefinition): EnsureOption => (label) =>
  property.config?.options.find((o) => o.label.toLowerCase() === label.toLowerCase())?.id;

const sameValue = (a: PropertyValue | undefined, b: PropertyValue | undefined): boolean =>
  (isEmptyValue(a) && isEmptyValue(b)) || JSON.stringify(a) === JSON.stringify(b);

/** The new property definition: type, plus the settings the new type needs. Options always stay, so a change back finds them. */
const retype = (property: PropertyDefinition, to: PropertyType): PropertyDefinition => {
  const next: PropertyDefinition = { ...property, type: to, config: property.config === undefined ? undefined : { ...property.config, options: [...property.config.options] } };

  if (OPTION_TYPES.has(to) && next.config === undefined) {
    next.config = { options: [] };
  }
  if (next.config === undefined) {
    delete next.config;
  }
  if (to === 'status' && next.status === undefined) {
    next.status = createDefaultStatusSettings();
  }

  return next;
};

/**
 * Everything a type change writes, as one batch for one undo step. Returns
 * null when the change is not allowed: the title never changes type.
 *
 * A value the new type cannot hold, judged by converting it back, is kept
 * on the row under `convertedValues`. Changing back to that type restores it,
 * unless the cell was edited since.
 */
export const planTypeChange = (
  property: PropertyDefinition,
  to: PropertyType,
  rows: ConvertibleRow[],
  mint: () => string = nanoid
): TypeChangePlan | null => {
  if (property.type === 'title' || to === 'title' || property.type === to) {
    return null;
  }

  const target = retype(property, to);
  const options: SelectOption[] = target.config?.options ?? [];
  const ensure: EnsureOption = (label) => {
    if (!OPTION_TYPES.has(to) || label === '') return undefined;
    const found = options.find((o) => o.label.toLowerCase() === label.toLowerCase());

    if (found !== undefined) return found.id;
    const last = [...options].sort((a, b) => (a.position < b.position ? -1 : 1)).at(-1);
    const option: SelectOption = {
      id: mint(),
      label,
      color: pickOptionColor(options),
      position: DatabaseModel.positionBetween(last?.position ?? null, null),
    };

    options.push(option);

    return option.id;
  };
  const writes: TypeChangeWrite[] = [];

  for (const row of rows) {
    const current = readPropertyValue(row, property);
    const kept = row.convertedValues?.[property.id];
    const stillFresh = kept !== undefined && kept.type === to
      && sameValue(convertValue(kept.value, retype(property, kept.type), property, lookupIn(property), mint), current);

    if (stillFresh) {
      writes.push({ rowId: row.id, value: kept.value, stash: null });
      continue;
    }

    const value = convertValue(current, property, target, ensure, mint);
    const stale = kept !== undefined ? { stash: null } : {};
    const unchanged = isComputedType(property.type)
      ? isEmptyValue(value)
      : JSON.stringify(value) === JSON.stringify(current ?? null) || ((current === undefined || current === null) && isEmptyValue(value));

    if (unchanged && kept === undefined) {
      continue;
    }

    const lossless = isComputedType(property.type)
      || isEmptyValue(current)
      || sameValue(convertValue(value, target, property, lookupIn(property), mint), current);

    writes.push({
      rowId: row.id,
      value,
      ...(lossless ? stale : { stash: { type: property.type, value: current ?? null } }),
    });
  }

  if (options.length > 0 || target.config !== undefined) {
    target.config = { ...target.config, options };
  }

  return { property: target, writes };
};
