import { parseStoredDate } from './dates';
import { filesOf, personIdsOf } from '../property-values';
import { T, listOf } from './types';
import type { FormulaType, FormulaValue } from './types';
import type { PropertyDefinition, PropertyValue } from '../types';

/**
 * Formula type per property type, from the help page's Properties table.
 * Keyed by string: `relation` is not a Blok property type yet.
 */
const PROPERTY_TYPES: Record<string, FormulaType> = {
  title: T.text,
  text: T.text,
  url: T.text,
  richText: T.text,
  select: T.text,
  number: T.number,
  checkbox: T.boolean,
  date: T.date,
  multiSelect: listOf(T.text),
  status: T.text,
  email: T.text,
  phone: T.text,
  uniqueId: T.text,
  files: listOf(T.text),
  createdTime: T.date,
  lastEditedTime: T.date,
  createdBy: T.person,
  lastEditedBy: T.person,
  person: listOf(T.person),
  relation: listOf(T.page),
};

export const propertyFormulaType = (property: PropertyDefinition): FormulaType | undefined => PROPERTY_TYPES[String(property.type)];

const ids = (value: PropertyValue | undefined): string[] => personIdsOf(value);

const label = (property: PropertyDefinition, id: string): string => property.config?.options.find((o) => o.id === id)?.label ?? id;

/** A stored cell value as the formula sees it. Empty text is "", an empty number or date is empty. */
export const propertyFormulaValue = (property: PropertyDefinition, value: PropertyValue | undefined, timeZone: string | undefined): FormulaValue => {
  switch (String(property.type)) {
    case 'number': {
      const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;

      return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
    }
    case 'checkbox': return value === true;
    case 'date': return typeof value === 'string' ? parseStoredDate(value, timeZone) : null;
    case 'select': return typeof value === 'string' && value !== '' ? label(property, value) : '';
    case 'multiSelect': return ids(value).map((id) => label(property, id));
    case 'person': return ids(value).map((id) => ({ kind: 'person', id }));
    case 'createdBy':
    case 'lastEditedBy': {
      const [id] = ids(value);

      return id === undefined ? null : { kind: 'person', id };
    }
    case 'status': return typeof value === 'string' && value !== '' ? label(property, value) : '';
    case 'createdTime':
    case 'lastEditedTime':
      return typeof value === 'string' ? parseStoredDate(value, timeZone) : null;
    case 'files': return filesOf(value).map((file) => file.name);
    case 'uniqueId': {
      const prefix = property.uniqueId?.prefix;

      return typeof value === 'number' ? `${prefix !== undefined && prefix !== '' ? `${prefix}-` : ''}${value}` : '';
    }
    case 'relation': return ids(value).map((id) => ({ kind: 'page', id }));
    default: return typeof value === 'string' ? value : '';
  }
};
