import { describe, it, expect } from 'vitest';
import { getSearchIndex } from './search';

describe('search', () => {
  it('should not index any recipe entries', () => {
    const index = getSearchIndex();
    const recipeItems = index.filter(item => item.category === 'recipe');
    expect(recipeItems).toHaveLength(0);
  });

  it('should not include any /recipes paths', () => {
    const index = getSearchIndex();
    const recipePaths = index.filter(item => item.path === '/recipes');
    expect(recipePaths).toHaveLength(0);
  });
});
