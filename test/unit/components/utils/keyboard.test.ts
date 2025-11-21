import { describe, it, expect, vi, afterEach } from 'vitest';
import { getKeyboardKeyForCode } from '../../../../src/components/utils/keyboard';

describe('keyboard utils', () => {
  const CODE = 'Slash';
  const FALLBACK = '/';
  const navigatorHolder = globalThis as typeof globalThis & { navigator?: Navigator | undefined };

  type LayoutMap = { get: (code: string) => string | undefined };
  type KeyboardLike = { getLayoutMap: () => Promise<LayoutMap> };
  const originalNavigator = navigatorHolder.navigator;
  const setNavigator = (value: Navigator | undefined): void => {
    Object.defineProperty(navigatorHolder, 'navigator', {
      configurable: true,
      writable: true,
      value,
    });
  };

  afterEach(() => {
    setNavigator(originalNavigator);

    vi.restoreAllMocks();
  });

  it('returns fallback when Keyboard API is missing', async () => {
    setNavigator({} as Navigator);

    const result = await getKeyboardKeyForCode(CODE, FALLBACK);

    expect(result).toBe(FALLBACK);
  });

  it('returns actual layout key when available', async () => {
    const layoutKey = '-';
    const map: LayoutMap = { get: vi.fn().mockReturnValue(layoutKey) };
    const keyboard: KeyboardLike = { getLayoutMap: vi.fn().mockResolvedValue(map) };

    setNavigator({ keyboard } as unknown as Navigator);

    const result = await getKeyboardKeyForCode(CODE, FALLBACK);

    expect(keyboard.getLayoutMap).toHaveBeenCalledTimes(1);
    expect(map.get).toHaveBeenCalledWith(CODE);
    expect(result).toBe(layoutKey);
  });

  it('returns fallback when layout map does not contain the key', async () => {
    const map: LayoutMap = { get: vi.fn().mockReturnValue(undefined) };
    const keyboard: KeyboardLike = { getLayoutMap: vi.fn().mockResolvedValue(map) };

    setNavigator({ keyboard } as unknown as Navigator);

    const result = await getKeyboardKeyForCode(CODE, FALLBACK);

    expect(map.get).toHaveBeenCalledWith(CODE);
    expect(result).toBe(FALLBACK);
  });

  it('returns fallback and logs error when layout map retrieval fails', async () => {
    const error = new Error('Keyboard API failed');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const keyboard: KeyboardLike = { getLayoutMap: vi.fn().mockRejectedValue(error) };

    setNavigator({ keyboard } as unknown as Navigator);

    const result = await getKeyboardKeyForCode(CODE, FALLBACK);

    expect(result).toBe(FALLBACK);
    expect(consoleSpy).toHaveBeenCalledWith(error);
  });
});
