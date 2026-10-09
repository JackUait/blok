import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { loadParityCases } from './corpus';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

it('loads the fourteen core command cases from the real fixture directory', () => {
  expect(loadParityCases().filter(fixture => fixture.name.startsWith('01-')).map(fixture => fixture.name)).toEqual([
    '01-convert-paragraph-to-header',
    '01-delete-everything',
    '01-delete-lifts-children',
    '01-doc-title-icon-clear',
    '01-doc-title-icon-set',
    '01-duplicate-toggle',
    '01-insert-columns-default',
    '01-insert-leaf',
    '01-insert-tree',
    '01-move-into-toggle',
    '01-refs',
    '01-text-format-bold',
    '01-text-insert-delete-replace',
    '01-update-merge-and-null',
  ]);
});
