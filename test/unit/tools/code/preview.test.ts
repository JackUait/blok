import { describe, it, expect } from 'vitest';
import { renderCodePreview } from '../../../../src/tools/code/preview';

describe('code toolbox preview', () => {
  it('shows the tab the block has: language dot, language and filename', () => {
    const tab = renderCodePreview().querySelector('[data-tab]');

    expect(tab?.querySelector('[data-dot]')).not.toBeNull();
    expect(tab?.querySelector('[data-lang]')?.textContent).toBe('TypeScript');
    expect(tab?.querySelector('[data-file]')?.textContent).toBe('cup.ts');
  });

  it('sits the tab on the card, not inside it', () => {
    const preview = renderCodePreview();
    const tab = preview.querySelector('[data-tab]');
    const card = preview.querySelector('[data-card]');

    expect(card?.contains(tab ?? null)).toBe(false);
    expect(tab?.nextElementSibling).toBe(card);
  });
});
