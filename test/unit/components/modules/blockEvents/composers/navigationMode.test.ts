import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigationMode } from '../../../../../../src/components/modules/blockEvents/composers/navigationMode';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';

const createKeyboardEvent = (options: Partial<KeyboardEvent> = {}): KeyboardEvent => {
  return {
    keyCode: 0,
    key: '',
    code: '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    ...options,
  } as KeyboardEvent;
};

const createBlokModules = (overrides: Partial<BlokModules> = {}): BlokModules => {
  const defaults: Partial<BlokModules> = {
    BlockSelection: {
      navigationModeEnabled: false,
      anyBlockSelected: false,
      enableNavigationMode: vi.fn(),
      disableNavigationMode: vi.fn(),
      navigateNext: vi.fn(),
      navigatePrevious: vi.fn(),
      selectedBlocks: [],
    } as unknown as BlokModules['BlockSelection'],
    BlockSettings: {
      opened: false,
    } as unknown as BlokModules['BlockSettings'],
    InlineToolbar: {
      opened: false,
    } as unknown as BlokModules['InlineToolbar'],
    Toolbar: {
      opened: false,
      close: vi.fn(),
      toolbox: {
        opened: false,
      },
    } as unknown as BlokModules['Toolbar'],
  };

  const mergedState: Partial<BlokModules> = { ...defaults };

  for (const [moduleName, moduleOverrides] of Object.entries(overrides) as Array<[keyof BlokModules, unknown]>) {
    const defaultModule = defaults[moduleName];

    if (
      defaultModule !== undefined &&
      defaultModule !== null &&
      typeof defaultModule === 'object' &&
      moduleOverrides !== null &&
      typeof moduleOverrides === 'object'
    ) {
      (mergedState as unknown as Record<keyof BlokModules, BlokModules[keyof BlokModules]>)[moduleName] = {
        ...(defaultModule as unknown as Record<string, unknown>),
        ...(moduleOverrides as Record<string, unknown>),
      } as unknown as BlokModules[typeof moduleName];
    } else if (moduleOverrides !== undefined) {
      (mergedState as Record<keyof BlokModules, BlokModules[keyof BlokModules]>)[moduleName] =
        moduleOverrides as BlokModules[typeof moduleName];
    }
  }

  return mergedState as BlokModules;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NavigationMode', () => {
  describe('handleEscape', () => {
    it('returns false when key is not Escape', () => {
      const blok = createBlokModules();
      const navigationMode = new NavigationMode(blok);
      const event = createKeyboardEvent({ key: 'Enter' });

      const result = navigationMode.handleEscape(event);

      expect(result).toBe(false);
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('returns false when BlockSettings is opened', () => {
      const blok = createBlokModules({
        BlockSettings: {
          opened: true,
        } as unknown as BlokModules['BlockSettings'],
      });
      const navigationMode = new NavigationMode(blok);
      const event = createKeyboardEvent({ key: 'Escape' });

      const result = navigationMode.handleEscape(event);

      expect(result).toBe(false);
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('returns false when InlineToolbar is opened', () => {
      const blok = createBlokModules({
        InlineToolbar: {
          opened: true,
        } as unknown as BlokModules['InlineToolbar'],
      });
      const navigationMode = new NavigationMode(blok);
      const event = createKeyboardEvent({ key: 'Escape' });

      const result = navigationMode.handleEscape(event);

      expect(result).toBe(false);
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('returns false when Toolbox is opened', () => {
      const blok = createBlokModules({
        Toolbar: {
          toolbox: {
            opened: true,
          },
        } as unknown as BlokModules['Toolbar'],
      });
      const navigationMode = new NavigationMode(blok);
      const event = createKeyboardEvent({ key: 'Escape' });

      const result = navigationMode.handleEscape(event);

      expect(result).toBe(false);
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('returns false when blocks are selected', () => {
      const blok = createBlokModules({
        BlockSelection: {
          anyBlockSelected: true,
        } as unknown as BlokModules['BlockSelection'],
      });
      const navigationMode = new NavigationMode(blok);
      const event = createKeyboardEvent({ key: 'Escape' });

      const result = navigationMode.handleEscape(event);

      expect(result).toBe(false);
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('enables navigation mode when conditions are met', () => {
      const close = vi.fn();
      const enableNavigationMode = vi.fn();
      const blok = createBlokModules({
        Toolbar: {
          close,
        } as unknown as BlokModules['Toolbar'],
        BlockSelection: {
          enableNavigationMode,
          anyBlockSelected: false,
        } as unknown as BlokModules['BlockSelection'],
      });
      const navigationMode = new NavigationMode(blok);
      const event = createKeyboardEvent({ key: 'Escape' });

      const result = navigationMode.handleEscape(event);

      expect(result).toBe(true);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
      expect(enableNavigationMode).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleKey', () => {
    it('returns false when navigation mode is not enabled', () => {
      const blok = createBlokModules({
        BlockSelection: {
          navigationModeEnabled: false,
        } as unknown as BlokModules['BlockSelection'],
      });
      const navigationMode = new NavigationMode(blok);
      const event = createKeyboardEvent({ key: 'ArrowDown' });

      const result = navigationMode.handleKey(event);

      expect(result).toBe(false);
    });

    describe('ArrowDown in navigation mode', () => {
      it('navigates to next block and prevents default', () => {
        const navigateNext = vi.fn();
        const blok = createBlokModules({
          BlockSelection: {
            navigationModeEnabled: true,
            navigateNext,
          } as unknown as BlokModules['BlockSelection'],
        });
        const navigationMode = new NavigationMode(blok);
        const event = createKeyboardEvent({ key: 'ArrowDown' });

        const result = navigationMode.handleKey(event);

        expect(result).toBe(true);
        expect(navigateNext).toHaveBeenCalledTimes(1);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(event.stopPropagation).toHaveBeenCalledTimes(1);
      });
    });

    describe('ArrowUp in navigation mode', () => {
      it('navigates to previous block and prevents default', () => {
        const navigatePrevious = vi.fn();
        const blok = createBlokModules({
          BlockSelection: {
            navigationModeEnabled: true,
            navigatePrevious,
          } as unknown as BlokModules['BlockSelection'],
        });
        const navigationMode = new NavigationMode(blok);
        const event = createKeyboardEvent({ key: 'ArrowUp' });

        const result = navigationMode.handleKey(event);

        expect(result).toBe(true);
        expect(navigatePrevious).toHaveBeenCalledTimes(1);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(event.stopPropagation).toHaveBeenCalledTimes(1);
      });
    });

    describe('Enter in navigation mode', () => {
      it('disables navigation mode with focus and prevents default', () => {
        const disableNavigationMode = vi.fn();
        const blok = createBlokModules({
          BlockSelection: {
            navigationModeEnabled: true,
            disableNavigationMode,
          } as unknown as BlokModules['BlockSelection'],
        });
        const navigationMode = new NavigationMode(blok);
        const event = createKeyboardEvent({ key: 'Enter' });

        const result = navigationMode.handleKey(event);

        expect(result).toBe(true);
        expect(disableNavigationMode).toHaveBeenCalledWith(true);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(event.stopPropagation).toHaveBeenCalledTimes(1);
        expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1);
      });
    });

    describe('Escape in navigation mode', () => {
      it('disables navigation mode without focus and prevents default', () => {
        const disableNavigationMode = vi.fn();
        const blok = createBlokModules({
          BlockSelection: {
            navigationModeEnabled: true,
            disableNavigationMode,
          } as unknown as BlokModules['BlockSelection'],
        });
        const navigationMode = new NavigationMode(blok);
        const event = createKeyboardEvent({ key: 'Escape' });

        const result = navigationMode.handleKey(event);

        expect(result).toBe(true);
        expect(disableNavigationMode).toHaveBeenCalledWith(false);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(event.stopPropagation).toHaveBeenCalledTimes(1);
      });
    });

    describe('Printable key in navigation mode', () => {
      it('disables navigation mode with focus for printable characters', () => {
        const disableNavigationMode = vi.fn();
        const blok = createBlokModules({
          BlockSelection: {
            navigationModeEnabled: true,
            disableNavigationMode,
          } as unknown as BlokModules['BlockSelection'],
        });
        const navigationMode = new NavigationMode(blok);
        const event = createKeyboardEvent({ key: 'a' });

        const result = navigationMode.handleKey(event);

        expect(result).toBe(false);
        expect(disableNavigationMode).toHaveBeenCalledWith(true);
        expect(event.preventDefault).not.toHaveBeenCalled();
      });

      it('disables navigation mode with focus for Enter special key', () => {
        const disableNavigationMode = vi.fn();
        const blok = createBlokModules({
          BlockSelection: {
            navigationModeEnabled: true,
            disableNavigationMode,
          } as unknown as BlokModules['BlockSelection'],
        });
        const navigationMode = new NavigationMode(blok);
        const event = createKeyboardEvent({ key: 'Enter' });

        const result = navigationMode.handleKey(event);

        expect(result).toBe(true); // Enter is handled above, returns true
        expect(disableNavigationMode).toHaveBeenCalledWith(true);
      });

      it('does not disable navigation mode for non-printable keys', () => {
        const disableNavigationMode = vi.fn();
        const blok = createBlokModules({
          BlockSelection: {
            navigationModeEnabled: true,
            disableNavigationMode,
          } as unknown as BlokModules['BlockSelection'],
        });
        const navigationMode = new NavigationMode(blok);
        const event = createKeyboardEvent({ key: 'Shift' });

        const result = navigationMode.handleKey(event);

        expect(result).toBe(false);
        expect(disableNavigationMode).not.toHaveBeenCalled();
      });

      it('does not disable navigation mode when key is missing', () => {
        const disableNavigationMode = vi.fn();
        const blok = createBlokModules({
          BlockSelection: {
            navigationModeEnabled: true,
            disableNavigationMode,
          } as unknown as BlokModules['BlockSelection'],
        });
        const navigationMode = new NavigationMode(blok);
        const event = createKeyboardEvent({ key: '' });

        const result = navigationMode.handleKey(event);

        expect(result).toBe(false);
        expect(disableNavigationMode).not.toHaveBeenCalled();
      });
    });
  });
});
