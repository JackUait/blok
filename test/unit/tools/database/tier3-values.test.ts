import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computeCalculation } from '../../../../src/tools/database/database-calculations';
import { matchCondition, rowMatchesSearch, sortRows } from '../../../../src/tools/database/database-query';
import { valueToText } from '../../../../src/tools/database/property-conversion';
import { verificationStatus } from '../../../../src/tools/database/tier3-values';
import { cellText, valueFromText } from '../../../../src/tools/database/database-table-clipboard';
import { emptyValueOf } from '../../../../src/tools/database/database-table-grid';
import { groupValueForKey } from '../../../../src/tools/database/group-keys';
import type { DatabaseRow, PropertyDefinition, PropertyValue } from '../../../../src/tools/database/types';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const place: PropertyDefinition = { id: 'where', name: 'Where', type: 'place', position: 'a1' };
const check: PropertyDefinition = { id: 'check', name: 'Verified', type: 'verification', position: 'a2' };
const schema: PropertyDefinition[] = [{ id: 'name', name: 'Name', type: 'title', position: 'a0' }, place, check];

const row = (id: string, properties: Record<string, PropertyValue>, position = id): DatabaseRow => ({ id, position, properties });

describe('place values', () => {
  const paris = row('a1', { where: { name: 'Paris office', address: '1 Rue de Rivoli', lat: 48.86, lon: 2.35 } });
  const berlin = row('a2', { where: { address: 'Unter den Linden 1' } }, 'a0');
  const none = row('a3', { where: null });

  it('filter by their name or address text, as Notion does', () => {
    expect(matchCondition(paris, { propertyId: 'where', operator: 'contains', value: 'paris' }, schema)).toBe(true);
    expect(matchCondition(berlin, { propertyId: 'where', operator: 'contains', value: 'linden' }, schema)).toBe(true);
    expect(matchCondition(none, { propertyId: 'where', operator: 'is_empty', value: null }, schema)).toBe(true);
    expect(matchCondition(paris, { propertyId: 'where', operator: 'is_empty', value: null }, schema)).toBe(false);
  });

  it('sort alphabetically, empties last', () => {
    expect(sortRows([none, paris, berlin], [{ propertyId: 'where', direction: 'asc' }], schema).map((r) => r.id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('count as empty only without a name or address, and never crash a calculation', () => {
    expect(computeCalculation('empty', [paris.properties.where, berlin.properties.where, { lat: 1, lon: 2 }, undefined], place))
      .toEqual({ kind: 'number', value: 2 });
  });

  it('copy as their text, paste as an address and clear to null', () => {
    expect(cellText(place, paris.properties.where)).toBe('Paris office');
    expect(valueFromText(place, ' 2 New Rd ')).toEqual({ address: '2 New Rd' });
    expect(emptyValueOf(place)).toBeNull();
    expect(groupValueForKey(place, 'x', {})).toBeUndefined();
  });

  it('copy and search as their text', () => {
    expect(valueToText(paris.properties.where, place)).toBe('Paris office');
    expect(rowMatchesSearch(berlin, 'linden', schema)).toBe(true);
  });
});

describe('verification values', () => {
  const now = new Date('2026-10-09T12:00:00Z');

  it('read as expired past their expiry and verified without one', () => {
    expect(verificationStatus({ state: 'verified', expiresAt: '2026-10-01' }, now)).toBe('expired');
    expect(verificationStatus({ state: 'verified' }, now)).toBe('verified');
    expect(verificationStatus({ state: 'unverified' }, now)).toBe('unverified');
    expect(verificationStatus(null, now)).toBe('unverified');
  });

  it('count an unverified value as empty', () => {
    expect(computeCalculation('not_empty', [{ state: 'verified' }, { state: 'unverified' }, undefined], check))
      .toEqual({ kind: 'number', value: 1 });
  });

  it('copy as their state, never paste, and clear to unverified', () => {
    expect(cellText(check, { state: 'verified', expiresAt: '2000-01-01' })).toBe('expired');
    expect(valueFromText(check, 'verified')).toBeUndefined();
    expect(emptyValueOf(check)).toBeNull();
  });

  it('filter with is empty / is not empty', () => {
    const verified = row('a1', { check: { state: 'verified', verifiedBy: 'u1' } });

    expect(matchCondition(verified, { propertyId: 'check', operator: 'is_not_empty', value: null }, schema)).toBe(true);
    expect(matchCondition(row('a2', {}), { propertyId: 'check', operator: 'is_empty', value: null }, schema)).toBe(true);
  });
});
