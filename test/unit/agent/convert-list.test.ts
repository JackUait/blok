// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openJsonSession } from './harness';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('block.convert to and from list without a browser', () => {
  it('turns a paragraph into a list item and keeps its marks', async () => {
    const session = openJsonSession({ blocks: [{ id: 'p', type: 'paragraph', data: { text: '<b>Buy</b> milk' } }] });
    const result = await session.execute({ commands: [{ name: 'block.convert', args: { id: 'p', type: 'list' } }] });

    expect(result.ok ? null : result.error).toBeNull();
    expect(session.output().blocks).toEqual([
      expect.objectContaining({ type: 'list', data: expect.objectContaining({ text: [{ text: 'Buy', marks: { bold: true } }, { text: ' milk' }], style: 'unordered' }) }),
    ]);
  });

  it('turns a list item back into a paragraph', async () => {
    const session = openJsonSession({ blocks: [{ id: 'l', type: 'list', data: { text: 'Item', style: 'ordered' } }] });
    const result = await session.execute({ commands: [{ name: 'block.convert', args: { id: 'l', type: 'paragraph' } }] });

    expect(result.ok ? null : result.error).toBeNull();
    expect(session.output().blocks).toEqual([expect.objectContaining({ type: 'paragraph', data: { text: [{ text: 'Item' }] } })]);
  });
});
