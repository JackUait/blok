import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sortedSelectOptions } from '../../../../src/shared/database/value-helpers';
import type { PropertyDefinition } from '../../../../src/shared/database/types';

const property = (extra: Partial<PropertyDefinition> = {}): PropertyDefinition => ({
  id: 'p', name: 'Stage', type: 'select', position: 'a0', config: { options: [
    { id: 'b', label: 'Build', position: 'a1' },
    { id: 'i', label: 'Idea', position: 'a0' },
    { id: 's', label: 'Ship', position: 'a2' },
    { id: 'b2', label: 'Build', position: 'a3' },
  ] },
  ...extra,
});

const ids = (p: PropertyDefinition): string[] => sortedSelectOptions(p).map((option) => option.id);

describe('sortedSelectOptions (notion-spec-2 §17.3 Sort)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Manual, the default, keeps the saved order', () => {
    expect(ids(property())).toEqual(['i', 'b', 's', 'b2']);
  });

  it('Alphabetical orders by label; equal labels keep their saved order', () => {
    expect(ids(property({ optionSort: 'alphabetical' }))).toEqual(['b', 'b2', 'i', 's']);
  });

  it('Reverse alphabetical orders by label backwards; equal labels keep their saved order', () => {
    expect(ids(property({ optionSort: 'reverseAlphabetical' }))).toEqual(['s', 'i', 'b', 'b2']);
  });

  it('orders a list given apart from the property', () => {
    const shown = sortedSelectOptions(property({ optionSort: 'alphabetical' }), [
      { id: 'z', label: 'Zed', position: 'a0' },
      { id: 'a', label: 'Ant', position: 'a1' },
    ]);

    expect(shown.map((option) => option.id)).toEqual(['a', 'z']);
  });
});
