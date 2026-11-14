import { describe, expect, it, vi } from 'vitest';
import { createEmptyWorkspaceState } from './workspace-empty';

describe('empty remote workspace', () => {
  it('shows a clear message without creating a page automatically', () => {
    const create = vi.fn();
    const element = createEmptyWorkspaceState(false, create);
    expect(element.textContent).toContain('Cet espace est vide. Créez votre première page.');
    expect(create).not.toHaveBeenCalled();
    element.querySelector<HTMLButtonElement>('button')!.click();
    expect(create).toHaveBeenCalledOnce();
  });

  it('explains that no page is available to a viewer without offering creation', () => {
    const create = vi.fn();
    const element = createEmptyWorkspaceState(true, create);
    expect(element.textContent).toContain('Aucune page n’est partagée avec vous pour le moment');
    expect(element.querySelector('button')).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('offers three start cards and two discreet links for non-viewers', () => {
    const create = vi.fn();
    const template = vi.fn();
    const invite = vi.fn();
    const importPage = vi.fn();
    const gettingStarted = vi.fn();
    const element = createEmptyWorkspaceState(false, create, {
      onTemplate: template,
      onInvite: invite,
      onImport: importPage,
      onGettingStarted: gettingStarted,
    });
    const labels = [...element.querySelectorAll('[data-desktop-empty-card]')].map((node) => node.textContent);
    expect(labels).toEqual([
      expect.stringContaining('Créer une page'),
      expect.stringContaining('Partir d’un modèle'),
      expect.stringContaining('Inviter des personnes'),
    ]);
    const links = [...element.querySelectorAll('[data-desktop-empty-link]')].map((node) => node.textContent);
    expect(links).toEqual(['Importer', 'Premiers pas']);
    element.querySelector<HTMLButtonElement>('[data-desktop-empty-card="template"]')!.click();
    element.querySelector<HTMLButtonElement>('[data-desktop-empty-card="invite"]')!.click();
    element.querySelector<HTMLButtonElement>('[data-desktop-empty-link="import"]')!.click();
    element.querySelector<HTMLButtonElement>('[data-desktop-empty-link="getting-started"]')!.click();
    expect(template).toHaveBeenCalledOnce();
    expect(invite).toHaveBeenCalledOnce();
    expect(importPage).toHaveBeenCalledOnce();
    expect(gettingStarted).toHaveBeenCalledOnce();
  });
});
