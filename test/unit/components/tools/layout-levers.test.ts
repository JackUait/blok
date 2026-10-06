import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { Column } from '../../../../src/tools/column';
import { ColumnList } from '../../../../src/tools/column-list';
import { CalloutTool } from '../../../../src/tools/callout';
import { ToggleItem } from '../../../../src/tools/toggle';

type Levers = { deletesChildren?: boolean; isLayout?: boolean };

describe('layout levers declared by Blok tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['Column', Column],
    ['ColumnList', ColumnList],
  ])('%s deletes its children and is layout', (_name, tool) => {
    const levers = tool as unknown as Levers;

    expect(levers.deletesChildren).toBe(true);
    expect(levers.isLayout).toBe(true);
  });

  // Deleting these keeps their body: children are promoted.
  it.each([
    ['CalloutTool', CalloutTool],
    ['ToggleItem', ToggleItem],
  ])('%s declares neither lever', (_name, tool) => {
    const levers = tool as unknown as Levers;

    expect(levers.deletesChildren).toBeUndefined();
    expect(levers.isLayout).toBeUndefined();
  });
});
