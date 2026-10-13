import { describe, expect, it } from 'vitest';

import { isEscapeConsumed, markEscapeConsumed } from '../../../src/components/utils/consumed-escape';

describe('consumed-escape', () => {
  it('marks one press without touching its default or its keys', () => {
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });

    const keys = Reflect.ownKeys(event);

    expect(isEscapeConsumed(event)).toBe(false);
    markEscapeConsumed(event);

    expect(isEscapeConsumed(event)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    expect(Reflect.ownKeys(event)).toEqual(keys);
  });

  it('does not read a press a third party preventDefaulted as consumed', () => {
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });

    event.preventDefault();

    expect(isEscapeConsumed(event)).toBe(false);
  });

  it('keeps marks per press', () => {
    const first = new KeyboardEvent('keydown', { key: 'Escape' });
    const second = new KeyboardEvent('keydown', { key: 'Escape' });

    markEscapeConsumed(first);

    expect(isEscapeConsumed(second)).toBe(false);
  });
});
