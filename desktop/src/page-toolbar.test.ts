import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPageToolbar } from './page-toolbar';

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('page appearance toolbar', () => {
  it('copies the current page URL from the host and shows visible success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const toolbar = createPageToolbar([{ id: 'old', title: 'Old' }], false, vi.fn(), undefined, undefined, { pageUrl: id => `https://blok.example.com/?page=${id}` });
    document.body.append(toolbar.element);
    toolbar.setBreadcrumbs([{ id: 'current', title: 'Current' }]);
    const copy = toolbar.element.querySelector<HTMLButtonElement>('[data-desktop-page-copy]')!;
    copy.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('https://blok.example.com/?page=current'));
    const status = toolbar.element.querySelector<HTMLElement>('[role="status"]')!;
    expect(status.textContent).toBe('Lien copié'); expect(status.hidden).toBe(false);
    expect(copy.title).toBe('Lien copié');
    toolbar.destroy();
  });

  it('shows a failure instead of claiming success when clipboard access is refused', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } });
    const toolbar = createPageToolbar([{ id: 'p', title: 'Page' }], false, vi.fn());
    document.body.append(toolbar.element);
    toolbar.element.querySelector<HTMLButtonElement>('[data-desktop-page-copy]')!.click();
    await vi.waitFor(() => expect(toolbar.element.querySelector('[role="status"]')?.textContent).toContain('Copie impossible'));
    expect(toolbar.element.querySelector<HTMLElement>('[role="status"]')!.hidden).toBe(false);
    toolbar.destroy();
  });
  it('opens fresh workspace choices from its breadcrumb', () => {
    const onOpen = vi.fn();
    const workspacePages = vi.fn(() => [{ id: 'a', title: 'Guide', onOpen }]);
    const toolbar = createPageToolbar([{ id: 'a', title: 'Guide' }], false, vi.fn(), undefined, undefined, { workspaceName: 'Équipe', workspacePages });
    document.body.append(toolbar.element);
    toolbar.element.querySelector<HTMLButtonElement>('[data-desktop-page-workspace]')!.click();
    expect(workspacePages).toHaveBeenCalledOnce();
    toolbar.element.querySelector<HTMLButtonElement>('[data-desktop-breadcrumb-menu-item="a"]')!.click();
    expect(onOpen).toHaveBeenCalledOnce();
    toolbar.destroy();
  });
  it('changes a page to full width and keeps the choice visible in the menu', () => {
    const onFullWidthChange = vi.fn();
    const toolbar = createPageToolbar([{ id: 'plan', title: 'Plan', icon: '🏈' }], false, onFullWidthChange);
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

  it('shows the parent and current page with their icons and opens the parent', () => {
    const onOpen = vi.fn();
    const toolbar = createPageToolbar([
      { id: 'parent', title: 'Nouvelle page', icon: '🏕️', onOpen },
      { id: 'child', title: 'jojo', icon: '🎸' },
    ], false, vi.fn());

    document.body.append(toolbar.element);
    const nav = toolbar.element.querySelector('nav[aria-label="Fil d’Ariane"]');
    const entries = nav?.querySelectorAll('[data-desktop-page-breadcrumb-item]');

    expect(Array.from(entries ?? []).map((item) => item.textContent)).toEqual(['🏕️Nouvelle page', '🎸jojo']);
    expect(nav?.querySelector('[data-desktop-page-breadcrumb-separator]')?.textContent).toBe('/');
    expect(entries?.[1]?.querySelector('[aria-current="page"]')).not.toBeNull();
    entries?.[0]?.querySelector('button')?.click();
    expect(onOpen).toHaveBeenCalledOnce();

    toolbar.setBreadcrumbs([
      { id: 'parent', title: 'Page renommée', icon: '🚗', onOpen },
      { id: 'child', title: 'jojo', icon: '🎸' },
    ]);
    expect(nav?.textContent).toContain('🚗Page renommée/🎸jojo');
    toolbar.destroy();
  });

  it('opens each breadcrumb menu and navigates from its page list', () => {
    const openSibling = vi.fn();
    const toolbar = createPageToolbar([
      { id: 'parent', title: 'Nouvelle page', icon: '🏕️', menuHeading: 'Pages locales', menu: [
        { id: 'parent', title: 'Nouvelle page', icon: '🏕️', current: true, children: [
          { id: 'child', title: 'jojo', icon: '🎸', current: true, onOpen: vi.fn() },
        ], onOpen: vi.fn() },
      ] },
      { id: 'child', title: 'jojo', icon: '🎸', menuHeading: 'Nouvelle page', menu: [
        { id: 'child', title: 'jojo', icon: '🎸', current: true, onOpen: vi.fn() },
        { id: 'sibling', title: 'Autre page', onOpen: openSibling },
      ] },
    ], false, vi.fn());

    document.body.append(toolbar.element);
    const child = toolbar.element.querySelector<HTMLButtonElement>('[data-page-id="child"] > button')!;

    child.click();
    const menu = toolbar.element.querySelector<HTMLElement>('[data-desktop-breadcrumb-menu]')!;

    expect(menu.hidden).toBe(false);
    expect(child.getAttribute('aria-expanded')).toBe('true');
    expect(menu.querySelector('[data-desktop-breadcrumb-menu-heading]')?.textContent).toBe('Nouvelle page');
    expect(menu.querySelector('[data-desktop-breadcrumb-menu-item="child"]')?.getAttribute('aria-current')).toBe('page');
    menu.querySelector<HTMLButtonElement>('[data-desktop-breadcrumb-menu-item="sibling"]')?.click();
    expect(openSibling).toHaveBeenCalledOnce();
    expect(menu.hidden).toBe(true);

    toolbar.element.querySelector<HTMLButtonElement>('[data-page-id="parent"] > button')?.click();
    expect(menu.querySelector('[data-desktop-breadcrumb-menu-heading]')?.textContent).toBe('Pages locales');
    expect(menu.querySelector('[data-desktop-breadcrumb-menu-children]')).not.toBeNull();
    menu.querySelector<HTMLButtonElement>('[data-desktop-breadcrumb-menu-children]')?.click();
    expect(menu.querySelector('[data-desktop-breadcrumb-menu-heading]')?.textContent).toBe('Nouvelle page');
    expect(menu.querySelector('[data-desktop-breadcrumb-menu-item="child"]')?.getAttribute('aria-current')).toBe('page');
    menu.querySelector<HTMLButtonElement>('[data-desktop-breadcrumb-menu-back]')?.click();
    expect(menu.querySelector('[data-desktop-breadcrumb-menu-heading]')?.textContent).toBe('Pages locales');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu.hidden).toBe(true);
    toolbar.destroy();
  });
});
