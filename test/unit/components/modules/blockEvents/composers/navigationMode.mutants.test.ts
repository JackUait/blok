import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

import { NavigationMode } from '../../../../../../src/components/modules/blockEvents/composers/navigationMode';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';

interface Harness {
  mode: NavigationMode;
  adopt: Mock<() => boolean>;
}

const build = (adopted = false): Harness => {
  const adopt = vi.fn<() => boolean>(() => adopted);
  const Blok = {
    BlockSelection: {
      navigationModeEnabled: false,
      anyBlockSelected: false,
      enableNavigationMode: vi.fn(),
      disableNavigationMode: vi.fn(),
      navigateNext: vi.fn(),
      navigatePrevious: vi.fn(),
      adoptSelectionIntoNavigationMode: adopt,
      selectedBlocks: [],
    } as unknown as BlokModules['BlockSelection'],
    BlockSettings: { opened: false } as unknown as BlokModules['BlockSettings'],
    InlineToolbar: { opened: false } as unknown as BlokModules['InlineToolbar'],
    Toolbar: { opened: false, close: vi.fn(), toolbox: { opened: false } } as unknown as BlokModules['Toolbar'],
  } as BlokModules;

  return { mode: new NavigationMode(Blok), adopt };
};

const keydown = (options: Partial<KeyboardEvent>): KeyboardEvent => ({
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
} as KeyboardEvent);

describe('navigation mode adoption mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Only a plain vertical arrow may adopt an existing selection. Any other key
  // must fall through without even asking.
  it('does not offer to adopt a selection for a key that is not a vertical arrow', () => {
    const harness = build();

    expect(harness.mode.handleKey(keydown({ key: 'a' }))).toBe(false);
    expect(harness.adopt).not.toHaveBeenCalled();
  });

  it('offers to adopt on a plain vertical arrow', () => {
    const harness = build();

    expect(harness.mode.handleKey(keydown({ key: 'ArrowDown' }))).toBe(false);
    expect(harness.adopt).toHaveBeenCalledTimes(1);
  });

  it('does not offer to adopt a modified vertical arrow', () => {
    const harness = build();

    harness.mode.handleKey(keydown({ key: 'ArrowDown', shiftKey: true }));

    expect(harness.adopt).not.toHaveBeenCalled();
  });
});
