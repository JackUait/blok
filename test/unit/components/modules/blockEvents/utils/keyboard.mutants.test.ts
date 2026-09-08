import { describe, it, expect } from 'vitest';

import {
  isPrintableKeyEvent,
  keyCodeFromEvent,
} from '../../../../../../src/components/modules/blockEvents/utils/keyboard';

const keydown = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent('keydown', init);

/**
 * Four survivors are equivalent, in two pairs.
 *
 * Both `!== undefined` operands are subsumed by the `typeof === 'number'` test
 * beside them: undefined is not a number, so the pair answers the same with or
 * without the first half.
 *
 * The `!event.key` guard in isPrintableKeyEvent is the same shape. A
 * KeyboardEvent always carries a string key, so the guard only fires on the
 * empty one — and falling through with the empty string gives length 0 and no
 * membership in the special set, which is the false the guard returned.
 */
describe('keyboard event utils mutants', () => {
  describe('reading a legacy key code', () => {
    it('reads the key when it is one it knows', () => {
      expect(keyCodeFromEvent(keydown({ key: 'Enter' }))).toBe(13);
      expect(keyCodeFromEvent(keydown({ key: 'ArrowLeft' }))).toBe(37);
    });

    // A layout where the key is a letter but the physical code is a known one:
    // the key lookup misses and the code lookup has to answer.
    it('falls back to the code when the key is not one it knows', () => {
      expect(keyCodeFromEvent(keydown({ key: 'q', code: 'Enter' }))).toBe(13);
    });

    // KeyboardEventInit defaults key to the empty string, which is falsy and
    // therefore never reaches the map — the value looked up is that string.
    it('falls back to the code when the event carries no key at all', () => {
      expect(keyCodeFromEvent(keydown({ code: 'Enter' }))).toBe(13);
    });

    it('answers null when neither the key nor the code is one it knows', () => {
      expect(keyCodeFromEvent(keydown({ key: 'q', code: 'KeyQ' }))).toBeNull();
    });

    it('answers null when the event carries no code either', () => {
      expect(keyCodeFromEvent(keydown({ key: 'q' }))).toBeNull();
    });
  });

  describe('deciding whether a key prints', () => {
    it('accepts a single character and the special keys that produce one', () => {
      expect(isPrintableKeyEvent(keydown({ key: 'a' }))).toBe(true);
      expect(isPrintableKeyEvent(keydown({ key: 'Enter' }))).toBe(true);
      expect(isPrintableKeyEvent(keydown({ key: 'Dead' }))).toBe(true);
    });

    it('refuses a modifier and an event with no key', () => {
      expect(isPrintableKeyEvent(keydown({ key: 'Shift' }))).toBe(false);
      expect(isPrintableKeyEvent(keydown({}))).toBe(false);
    });
  });
});
