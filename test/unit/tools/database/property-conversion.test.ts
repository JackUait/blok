import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  CONVERTIBLE_TYPES,
  convertValue,
  planTypeChange,
  type ConvertibleRow,
} from '../../../../src/tools/database/property-conversion';
import { isComputedType } from '../../../../src/tools/database/property-values';
import type { OutputData } from '../../../../types';
import type { DatabaseRow, PropertyDefinition, PropertyType, PropertyValue } from '../../../../src/tools/database/types';

const OPTIONS = [
  { id: 'o-idea', label: 'Idea', color: 'gray', position: 'a0' },
  { id: 'o-build', label: 'Build', color: 'blue', position: 'a1' },
];

const prop = (type: PropertyType, extra: Partial<PropertyDefinition> = {}): PropertyDefinition => ({
  id: 'p',
  name: 'P',
  type,
  position: 'a1',
  // Text keeps the options of an earlier select, as a type change leaves them.
  ...(['select', 'multiSelect', 'status', 'text'].includes(type) ? { config: { options: OPTIONS.map((o) => ({ ...o })) } } : {}),
  ...extra,
});

const doc = (text: string): OutputData => ({ blocks: [{ id: 'b1', type: 'paragraph', data: { text } }] });

let minted = 0;
const mint = (): string => `new-${++minted}`;

/** One non-empty sample per type, as the row stores it. */
const SAMPLES: Record<string, PropertyValue> = {
  text: 'Build',
  url: 'https://example.com',
  email: 'ada@example.com',
  phone: '+1 555 0100',
  number: 42,
  select: 'o-build',
  status: 'o-build',
  multiSelect: ['o-idea', 'o-build'],
  date: '2026-10-09',
  checkbox: true,
  person: [{ id: 'u1' }],
  files: [{ id: 'f1', name: 'brief.pdf', url: 'https://cdn.example.com/brief.pdf' }],
  richText: doc('Hello'),
  uniqueId: 7,
};

const row = (value: PropertyValue, meta?: DatabaseRow['meta']): ConvertibleRow => ({
  id: 'r1',
  position: 'a0',
  properties: { p: value },
  ...(meta !== undefined ? { meta } : {}),
});

describe('property type conversion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    minted = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never converts to or from the title', () => {
    expect(CONVERTIBLE_TYPES).not.toContain('title');
    expect(planTypeChange(prop('title'), 'text', [], mint)).toBeNull();
    expect(planTypeChange(prop('text'), 'title', [], mint)).toBeNull();
  });

  /**
   * Every ordered pair: the converted value is a valid value of the new type,
   * and a value that does not survive the trip back is kept on the row.
   */
  describe.each(CONVERTIBLE_TYPES)('from %s', (from) => {
    it.each(CONVERTIBLE_TYPES.filter((to) => to !== from))('to %s keeps the value or keeps the original', (to) => {
      const source = prop(from);
      const sample = SAMPLES[from] ?? null;
      const plan = planTypeChange(source, to, [row(sample, { createdAt: Date.UTC(2026, 9, 9), createdBy: 'u1', lastEditedAt: Date.UTC(2026, 9, 9), lastEditedBy: 'u2' })], mint);

      expect(plan).not.toBeNull();
      if (plan === null) return;

      expect(plan.property.type).toBe(to);
      const write = plan.writes[0];

      if (write === undefined) {
        // Nothing to write means nothing changed in the stored value.
        return;
      }
      if (isComputedType(from)) {
        // The source still lives in the row metadata: nothing to keep.
        expect(write.stash).toBeUndefined();

        return;
      }
      const back = convertValue(write.value, plan.property, source, (label) => source.config?.options.find((o) => o.label.toLowerCase() === label.toLowerCase())?.id);
      const lossless = JSON.stringify(back) === JSON.stringify(sample);

      expect(lossless || write.stash !== undefined, `${from} → ${to}: ${JSON.stringify(sample)} → ${JSON.stringify(write.value)}`).toBe(true);
      if (write.stash !== undefined && write.stash !== null) {
        expect(write.stash).toEqual({ type: from, value: sample });
      }
    });
  });

  describe('the expected value per pair', () => {
    const cases: Array<[PropertyType, PropertyType, PropertyValue, PropertyValue, boolean]> = [
      // from, to, value, expected, lossy
      ['text', 'number', '1,200.50', 1200.5, true],
      ['text', 'number', '42', 42, false],
      ['text', 'number', 'many', null, true],
      ['number', 'text', 42, '42', false],
      ['text', 'select', 'Build', 'o-build', false],
      ['text', 'select', 'build', 'o-build', true],
      ['text', 'multiSelect', 'Idea, Build', ['o-idea', 'o-build'], false],
      ['text', 'checkbox', 'Yes', true, true],
      ['text', 'checkbox', 'true', true, false],
      ['text', 'date', '2026-10-09', '2026-10-09', false],
      ['text', 'date', 'next week', null, true],
      ['text', 'url', 'https://a.io', 'https://a.io', false],
      ['text', 'email', 'a@b.io', 'a@b.io', false],
      ['text', 'person', 'u1', null, true],
      ['text', 'files', 'https://cdn.example.com/a.pdf', [{ id: 'new-1', name: 'a.pdf', url: 'https://cdn.example.com/a.pdf' }], false],
      ['text', 'richText', 'Hello', { blocks: [{ id: 'new-1', type: 'paragraph', data: { text: 'Hello' } }] }, false],
      ['select', 'text', 'o-build', 'Build', false],
      ['select', 'multiSelect', 'o-build', ['o-build'], false],
      ['select', 'status', 'o-build', 'o-build', false],
      ['status', 'select', 'o-build', 'o-build', false],
      ['multiSelect', 'select', ['o-idea', 'o-build'], 'o-idea', true],
      ['multiSelect', 'text', ['o-idea', 'o-build'], 'Idea, Build', false],
      ['checkbox', 'text', true, 'true', false],
      ['checkbox', 'text', false, null, false],
      ['date', 'text', '2026-10-09/2026-10-12', '2026-10-09/2026-10-12', false],
      ['person', 'text', [{ id: 'u1' }], 'u1', true],
      ['files', 'text', [{ id: 'f1', name: 'a.pdf', url: 'https://x.io/a.pdf' }], 'https://x.io/a.pdf', true],
      ['richText', 'text', doc('Hello <b>world</b>'), 'Hello world', true],
      ['number', 'uniqueId', 3, null, true],
      ['uniqueId', 'number', 3, 3, false],
      ['createdBy', 'person', null, [{ id: 'u1' }], false],
      ['date', 'createdTime', '2026-10-09', null, true],
    ];

    it.each(cases)('%s → %s: %j becomes %j', (from, to, value, expected, lossy) => {
      const plan = planTypeChange(prop(from), to, [row(value, { createdBy: 'u1' })], mint);
      const write = plan?.writes[0];

      // No write means the stored value already fits the new type.
      expect(write === undefined ? value : write.value).toEqual(expected);
      expect(write?.stash !== undefined && write.stash !== null).toBe(lossy);
    });
  });

  it('creates an option per new label when text becomes a select, and reuses existing ones ignoring case', () => {
    const rows = [row('build'), { ...row('Ship'), id: 'r2' }, { ...row('ship'), id: 'r3' }];
    const plan = planTypeChange(prop('text', { config: { options: [{ id: 'o-build', label: 'Build', position: 'a0' }] } }), 'select', rows, mint);
    const options = plan?.property.config?.options ?? [];

    expect(options.map((o) => o.label)).toEqual(['Build', 'Ship']);
    expect(plan?.writes.map((w) => w.value)).toEqual(['o-build', 'new-1', 'new-1']);
  });

  it('gives a new status property the three default groups', () => {
    const plan = planTypeChange(prop('select'), 'status', [], mint);

    expect(plan?.property.status?.groups.map((g) => g.id)).toEqual(['todo', 'inProgress', 'complete']);
  });

  it('turns created time into a date the row stores', () => {
    const plan = planTypeChange(prop('createdTime'), 'date', [row(null, { createdAt: Date.UTC(2026, 9, 9, 12) })], mint);

    expect(plan?.writes[0]?.value).toMatch(/^2026-10-0\d/);
  });

  it('restores the kept original when the property goes back to that type', () => {
    const toNumber = planTypeChange(prop('text'), 'number', [row('007')], mint);

    expect(toNumber?.writes[0]).toEqual({ rowId: 'r1', value: 7, stash: { type: 'text', value: '007' } });

    const back = planTypeChange(prop('number'), 'text', [{ ...row(7), convertedValues: { p: { type: 'text', value: '007' } } }], mint);

    expect(back?.writes[0]).toEqual({ rowId: 'r1', value: '007', stash: null });
  });

  it('does not restore a kept original once the cell was edited after the change', () => {
    const back = planTypeChange(prop('number'), 'text', [{ ...row(8), convertedValues: { p: { type: 'text', value: '007' } } }], mint);

    expect(back?.writes[0]).toEqual({ rowId: 'r1', value: '8', stash: null });
  });

  it('writes nothing for an empty value', () => {
    expect(planTypeChange(prop('text'), 'number', [row(null), { ...row(null), id: 'r2' }], mint)?.writes).toEqual([]);
  });
});
