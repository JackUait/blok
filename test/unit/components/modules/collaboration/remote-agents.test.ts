import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readAgentCursor, readAgentField } from '../../../../../src/components/modules/collaboration/remote-agents';

describe('remote agent gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('readAgentField', () => {
    it('keeps via, onBehalfOf and a capped onBehalfOfName; drops other keys', () => {
      expect(readAgentField({ via: 'mcp', onBehalfOf: 'u1', onBehalfOfName: `  ${'n'.repeat(40)}`, evil: '<img>' }))
        .toEqual({ via: 'mcp', onBehalfOf: 'u1', onBehalfOfName: 'n'.repeat(32) });
    });

    it('a missing or blank onBehalfOfName becomes null', () => {
      expect(readAgentField({ via: 'mcp', onBehalfOf: 'u1' })).toEqual({ via: 'mcp', onBehalfOf: 'u1', onBehalfOfName: null });
      expect(readAgentField({ via: 'mcp', onBehalfOf: 'u1', onBehalfOfName: '  ' })?.onBehalfOfName).toBeNull();
    });

    it.each([
      ['not an object', 'mcp'],
      ['null', null],
      ['via not a string', { via: 1, onBehalfOf: 'u1' }],
      ['empty onBehalfOf', { via: 'mcp', onBehalfOf: '' }],
      ['onBehalfOfName not a string', { via: 'mcp', onBehalfOf: 'u1', onBehalfOfName: 5 }],
      ['an oversized id', { via: 'mcp', onBehalfOf: 'u'.repeat(257) }],
    ])('drops the field when %s', (_label, value) => {
      expect(readAgentField(value)).toBeNull();
    });

    it('keeps an id of exactly 256 units', () => {
      expect(readAgentField({ via: 'mcp', onBehalfOf: 'u'.repeat(256) })?.onBehalfOf).toHaveLength(256);
    });
  });

  describe('readAgentCursor', () => {
    const valid = { actorId: 'bot', name: 'Bot', color: '#0b6e99', blockId: 'b1', field: 'text', start: 1, end: 3 };

    it('keeps a valid cursor', () => {
      expect(readAgentCursor(valid)).toEqual(valid);
    });

    it('a block-level cursor keeps null field and offsets', () => {
      expect(readAgentCursor({ actorId: 'bot', name: 'Bot', blockId: 'b1' }))
        .toEqual({ actorId: 'bot', name: 'Bot', color: null, blockId: 'b1', field: null, start: null, end: null });
    });

    it('an invalid colour becomes null (the caller uses the palette)', () => {
      expect(readAgentCursor({ ...valid, color: 'red; background:url(x)' })?.color).toBeNull();
    });

    it('zero is a valid offset', () => {
      expect(readAgentCursor({ ...valid, start: 0, end: 0 })).toMatchObject({ start: 0, end: 0 });
    });

    it.each([
      ['field not a string', { field: 7 }],
      ['negative start', { start: -1 }],
      ['fractional end', { end: 1.5 }],
    ])('%s falls back to block level', (_label, patch) => {
      expect(readAgentCursor({ ...valid, ...patch })).toMatchObject({ blockId: 'b1', field: null, start: null, end: null });
    });

    it.each([
      ['no actorId', { actorId: '' }],
      ['blank name', { name: '   ' }],
      ['no blockId', { blockId: 3 }],
      ['oversized actorId', { actorId: 'a'.repeat(257) }],
    ])('drops the cursor when %s', (_label, patch) => {
      expect(readAgentCursor({ ...valid, ...patch })).toBeNull();
    });

    it('null and junk are dropped', () => {
      expect(readAgentCursor(null)).toBeNull();
      expect(readAgentCursor([valid])).toBeNull();
    });
  });
});
