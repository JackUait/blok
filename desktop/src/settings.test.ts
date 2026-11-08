import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyAppearance, createDesktopFooter, readAppearance } from './settings';

afterEach(() => {
  document.body.innerHTML = '';
  document.body.removeAttribute('data-blok-theme');
  document.documentElement.removeAttribute('data-blok-theme');
  localStorage.clear();
});

describe('desktop sidebar footer', () => {
  it('opens preferences and saves the selected appearance', () => {
    const root = document.createElement('div');
    root.setAttribute('data-desktop-shell', '');
    document.body.append(root);
    applyAppearance(root, readAppearance());
    const onThemeChange = vi.fn();
    const footer = createDesktopFooter(onThemeChange);
    root.append(footer);

    const switcher = footer.querySelector('[data-desktop-switcher]') as HTMLButtonElement;
    switcher.click();
    expect(switcher.getAttribute('aria-expanded')).toBe('true');
    expect(footer.querySelector('[role="menu"]')?.hasAttribute('hidden')).toBe(false);

    const preferences = [...footer.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((item) => item.textContent?.includes('Préférences'))!;
    preferences.click();
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.parentElement?.hasAttribute('hidden')).toBe(false);
    const theme = dialog.querySelector('[data-desktop-settings-theme]') as HTMLSelectElement;
    theme.value = 'light';
    theme.dispatchEvent(new Event('change'));
    expect(readAppearance()).toBe('light');
    expect(root.getAttribute('data-blok-theme')).toBe('light');
    expect(document.body.getAttribute('data-blok-theme')).toBe('light');
    expect(onThemeChange).toHaveBeenCalledWith('light');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(dialog.parentElement?.hasAttribute('hidden')).toBe(true);
  });

  it('shows a local profile and AI provider settings', async () => {
    const root = document.createElement('div');
    root.setAttribute('data-desktop-shell', '');
    document.body.append(root);
    const footer = createDesktopFooter(() => undefined);
    root.append(footer);
    footer.querySelector<HTMLButtonElement>('[data-desktop-switcher]')!.click();
    footer.querySelector<HTMLButtonElement>('[data-desktop-menu-account]')!.click();
    const dialog = document.querySelector<HTMLElement>('[data-desktop-settings-dialog]')!;
    expect(dialog.querySelector('[data-desktop-settings-title]')?.textContent).toBe('Profil local');
    const name = dialog.querySelector<HTMLInputElement>('[data-desktop-settings-name]')!;
    name.value = 'Mes notes';
    name.dispatchEvent(new Event('change'));
    expect(footer.querySelector('[data-desktop-switcher-name]')?.textContent).toBe('Mes notes');
    [...dialog.querySelectorAll<HTMLButtonElement>('[data-desktop-settings-nav-item]')]
      .find((item) => item.textContent?.includes('Assistant IA'))!.click();
    expect(dialog.querySelectorAll('[data-desktop-settings-provider]')).toHaveLength(2);
    expect(dialog.querySelector('[data-desktop-settings-title]')?.textContent).toBe('Assistant IA');
  });
});
