import { describe, it, expect } from 'vitest';
import { matchesSearchQuery } from '../../../../../src/components/utils/popover/components/search-input';

describe('Multilingual Search Filter', () => {
  const headingItem = {
    title: 'Titre',           // French
    englishTitle: 'Heading',  // English
    searchTerms: ['h1', 'h2', 'h3', 'title', 'header'],
  };

  describe('matches displayed title (current locale)', () => {
    it('should match French title "Titre"', () => {
      expect(matchesSearchQuery(headingItem, 'titre')).toBe(true);
      expect(matchesSearchQuery(headingItem, 'Titre')).toBe(true);
      expect(matchesSearchQuery(headingItem, 'TIT')).toBe(true);
    });
  });

  describe('matches English title (automatic fallback)', () => {
    it('should match English title "Heading"', () => {
      expect(matchesSearchQuery(headingItem, 'heading')).toBe(true);
      expect(matchesSearchQuery(headingItem, 'Heading')).toBe(true);
      expect(matchesSearchQuery(headingItem, 'HEAD')).toBe(true);
    });
  });

  describe('matches search terms (aliases)', () => {
    it('should match alias "h1"', () => {
      expect(matchesSearchQuery(headingItem, 'h1')).toBe(true);
    });

    it('should match alias "title"', () => {
      expect(matchesSearchQuery(headingItem, 'title')).toBe(true);
    });

    it('should match alias "header"', () => {
      expect(matchesSearchQuery(headingItem, 'header')).toBe(true);
    });

    it('should be case-insensitive for aliases', () => {
      expect(matchesSearchQuery(headingItem, 'H1')).toBe(true);
      expect(matchesSearchQuery(headingItem, 'HEADER')).toBe(true);
    });
  });

  describe('no match scenarios', () => {
    it('should not match unrelated query', () => {
      expect(matchesSearchQuery(headingItem, 'paragraph')).toBe(false);
      expect(matchesSearchQuery(headingItem, 'xyz')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle empty query', () => {
      // Empty query matches all via includes (empty string is found in any string)
      expect(matchesSearchQuery(headingItem, '')).toBe(true);
    });

    it('should handle item with no searchTerms', () => {
      const simpleItem = { title: 'Text', englishTitle: 'Text' };

      expect(matchesSearchQuery(simpleItem, 'text')).toBe(true);
      expect(matchesSearchQuery(simpleItem, 'xyz')).toBe(false);
    });

    it('should handle item with no englishTitle', () => {
      const localizedItem = { title: 'Párrafo', searchTerms: ['p'] };

      expect(matchesSearchQuery(localizedItem, 'párrafo')).toBe(true);
      expect(matchesSearchQuery(localizedItem, 'p')).toBe(true);
      expect(matchesSearchQuery(localizedItem, 'heading')).toBe(false);
    });
  });
});
