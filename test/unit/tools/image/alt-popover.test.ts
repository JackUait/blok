import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openAltPopover } from '../../../../src/tools/image/alt-popover';

describe('openAltPopover', () => {
  let anchor: HTMLElement;
  let detach: (() => void) | null;

  beforeEach(() => {
    vi.clearAllMocks();
    anchor = document.createElement('button');
    document.body.appendChild(anchor);
    detach = null;
  });

  afterEach(() => {
    detach?.();
    anchor.remove();
    vi.restoreAllMocks();
  });

  it('falls back to English when i18n omitted', () => {
    detach = openAltPopover({
      anchor,
      value: '',
      onSave: vi.fn(),
      onCancel: vi.fn(),
    });
    const popover = document.querySelector<HTMLElement>('[data-role="image-alt-popover"]');
    if (!popover) throw new Error('popover missing');
    expect(popover.getAttribute('aria-label')).toBe('Edit alt text');
    const description = popover.querySelector('.blok-image-alt-popover__description');
    expect(description?.textContent).toBe(
      'Add alt text to describe this image. This makes your page more accessible to people who are vision-impaired or blind.'
    );
    const textarea = popover.querySelector<HTMLTextAreaElement>('textarea');
    expect(textarea?.placeholder).toBe('Alt text');
  });
});
