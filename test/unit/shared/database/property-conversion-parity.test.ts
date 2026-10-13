// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { htmlToPlainText } from '../../../../src/components/utils/plain-text';
import { CONVERTIBLE_TYPES as SHARED_TYPES, typeConversion } from '../../../../src/shared/database/property-conversion';
import { CONVERTIBLE_TYPES, planTypeChange, valueToText } from '../../../../src/tools/database/property-conversion';

import type { ConvertibleRow } from '../../../../src/tools/database/property-conversion';
import type { PropertyDefinition, PropertyType } from '../../../../src/tools/database/types';

const options = [{ id: 'o1', label: 'High', position: 'a0' }, { id: 'o2', label: 'Low', position: 'a1' }];
const SOURCES: PropertyDefinition[] = [
  { id: 'p', name: 'Text', type: 'text', position: 'a1' },
  { id: 'p', name: 'Select', type: 'select', position: 'a1', config: { options } },
  { id: 'p', name: 'Multi', type: 'multiSelect', position: 'a1', config: { options } },
  { id: 'p', name: 'Number', type: 'number', position: 'a1' },
  { id: 'p', name: 'Date', type: 'date', position: 'a1' },
  { id: 'p', name: 'Body', type: 'richText', position: 'a1' },
];
const ROWS: ConvertibleRow[] = [
  { id: 'r1', position: 'a0', properties: { p: 'High' } },
  { id: 'r2', position: 'a1', properties: { p: 'o2' } },
  { id: 'r3', position: 'a2', properties: { p: ['o1', 'o2'] } },
  { id: 'r4', position: 'a3', properties: { p: 42 } },
  { id: 'r5', position: 'a4', properties: { p: '2026-10-13' } },
  { id: 'r6', position: 'a5', properties: { p: { blocks: [{ id: 'b', type: 'paragraph', data: { text: '<b>Hi</b> there' } }] } } },
  { id: 'r7', position: 'a6', properties: {}, convertedValues: { p: { type: 'checkbox', value: true } } },
];

const minter = (): (() => string) => {
  let n = 0;

  return () => `m${(n += 1)}`;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shared type conversion is the editor\'s, unchanged', () => {
  it('lists the same convertible types', () => {
    expect(SHARED_TYPES).toBe(CONVERTIBLE_TYPES);
  });

  it.each(SOURCES.flatMap(source => [...CONVERTIBLE_TYPES, 'title' as PropertyType].map(to => [source.type, to, source] as const)))(
    '%s -> %s plans the same writes', (_from, to, source) => {
      const shared = typeConversion(htmlToPlainText).planTypeChange(source, to, ROWS, minter());

      expect(planTypeChange(source, to, ROWS, minter())).toEqual(shared);
    }
  );

  it('the old valueToText still reads legacy HTML through the DOM', () => {
    expect(valueToText(ROWS[5]?.properties.p, { id: 'p', name: 'Body', type: 'richText', position: 'a1' })).toBe('Hi there');
  });
});
