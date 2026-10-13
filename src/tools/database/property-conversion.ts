import { nanoid } from 'nanoid';
import { htmlToPlainText } from '../../components/utils/plain-text';
import { typeConversion } from '../../shared/database/property-conversion';
import type { ConvertibleRow, TypeChangePlan } from '../../shared/database/property-conversion';
import type { PropertyDefinition, PropertyType, PropertyValue } from './types';

export { CONVERTIBLE_TYPES } from '../../shared/database/property-conversion';
export type { ConvertibleRow, TypeChangePlan, TypeChangeWrite } from '../../shared/database/property-conversion';

// The editor reads legacy HTML rich text through the DOM.
const conversion = typeConversion(htmlToPlainText);

/** A value as text. Lists join with ", ", as Notion writes them. */
export const valueToText = (value: PropertyValue | undefined, property: PropertyDefinition): string =>
  conversion.valueToText(value, property);

/**
 * One value from one type to another. Option, person and file values move
 * directly when both sides share the shape; everything else goes through text.
 */
export const convertValue = (
  value: PropertyValue | undefined,
  from: PropertyDefinition,
  to: PropertyDefinition,
  ensure: (label: string) => string | undefined,
  mint: () => string = nanoid
): PropertyValue => conversion.convertValue(value, from, to, ensure, mint);

/**
 * Everything a type change writes, as one batch for one undo step. Returns
 * null when the change is not allowed: the title never changes type.
 */
export const planTypeChange = (
  property: PropertyDefinition,
  to: PropertyType,
  rows: ConvertibleRow[],
  mint: () => string = nanoid
): TypeChangePlan | null => conversion.planTypeChange(property, to, rows, mint);
