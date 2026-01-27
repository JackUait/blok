import { describe, it, expect } from 'vitest';
import { search, getSearchIndex, type SearchIndexItem } from './search';

describe('search', () => {
  describe('recipe search', () => {
    it('should return recipe results when searching for "autosave"', () => {
      const index = getSearchIndex();
      const results = search('autosave', index);

      const recipeResults = results.filter(r => r.category === 'recipe');
      expect(recipeResults.length).toBeGreaterThan(0);

      const autosaveRecipe = recipeResults.find(r =>
        r.title.toLowerCase().includes('autosave')
      );
      expect(autosaveRecipe).toBeDefined();
      expect(autosaveRecipe?.title).toBe('Autosave with Debouncing');
    });

    it('should return recipe results when searching for "custom tool"', () => {
      const index = getSearchIndex();
      const results = search('custom tool', index);

      const recipeResults = results.filter(r => r.category === 'recipe');
      expect(recipeResults.length).toBeGreaterThan(0);

      const customToolRecipe = recipeResults.find(r =>
        r.title.toLowerCase().includes('custom')
      );
      expect(customToolRecipe).toBeDefined();
      expect(customToolRecipe?.title).toBe('Creating a Custom Tool');
    });

    it('should return recipe results when searching for "styling"', () => {
      const index = getSearchIndex();
      const results = search('styling', index);

      const recipeResults = results.filter(r => r.category === 'recipe');
      expect(recipeResults.length).toBeGreaterThan(0);

      const stylingRecipe = recipeResults.find(r =>
        r.title.toLowerCase().includes('styling')
      );
      expect(stylingRecipe).toBeDefined();
      expect(stylingRecipe?.title).toBe('Styling with Data Attributes');
    });

    it('should return recipe results when searching for "readonly" or "read-only"', () => {
      const index = getSearchIndex();
      const results = search('readonly', index);

      const recipeResults = results.filter(r => r.category === 'recipe');
      expect(recipeResults.length).toBeGreaterThan(0);

      const readonlyRecipe = recipeResults.find(r =>
        r.title.toLowerCase().includes('read-only')
      );
      expect(readonlyRecipe).toBeDefined();
      expect(readonlyRecipe?.title).toBe('Read-Only Mode');
    });

    it('should return recipe results when searching for "locale" or "localization"', () => {
      const index = getSearchIndex();
      const results = search('locale', index);

      const recipeResults = results.filter(r => r.category === 'recipe');
      expect(recipeResults.length).toBeGreaterThan(0);

      const localeRecipe = recipeResults.find(r =>
        r.title.toLowerCase().includes('localization')
      );
      expect(localeRecipe).toBeDefined();
      expect(localeRecipe?.title).toBe('Localization with Preloading');
    });

    it('should return recipe results when searching for "keyboard" or "shortcuts"', () => {
      const index = getSearchIndex();
      const results = search('keyboard', index);

      const recipeResults = results.filter(r => r.category === 'recipe');
      expect(recipeResults.length).toBeGreaterThan(0);

      const keyboardRecipe = recipeResults.find(r =>
        r.title.toLowerCase().includes('keyboard')
      );
      expect(keyboardRecipe).toBeDefined();
      expect(keyboardRecipe?.title).toBe('Keyboard Shortcuts');
    });

    it('should return recipe results when searching for "quick tips"', () => {
      const index = getSearchIndex();
      const results = search('quick tips', index);

      const recipeResults = results.filter(r => r.category === 'recipe');
      expect(recipeResults.length).toBeGreaterThan(0);

      const quickTipsRecipe = recipeResults.find(r =>
        r.title.toLowerCase().includes('quick tips')
      );
      expect(quickTipsRecipe).toBeDefined();
      expect(quickTipsRecipe?.title).toBe('Quick Tips');
    });

    it('should include all code recipes in search index', () => {
      const index = getSearchIndex();
      const recipeIndexItems = index.filter(item => item.category === 'recipe');

      const expectedRecipes = [
        'Autosave with Debouncing',
        'Working with Events',
        'Creating a Custom Tool',
        'Styling with Data Attributes',
        'Read-Only Mode',
        'Localization with Preloading',
      ];

      for (const expectedTitle of expectedRecipes) {
        const found = recipeIndexItems.some(item => item.title === expectedTitle);
        expect(found).toBe(true);
      }
    });

    it('should categorize recipes with "recipe" category', () => {
      const index = getSearchIndex();
      const recipeIndexItems = index.filter(item => item.category === 'recipe');

      expect(recipeIndexItems.length).toBeGreaterThan(0);

      for (const item of recipeIndexItems) {
        expect(item.category).toBe('recipe');
        expect(item.module).toBe('Recipes');
        expect(item.path).toBe('/recipes');
      }
    });

    it('should search recipe descriptions for relevance', () => {
      const index = getSearchIndex();
      const results = search('debouncing', index);

      const recipeResults = results.filter(r => r.category === 'recipe');
      expect(recipeResults.length).toBeGreaterThan(0);

      // The autosave recipe should match due to description mentioning debouncing
      const autosaveRecipe = recipeResults.find(r =>
        r.title === 'Autosave with Debouncing'
      );
      expect(autosaveRecipe).toBeDefined();
    });

    it('should search recipe content like "nested" or "nesting"', () => {
      const index = getSearchIndex();
      const results = search('nested', index);

      const recipeResults = results.filter(r => r.category === 'recipe');
      expect(recipeResults.length).toBeGreaterThan(0);

      // Quick tips should include nesting tip
      const quickTipsRecipe = recipeResults.find(r =>
        r.title === 'Quick Tips'
      );
      expect(quickTipsRecipe).toBeDefined();
    });
  });
});
