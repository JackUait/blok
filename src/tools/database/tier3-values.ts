import type { OutputData } from '../../../types';
import type { PlaceValue, PropertyValue, VerificationValue } from './types';

type ObjectValue = Exclude<PropertyValue, string | number | boolean | unknown[] | null>;

const isObjectValue = (value: PropertyValue | undefined): value is ObjectValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A legacy page body. Place and verification values are objects too, so check `blocks`. */
export const isOutputData = (value: PropertyValue | undefined): value is OutputData =>
  isObjectValue(value) && 'blocks' in value && Array.isArray(value.blocks);

export const isVerificationValue = (value: PropertyValue | undefined): value is VerificationValue =>
  isObjectValue(value) && 'state' in value && (value.state === 'verified' || value.state === 'unverified');

export const isPlaceValue = (value: PropertyValue | undefined): value is PlaceValue =>
  isObjectValue(value) && !('blocks' in value) && !('state' in value);

/** What a place shows and filters by: its name, else its address. */
export const placeText = (value: PropertyValue | undefined): string => {
  if (!isPlaceValue(value)) return typeof value === 'string' ? value : '';

  return value.name ?? value.address ?? '';
};

export type VerificationStatus = 'verified' | 'unverified' | 'expired';

/** Expired once `expiresAt` is in the past. */
export const verificationStatus = (value: PropertyValue | undefined, now: Date = new Date()): VerificationStatus => {
  if (!isVerificationValue(value) || value.state !== 'verified') return 'unverified';
  if (value.expiresAt !== undefined && !Number.isNaN(Date.parse(value.expiresAt)) && Date.parse(value.expiresAt) < now.getTime()) return 'expired';

  return 'verified';
};

/** Empty for "is empty", calculations and conversions. */
export const isEmptyObjectValue = (value: ObjectValue): boolean => {
  if (isOutputData(value)) return value.blocks.length === 0;
  if (isVerificationValue(value)) return value.state !== 'verified';

  return placeText(value) === '';
};
