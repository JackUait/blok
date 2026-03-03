import { describe, it, expect } from 'vitest';
import { matchesSearchQuery, scoreSearchMatch } from '../../../../../src/components/utils/popover/components/search-input';

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

  describe('fuzzy matching (subsequence and typo tolerance)', () => {
    it('should match via subsequence', () => {
      expect(matchesSearchQuery({ title: 'Header' }, 'hdr')).toBe(true);
    });

    it('should match via typo tolerance', () => {
      expect(matchesSearchQuery({ title: 'Header' }, 'haeder')).toBe(true);
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

describe('scoreSearchMatch', () => {
  describe('exact match', () => {
    it('should return >= 100 for exact title match', () => {
      expect(scoreSearchMatch({ title: 'Heading' }, 'heading')).toBeGreaterThanOrEqual(100);
    });

    it('should return >= 100 for exact searchTerm match', () => {
      expect(scoreSearchMatch({ searchTerms: ['h1'] }, 'h1')).toBeGreaterThanOrEqual(100);
    });
  });

  describe('prefix match scores higher than substring', () => {
    it('should score prefix higher than non-prefix substring', () => {
      const prefixScore = scoreSearchMatch({ title: 'Paragraph' }, 'para');
      const substringScore = scoreSearchMatch({ title: 'Paragraph' }, 'ragr');

      expect(prefixScore).toBeGreaterThan(substringScore);
    });
  });

  describe('substring match', () => {
    it('should return positive score for substring in title', () => {
      expect(scoreSearchMatch({ title: 'Heading' }, 'adin')).toBeGreaterThan(0);
    });

    it('should return positive score for substring in englishTitle', () => {
      expect(scoreSearchMatch({ englishTitle: 'Heading' }, 'adin')).toBeGreaterThan(0);
    });

    it('should return positive score for substring in searchTerms', () => {
      expect(scoreSearchMatch({ searchTerms: ['header'] }, 'eade')).toBeGreaterThan(0);
    });
  });

  describe('subsequence match', () => {
    it('should return positive score for subsequence', () => {
      expect(scoreSearchMatch({ title: 'Header' }, 'hdr')).toBeGreaterThan(0);
    });

    it('should score word-boundary subsequence higher than general subsequence', () => {
      // "hd" matches word boundary of "Header" (H at start) better context
      // Use a multi-word title to test word boundaries
      const wordBoundaryScore = scoreSearchMatch({ title: 'Help Desk' }, 'hd');
      const generalSubseqScore = scoreSearchMatch({ title: 'Holder' }, 'hd');

      // Word boundary: H(elp) D(esk) vs general: H(ol)d(er)
      expect(wordBoundaryScore).toBeGreaterThan(generalSubseqScore);
    });
  });

  describe('typo tolerance', () => {
    it('should match with minor typos', () => {
      expect(scoreSearchMatch({ title: 'Header' }, 'haeder')).toBeGreaterThan(0);
    });

    it('should match transposed characters', () => {
      expect(scoreSearchMatch({ title: 'Paragraph' }, 'pragraph')).toBeGreaterThan(0);
    });

    it('should NOT activate for short queries (length < 3)', () => {
      // "hx" is not a substring/subsequence of "Header", and too short for typo tolerance
      expect(scoreSearchMatch({ title: 'Header' }, 'hx')).toBe(0);
    });

    it('should not match with too many typos', () => {
      expect(scoreSearchMatch({ title: 'Header' }, 'zzzzzz')).toBe(0);
    });
  });

  describe('score ranking', () => {
    it('should rank: exact > prefix > substring > subsequence > typo', () => {
      const exact = scoreSearchMatch({ title: 'Header' }, 'header');
      const prefix = scoreSearchMatch({ title: 'Heading' }, 'head');
      const substring = scoreSearchMatch({ title: 'Subheader' }, 'head');
      const subsequence = scoreSearchMatch({ title: 'Header' }, 'hdr');
      const typo = scoreSearchMatch({ title: 'Header' }, 'haeder');

      expect(exact).toBeGreaterThan(prefix);
      expect(prefix).toBeGreaterThan(substring);
      expect(substring).toBeGreaterThan(subsequence);
      expect(subsequence).toBeGreaterThan(typo);
      expect(typo).toBeGreaterThan(0);
    });
  });

  describe('best score across fields', () => {
    it('should take the best score across title, englishTitle, and searchTerms', () => {
      const item = {
        title: 'Titre',
        englishTitle: 'Heading',
        searchTerms: ['h1', 'header'],
      };

      // "heading" is an exact match on englishTitle, so score should be >= 100
      expect(scoreSearchMatch(item, 'heading')).toBeGreaterThanOrEqual(100);

      // "h1" is an exact match on a searchTerm
      expect(scoreSearchMatch(item, 'h1')).toBeGreaterThanOrEqual(100);
    });
  });

  describe('edge cases', () => {
    it('should return > 0 for empty query', () => {
      expect(scoreSearchMatch({ title: 'Heading' }, '')).toBeGreaterThan(0);
    });

    it('should return 0 for unrelated query', () => {
      expect(scoreSearchMatch({ title: 'Heading' }, 'zzzzz')).toBe(0);
    });

    it('should handle items with missing fields', () => {
      expect(scoreSearchMatch({}, '')).toBeGreaterThan(0);
      expect(scoreSearchMatch({}, 'anything')).toBe(0);
      expect(scoreSearchMatch({ title: 'Text' }, 'text')).toBeGreaterThanOrEqual(100);
      expect(scoreSearchMatch({ englishTitle: 'Text' }, 'text')).toBeGreaterThanOrEqual(100);
      expect(scoreSearchMatch({ searchTerms: ['text'] }, 'text')).toBeGreaterThanOrEqual(100);
    });
  });
});
