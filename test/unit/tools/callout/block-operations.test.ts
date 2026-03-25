// test/unit/tools/callout/block-operations.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('saveCallout', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns emoji and color only (no text field)', async () => {
    const { saveCallout } = await import('../../../../src/tools/callout/block-operations');

    const result = saveCallout({ emoji: '💡', color: 'blue' });

    expect(result).toEqual({ emoji: '💡', color: 'blue' });
    expect(result).not.toHaveProperty('text');
  });

  it('returns default values when given defaults', async () => {
    const { saveCallout } = await import('../../../../src/tools/callout/block-operations');

    const result = saveCallout({ emoji: '', color: 'default' });

    expect(result).toEqual({ emoji: '', color: 'default' });
  });
});
