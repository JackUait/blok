import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PersonalViewEdits } from '../../../../src/tools/database/database-view-state';
import type { DatabaseViewConfig, DatabaseViewStateStore } from '../../../../src/tools/database/types';

const view = (overrides: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id: 'v1', name: 'V', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...overrides,
});

const memoryFallback = (): { get: (key: string) => unknown; set: (key: string, value: unknown) => void; data: Map<string, unknown> } => {
  const data = new Map<string, unknown>();

  return { get: (key) => data.get(key), set: (key, value) => { data.set(key, value); }, data };
};

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('PersonalViewEdits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lays a person\'s filters and sorts over the saved view', () => {
    const edits = new PersonalViewEdits({ fallback: memoryFallback(), onChange: vi.fn() });
    const sorts = [{ id: 's', propertyId: 'p', direction: 'desc' as const }];

    edits.set('v1', { sorts });

    expect(edits.has('v1')).toBe(true);
    expect(edits.effective(view({ name: 'Saved' }))).toEqual(view({ name: 'Saved', sorts }));
    expect(edits.effective(view({ id: 'v2' }))).toEqual(view({ id: 'v2' }));
  });

  it('keeps edits in this browser when the host gives no store', () => {
    const fallback = memoryFallback();
    const first = new PersonalViewEdits({ fallback, onChange: vi.fn() });

    first.set('v1', { filters: [{ id: 'f', propertyId: 'p', operator: 'is_empty', value: null }] });

    const second = new PersonalViewEdits({ fallback, onChange: vi.fn() });

    expect(second.get('v1').filters).toHaveLength(1);
  });

  it('clears the edits on reset', () => {
    const fallback = memoryFallback();
    const edits = new PersonalViewEdits({ fallback, onChange: vi.fn() });

    edits.set('v1', { sorts: [] });
    edits.clear('v1');

    expect(edits.has('v1')).toBe(false);
    expect(new PersonalViewEdits({ fallback, onChange: vi.fn() }).has('v1')).toBe(false);
  });

  it('reads and writes through the host store', async () => {
    const store: DatabaseViewStateStore = {
      get: vi.fn().mockResolvedValue({ sorts: [{ id: 's', propertyId: 'p', direction: 'asc' }], name: 'ignored' }),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const onChange = vi.fn();
    const edits = new PersonalViewEdits({ store, fallback: memoryFallback(), onChange });

    await edits.load(['v1']);

    expect(edits.get('v1')).toEqual({ sorts: [{ id: 's', propertyId: 'p', direction: 'asc' }] });
    expect(onChange).toHaveBeenCalledTimes(1);

    edits.clear('v1');
    await flush();

    expect(store.set).toHaveBeenCalledWith('v1', {});
  });

  it('survives a store that throws', async () => {
    const store: DatabaseViewStateStore = {
      get: vi.fn().mockRejectedValue(new Error('offline')),
      set: vi.fn().mockRejectedValue(new Error('offline')),
    };
    const edits = new PersonalViewEdits({ store, fallback: memoryFallback(), onChange: vi.fn() });

    await edits.load(['v1']);
    edits.set('v1', { sorts: [] });
    await flush();

    expect(edits.has('v1')).toBe(true);
  });

  it('drops a stored patch whose fields have the wrong shape', () => {
    const fallback = memoryFallback();

    fallback.set('view:v1', { filters: 'nope', sorts: [{ id: 's', propertyId: 'p', direction: 'asc' }] });

    expect(new PersonalViewEdits({ fallback, onChange: vi.fn() }).get('v1')).toEqual({
      sorts: [{ id: 's', propertyId: 'p', direction: 'asc' }],
    });
  });
});
