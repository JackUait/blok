import { describe, expect, it } from 'vitest';

import { renderColumnsPreview } from '../../../../src/tools/column-list/preview';

describe('columns toolbox preview', () => {
  it('shows a different page for each column count', () => {
    const titles = [2, 3, 4, 5].map(count => renderColumnsPreview(count).querySelector('[data-page-title]')?.textContent);

    expect(new Set(titles).size).toBe(4);
  });

  it('draws one column per count', () => {
    [2, 3, 4, 5].forEach(count => {
      expect(renderColumnsPreview(count).querySelectorAll('[data-column]')).toHaveLength(count);
    });
  });
});
