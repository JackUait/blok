// test/unit/tools/callout/block-operations.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('saveCallout', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns emoji, textColor, and backgroundColor', async () => {
    const { saveCallout } = await import('../../../../src/tools/callout/block-operations');

    const result = saveCallout({ emoji: '💡', textColor: 'blue', backgroundColor: 'green' });

    expect(result).toEqual({ emoji: '💡', textColor: 'blue', backgroundColor: 'green' });
  });

  it('returns null colors for defaults', async () => {
    const { saveCallout } = await import('../../../../src/tools/callout/block-operations');

    const result = saveCallout({ emoji: '', textColor: null, backgroundColor: null });

    expect(result).toEqual({ emoji: '', textColor: null, backgroundColor: null });
  });
});
