import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { getKeyboardKeyForCode } from '../../../../src/components/utils/keyboard';

const withKeyboard = (getLayoutMap: () => Promise<KeyboardLayoutMap>): void => {
  Object.defineProperty(navigator, 'keyboard', {
    value: { getLayoutMap },
    configurable: true,
  });
};

const layout = (entries: Record<string, string>): KeyboardLayoutMap => new Map(Object.entries(entries));

describe('getKeyboardKeyForCode mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'keyboard');
    vi.restoreAllMocks();
  });

  it('reads the layout key when the API answers', async () => {
    withKeyboard(async () => layout({ Slash: '-' }));

    await expect(getKeyboardKeyForCode('Slash', '/')).resolves.toBe('-');
  });

  it('falls back when the layout has no entry for the code', async () => {
    withKeyboard(async () => layout({}));

    await expect(getKeyboardKeyForCode('Slash', '/')).resolves.toBe('/');
  });

  // A browser without the API is the normal case, not a failure: it must not
  // reach the layout call and must not log.
  it('falls back silently when the browser has no Keyboard API', async () => {
    await expect(getKeyboardKeyForCode('Slash', '/')).resolves.toBe('/');
    expect(console.error).not.toHaveBeenCalled();
  });

  it('falls back and reports when the layout lookup throws', async () => {
    withKeyboard(async () => {
      throw new Error('denied');
    });

    await expect(getKeyboardKeyForCode('Slash', '/')).resolves.toBe('/');
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});
