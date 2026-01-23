import { describe, it, expect } from 'vitest';
import { keyCodes, mouseButtons, MOBILE_SCREEN_BREAKPOINT } from '../../../../src/components/utils/constants';

describe('constants', () => {
  describe('keyCodes', () => {
    it('should have correct key code values', () => {
      expect(keyCodes.BACKSPACE).toBe(8);
      expect(keyCodes.ENTER).toBe(13);
      expect(keyCodes.SPACE).toBe(32);
      expect(keyCodes.ESC).toBe(27);
      expect(keyCodes.DELETE).toBe(46);
    });

    it('should have number key range constants', () => {
      expect(keyCodes.NUMBER_KEY_MIN).toBe(47);
      expect(keyCodes.NUMBER_KEY_MAX).toBe(58);
    });

    it('should have letter key range constants', () => {
      expect(keyCodes.LETTER_KEY_MIN).toBe(64);
      expect(keyCodes.LETTER_KEY_MAX).toBe(91);
    });

    it('should have numpad key range constants', () => {
      expect(keyCodes.NUMPAD_KEY_MIN).toBe(95);
      expect(keyCodes.NUMPAD_KEY_MAX).toBe(112);
    });

    it('should have punctuation key range constants', () => {
      expect(keyCodes.PUNCTUATION_KEY_MIN).toBe(185);
      expect(keyCodes.PUNCTUATION_KEY_MAX).toBe(193);
    });

    it('should have bracket key range constants', () => {
      expect(keyCodes.BRACKET_KEY_MIN).toBe(218);
      expect(keyCodes.BRACKET_KEY_MAX).toBe(223);
    });

    it('should have processing key constant', () => {
      expect(keyCodes.PROCESSING_KEY).toBe(229);
    });

    it('should have arrow key constants', () => {
      expect(keyCodes.LEFT).toBe(37);
      expect(keyCodes.UP).toBe(38);
      expect(keyCodes.RIGHT).toBe(39);
      expect(keyCodes.DOWN).toBe(40);
    });

    it('should have modifier key constants', () => {
      expect(keyCodes.SHIFT).toBe(16);
      expect(keyCodes.CTRL).toBe(17);
      expect(keyCodes.ALT).toBe(18);
      expect(keyCodes.META).toBe(91);
    });
  });

  describe('mouseButtons', () => {
    it('should have correct mouse button values', () => {
      expect(mouseButtons.LEFT).toBe(0);
      expect(mouseButtons.WHEEL).toBe(1);
      expect(mouseButtons.RIGHT).toBe(2);
      expect(mouseButtons.BACKWARD).toBe(3);
      expect(mouseButtons.FORWARD).toBe(4);
    });
  });

  describe('MOBILE_SCREEN_BREAKPOINT', () => {
    it('should be 650', () => {
      expect(MOBILE_SCREEN_BREAKPOINT).toBe(650);
    });
  });
});
