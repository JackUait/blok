import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TAB_SYNC_PROTOCOL } from '../../../../../src/components/modules/tabSync/identity';
import type { TabMessage } from '../../../../../src/components/modules/tabSync/messages';
import { unwrap, wrap } from '../../../../../src/components/modules/tabSync/messages';

describe('tab messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('round-trips an update', () => {
    const update = new Uint8Array([1, 2, 3]);
    const msg = unwrap('k', structuredClone(wrap('k', { kind: 'update', from: 'a', update })));

    expect(msg).toEqual({ kind: 'update', from: 'a', update });
  });

  it.each<TabMessage>([
    { kind: 'hello', from: 'a', stateVector: null },
    { kind: 'hello', from: 'a', stateVector: new Uint8Array([4]) },
    { kind: 'state', from: 'a', to: 'b', mode: 'full', recordId: 'r', update: new Uint8Array([1]), version: null },
    { kind: 'state', from: 'a', to: 'b', mode: 'diff', recordId: 'r', update: new Uint8Array([1]), version: 'v1' },
    { kind: 'saved', from: 'a', version: null },
    { kind: 'saved', from: 'a', version: 'v2' },
  ])('round-trips a valid message %#', (message) => {
    expect(unwrap('k', structuredClone(wrap('k', message)))).toEqual(message);
  });

  it('drops another key', () => {
    expect(unwrap('k', wrap('other', { kind: 'hello', from: 'a', stateVector: null }))).toBeNull();
  });

  it('drops another protocol version', () => {
    expect(unwrap('k', { protocol: TAB_SYNC_PROTOCOL + 1, key: 'k', message: { kind: 'hello', from: 'a', stateVector: null } })).toBeNull();
  });

  const envelope = (message: unknown): unknown => ({ protocol: TAB_SYNC_PROTOCOL, key: 'k', message });

  it.each([
    null,
    1,
    'x',
    {},
    envelope({ kind: 'update', from: 'a', update: [1] }),
    envelope({ kind: 'state', from: 'a', to: 'b', mode: 'partial', recordId: 'r', update: new Uint8Array([1]), version: null }),
    envelope(null),
    envelope({ kind: 'nope', from: 'a' }),
    envelope({ kind: 'hello', from: 1, stateVector: null }),
    envelope({ kind: 'hello', from: 'a', stateVector: [1] }),
    envelope({ kind: 'hello', from: 'a' }),
    envelope({ kind: 'state', from: 'a', to: 2, mode: 'full', recordId: 'r', update: new Uint8Array([1]), version: null }),
    envelope({ kind: 'state', from: 'a', to: 'b', mode: 'full', recordId: 3, update: new Uint8Array([1]), version: null }),
    envelope({ kind: 'state', from: 'a', to: 'b', mode: 'full', recordId: 'r', update: 'x', version: null }),
    envelope({ kind: 'state', from: 'a', to: 'b', mode: 'full', recordId: 'r', update: new Uint8Array([1]), version: 5 }),
    envelope({ kind: 'saved', from: 'a', version: 5 }),
    envelope({ kind: 'saved', from: 'a' }),
  ])('drops malformed %#', (data) => {
    expect(unwrap('k', data)).toBeNull();
  });
});
