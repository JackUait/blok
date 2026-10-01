import { describe, it, expect } from 'vitest';
import { renderCodePreview } from '../../../../src/tools/code/preview';

describe('code toolbox preview', () => {
  it('shows the header the block has: language dot, language and filename', () => {
    const header = renderCodePreview().querySelector('[data-header]');

    expect(header?.querySelector('[data-dot]')).not.toBeNull();
    expect(header?.querySelector('[data-lang]')?.textContent).toBe('TypeScript');
    expect(header?.querySelector('[data-file]')?.textContent).toBe('cup.ts');
  });
});
