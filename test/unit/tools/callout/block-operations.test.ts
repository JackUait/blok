// test/unit/tools/callout/block-operations.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('saveCallout', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns text from textElement innerHTML, plus emoji and color from data', async () => {
    const { saveCallout } = await import('../../../../src/tools/callout/block-operations');
    const textElement = document.createElement('div');
    textElement.innerHTML = '<b>Hello</b>';

    const result = saveCallout({ textElement, emoji: '💡', color: 'blue' });

    expect(result).toEqual({ text: '<b>Hello</b>', emoji: '💡', color: 'blue' });
  });

  it('returns empty string for text when textElement is empty', async () => {
    const { saveCallout } = await import('../../../../src/tools/callout/block-operations');
    const textElement = document.createElement('div');
    textElement.innerHTML = '';

    const result = saveCallout({ textElement, emoji: '', color: 'default' });

    expect(result.text).toBe('');
  });
});
