import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPageToolbar } from './page-toolbar';

afterEach(() => { document.body.innerHTML = ''; });

describe('page appearance toolbar', () => {
  it('changes a page to full width and keeps the choice visible in the menu', () => {
    const onFullWidthChange = vi.fn();
    const toolbar = createPageToolbar('Plan', '🏈', false, onFullWidthChange);
    document.body.append(toolbar.element);
    expect(toolbar.element.querySelector('[data-desktop-page-toolbar-title]')?.textContent).toBe('Plan');
    toolbar.element.querySelector<HTMLButtonElement>('[data-desktop-page-more]')!.click();
    const choice = toolbar.element.querySelector<HTMLButtonElement>('[data-desktop-page-full-width]')!;
    expect(choice.getAttribute('aria-checked')).toBe('false');
    choice.click();
    expect(choice.getAttribute('aria-checked')).toBe('true');
    expect(onFullWidthChange).toHaveBeenCalledWith(true);
    toolbar.setTitle('Nouveau plan');
    toolbar.setIcon('🚗');
    expect(toolbar.element.querySelector('[data-desktop-page-toolbar-title]')?.textContent).toBe('Nouveau plan');
    expect(toolbar.element.querySelector('[data-desktop-page-toolbar-icon]')?.textContent).toBe('🚗');
    toolbar.destroy();
  });
});
