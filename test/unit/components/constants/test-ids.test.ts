import { describe, it, expect } from 'vitest';
import { TEST_ID } from '../../../../src/components/constants/test-ids';

/**
 * Locks the public test-hook contract. These values are documented and
 * exported (Blok.TEST_ID) so consumers can target editor chrome in their
 * own tests without reverse-engineering internal selectors. Changing a
 * value here is a breaking change.
 */
describe('TEST_ID public test hooks', () => {
  it('exposes stable test-id values for editor chrome', () => {
    expect(TEST_ID).toEqual({
      plusButton: 'plus-button',
      settingsToggler: 'settings-toggler',
      blockWrapper: 'block-wrapper',
    });
  });
});
