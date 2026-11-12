import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rememberWorkspace, workspaceKey, type RemoteWorkspace } from './workspace-registry';
import { applyAppearance, createDesktopFooter, readAppearance } from './settings';

const childUi = vi.hoisted(() => ({
  destroy: vi.fn(), refresh: vi.fn(async () => undefined),
  mount: vi.fn(), invite: vi.fn(),
}));
vi.mock('./cloud/workspace-settings', () => ({
  mountWorkspaceMembers: childUi.mount, openWorkspaceInvitation: childUi.invite,
}));
beforeEach(() => {
  vi.clearAllMocks();
  childUi.mount.mockReturnValue({destroy: childUi.destroy, refresh: childUi.refresh});
});
afterEach(() => {
  document.querySelector<HTMLButtonElement>('[data-desktop-settings-close]')?.click();
  document.body.innerHTML = '';
  document.body.removeAttribute('data-blok-theme');
  document.documentElement.removeAttribute('data-blok-theme');
  localStorage.clear();
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
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
      .find((item) => item.textContent?.includes('Paramètres'))!;
    preferences.click();
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.parentElement?.hasAttribute('hidden')).toBe(false);
    const theme = dialog.querySelector('[data-desktop-settings-theme]') as HTMLButtonElement;
    theme.click();
    document.querySelector<HTMLElement>('[data-blok-item-name=light]')!.click();
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
    expect(dialog.querySelectorAll('[data-desktop-settings-provider-status]')).toHaveLength(0);
    expect(dialog.textContent).toContain('Configurez OpenAI');
    expect(dialog.querySelector('[data-desktop-settings-title]')?.textContent).toBe('Assistant IA');
  });
});

const remoteRef: RemoteWorkspace = {kind:'remote',id:'team',name:'Tousambassadeurs',server:'http://localhost:1420',accountId:'user',userName:'member@example.org',workspaceId:'tousambassadeurs',role:'admin'};
function remoteFooter(role: 'admin'|'member'|'viewer' = 'admin'): HTMLElement {
  const ref = {...remoteRef,role}; rememberWorkspace(ref);
  localStorage.setItem('blok:desktop:active-workspace:v1',workspaceKey(ref));
  const footer=createDesktopFooter(()=>undefined);document.body.append(footer);
  footer.querySelector<HTMLButtonElement>('[data-desktop-switcher]')!.click();
  return footer;
}
describe('workspace menu hierarchy',()=>{
  it('shows three primary admin actions and account-grouped workspaces without browser local data controls',()=>{
    const footer=remoteFooter();const menu=footer.querySelector('[data-desktop-footer-menu]')!;
    const primary=[...menu.children].filter((node)=>node.getAttribute('role')==='menuitem');
    // The identity header is separately styled; only three command rows follow it.
    expect(primary.map(node=>node.textContent)).toEqual(['Paramètres','Inviter des membres','Gérer mon compte']);
    expect(menu.textContent).not.toContain('localhost');
    expect(menu.textContent).not.toContain('Créer un espace local');
    expect(menu.textContent).not.toContain('Copier le chemin');
    expect(menu.querySelector('[aria-label="Sur cet appareil"]')).toBeNull();
    expect(menu.querySelector('[role="menuitemradio"][aria-current="true"]')?.textContent).toContain('Tousambassadeurs');
  });
  it('opens settings, invitations and account management in place; only the explicit account chooser navigates',()=>{
    const footer=remoteFooter();const events: unknown[]=[];const href=location.href;
    footer.addEventListener('blok:desktop-connect-cloud',(event)=>events.push((event as CustomEvent).detail));
    [...footer.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(node=>node.textContent==='Paramètres')!.click();
    expect(document.querySelector('[data-desktop-settings-theme]')).not.toBeNull();
    expect(footer.inert || footer.hasAttribute('inert')).toBe(true);
    expect(location.href).toBe(href); expect(events).toEqual([]);
    document.querySelector<HTMLButtonElement>('[data-desktop-settings-close]')!.click();
    footer.querySelector<HTMLButtonElement>('[data-desktop-menu-invite]')!.click();
    expect(childUi.invite).toHaveBeenCalledWith(expect.objectContaining({slug:'tousambassadeurs',workspaceName:'Tousambassadeurs'}));
    footer.querySelector<HTMLButtonElement>('[data-desktop-menu-connect]')!.click();
    const dialog=document.querySelector<HTMLElement>('[data-desktop-settings-dialog]')!;
    expect(dialog.querySelector('[data-desktop-settings-title]')?.textContent).toBe('Mon compte');
    expect(dialog.querySelector('[data-desktop-settings-content]')?.textContent).toContain('member@example.org');
    expect(dialog.querySelector('[data-desktop-settings-nav-item][aria-current="page"]')?.textContent).toBe('member@example.org');
    expect(location.href).toBe(href); expect(events).toEqual([]);
    [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent==='Comptes et espaces')!.click();
    expect(events).toEqual([{section:'account'}]);
  });
  it('reuses the members panel, nests invitations inside the settings modal, and tears down the panel on close',()=>{
    const footer=remoteFooter();
    [...footer.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(node=>node.textContent==='Paramètres')!.click();
    const dialog=document.querySelector<HTMLElement>('[data-desktop-settings-dialog]')!;
    [...dialog.querySelectorAll<HTMLButtonElement>('[data-desktop-settings-nav-item]')].find(node=>node.textContent==='Membres')!.click();
    expect(childUi.mount).toHaveBeenCalledWith(expect.any(HTMLElement),expect.objectContaining({slug:'tousambassadeurs'}));
    childUi.mount.mock.calls[0]![1].onInvite();
    expect(childUi.invite).toHaveBeenLastCalledWith(expect.objectContaining({container:dialog}));
    dialog.querySelector<HTMLButtonElement>('[data-desktop-settings-close]')!.click();
    expect(childUi.destroy).toHaveBeenCalledOnce();
    expect(footer.hasAttribute('inert')).toBe(false);
  });
  it('shows actual account identity and role without an editable workspace-name masquerading as a profile',()=>{
    const footer=remoteFooter();
    [...footer.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(node=>node.textContent==='Paramètres')!.click();
    const dialog=document.querySelector<HTMLElement>('[data-desktop-settings-dialog]')!;
    [...dialog.querySelectorAll<HTMLButtonElement>('[data-desktop-settings-nav-item]')].find(node=>node.textContent==='member@example.org')!.click();
    expect(dialog.querySelector('[data-desktop-settings-content]')?.textContent).toContain('member@example.org');
    expect(dialog.querySelector('[data-desktop-settings-content]')?.textContent).toContain('Administrateur');
    expect(dialog.querySelector('[data-desktop-settings-name]')).toBeNull();
  });
  it.each(['member','viewer'] as const)('keeps invitations out of the %s menu and opens appearance preferences',role=>{
    const footer=remoteFooter(role);
    expect(footer.querySelector('[data-desktop-menu-invite]')).toBeNull();
    [...footer.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(node=>node.textContent==='Paramètres')!.click();
    expect(document.querySelector('[data-desktop-settings-theme]')).not.toBeNull();
    expect(document.querySelector('[data-desktop-settings-path]')).toBeNull();
  });
  it('keeps local workspaces in a separate native group and puts paths inside advanced preferences',()=>{
    Reflect.set(window,'__TAURI_INTERNALS__',{invoke:vi.fn().mockResolvedValue('/test/workspace')});
    const footer=createDesktopFooter(()=>undefined);document.body.append(footer);
    footer.querySelector<HTMLButtonElement>('[data-desktop-switcher]')!.click();
    expect(footer.querySelector('[aria-label="Sur cet appareil"] [data-desktop-menu-new-workspace]')).not.toBeNull();
    expect(footer.querySelector('[data-desktop-footer-menu]')?.textContent).not.toContain('Copier le chemin');
    [...footer.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(node=>node.textContent==='Paramètres')!.click();
    expect(document.querySelector('details [data-desktop-settings-path]')).not.toBeNull();
  });
});
