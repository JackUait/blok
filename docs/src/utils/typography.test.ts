import { describe, it, expect } from 'vitest';
import { applyTypography } from './typography';

const NBSP = ' ';

describe('applyTypography', () => {
  describe('shared rules (both locales)', () => {
    it('returns plain text unchanged when no rules apply', () => {
      expect(applyTypography('hello world example', 'en')).toBe('hello world example');
    });

    it('leaves an empty string untouched', () => {
      expect(applyTypography('', 'en')).toBe('');
      expect(applyTypography('', 'ru')).toBe('');
    });

    it('binds a number to the unit/word that follows it (en)', () => {
      expect(applyTypography('install in 5 minutes', 'en')).toBe(`install in${NBSP}5${NBSP}minutes`);
    });

    it('binds a number to the word that follows it (ru)', () => {
      expect(applyTypography('добавьте 3 блока', 'ru')).toBe(`добавьте 3${NBSP}блока`);
    });

    it('puts a non-breaking space before an em dash', () => {
      expect(applyTypography('Blok — block editor', 'en')).toBe(`Blok${NBSP}— block editor`);
    });

    it('does not collapse existing non-breaking spaces', () => {
      expect(applyTypography(`a${NBSP}b`, 'en')).toBe(`a${NBSP}b`);
    });
  });

  describe('English rules', () => {
    it('binds short words (the, a, an, to, of, in, on) to the following word', () => {
      expect(applyTypography('the editor is a tool to use', 'en')).toBe(
        `the${NBSP}editor is${NBSP}a${NBSP}tool to${NBSP}use`,
      );
    });

    it('binds the article at the start of a string', () => {
      expect(applyTypography('A block editor', 'en')).toBe(`A${NBSP}block editor`);
    });

    it('is case-insensitive when matching short words', () => {
      expect(applyTypography('Of course', 'en')).toBe(`Of${NBSP}course`);
    });

    it('does not bind longer words that merely start with a short word', () => {
      expect(applyTypography('theme inert', 'en')).toBe('theme inert');
    });

    it('does not apply Russian particle rules to English text', () => {
      expect(applyTypography('the be же test', 'en')).toBe(`the${NBSP}be же test`);
    });
  });

  describe('Russian rules', () => {
    it('binds one and two letter prepositions to the following word', () => {
      expect(applyTypography('в блоке и в тексте', 'ru')).toBe(
        `в${NBSP}блоке и${NBSP}в${NBSP}тексте`,
      );
    });

    it('binds the preposition at the start of a string', () => {
      expect(applyTypography('С новым блоком', 'ru')).toBe(`С${NBSP}новым блоком`);
    });

    it('binds particles (бы, ли, же) to the preceding word', () => {
      expect(applyTypography('это был бы шаг', 'ru')).toBe(`это был${NBSP}бы шаг`);
    });

    it('does not bind a long word that starts with a short preposition', () => {
      expect(applyTypography('вот изображение', 'ru')).toBe('вот изображение');
    });

    it('does not apply English short-word rules to Russian text', () => {
      expect(applyTypography('on в тексте', 'ru')).toBe(`on в${NBSP}тексте`);
    });
  });
});
