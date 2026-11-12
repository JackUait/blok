import { describe, expect, it, vi } from 'vitest';
import { createEmptyWorkspaceState } from './workspace-empty';
describe('empty remote workspace',()=>{
  it('shows a clear message without creating a page automatically',()=>{
    const create=vi.fn(); const element=createEmptyWorkspaceState(false,create);
    expect(element.textContent).toContain('Cet espace est vide. Créez votre première page.');
    expect(create).not.toHaveBeenCalled();
    element.querySelector<HTMLButtonElement>('button')!.click();
    expect(create).toHaveBeenCalledOnce();
  });
  it('explains that no page is available to a viewer without offering creation',()=>{
    const create=vi.fn(); const element=createEmptyWorkspaceState(true,create);
    expect(element.textContent).toContain('Aucune page n’est disponible');
    expect(element.querySelector('button')).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});
