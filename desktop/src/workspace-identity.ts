import french from '../../src/components/i18n/locales/fr.json';
import { EmojiPicker } from '@blok/emoji-picker';
import type { WorkspaceRef } from './workspace-registry';
import { rememberWorkspace, workspaceKey } from './workspace-registry';
import type { CloudClient } from './cloud/client';

export const workspaceGlyph = (ref: Pick<WorkspaceRef, 'name' | 'icon'>): string => ref.icon || [...ref.name][0]?.toLocaleUpperCase() || 'B';

export function mountWorkspaceIcon(container: HTMLElement, ref: WorkspaceRef, client: CloudClient | null, changed: () => void): {destroy(): void; dismiss(): boolean} {
  const identity=ref;
  const state={dead:false,saving:false,picker:null as EmojiPicker | null};
  const area=document.createElement('div');area.setAttribute('data-desktop-settings-row','');
  area.setAttribute('data-desktop-settings-field','');
  const title=document.createElement('strong');title.textContent='Icône du Workspace';
  title.setAttribute('data-desktop-settings-row-title','');
  const help=document.createElement('p');help.setAttribute('data-desktop-settings-row-help','');help.textContent='Choisissez un emoji pour reconnaître ce Workspace dans le sélecteur de Workspaces.';
  const trigger=document.createElement('button');trigger.type='button';trigger.textContent=workspaceGlyph(identity);
  trigger.setAttribute('data-desktop-workspace-icon','');trigger.setAttribute('data-desktop-settings-copy','');trigger.setAttribute('aria-label','Choisir l’emoji du Workspace');
  const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('data-desktop-settings-row-help','');
  const canEdit=identity.kind==='local' || identity.role==='admin';
  const remove=document.createElement('button');remove.type='button';remove.textContent='Supprimer l’icône';remove.setAttribute('data-desktop-settings-copy','');
  const render=():void=>{trigger.textContent=workspaceGlyph(identity);trigger.disabled=!canEdit || state.saving;remove.disabled=!canEdit || state.saving || !identity.icon;};
  const save=async(icon:string|null):Promise<void>=>{
    if(!canEdit || state.saving || state.dead)return;
    state.saving=true;render();status.textContent='Enregistrement…';
    try {
      const saved=identity.kind==='remote'
        ? await (() => {if (!client) throw new Error('Serveur indisponible.');return client.updateWorkspaceIdentity(identity.workspaceId,{icon});})() : {...identity,icon};
      // Commit only acknowledged values; failed requests leave the old identity intact.
      const previous=identity.icon;
      identity.icon=saved.icon ?? null;
      try {rememberWorkspace(identity);} catch(error) {identity.icon=previous;throw error;}
      changed();
      if(!state.dead)status.textContent=icon ? 'Icône du Workspace enregistrée.' : 'Icône supprimée. L’initiale du nom est utilisée.';
    } catch(error) {if(!state.dead)status.textContent=error instanceof Error ? error.message : 'Enregistrement impossible. Réessayez.';}
    finally {state.saving=false;if(!state.dead)render();}
  };
  trigger.addEventListener('click',()=>{
    if(state.saving || !canEdit)return;
    state.picker??=new EmojiPicker({onSelect:icon=>{void save(icon);},onRemove:()=>{void save(null);},i18n:{t:key=>(french as Record<string,string>)[key] ?? key},locale:'fr',curated:false,fitToAnchor:true,startInset:0});
    const element=state.picker.getElement();if(!element.isConnected)container.append(element);
    void state.picker.open(trigger,undefined,{current:identity.icon ?? '',onSelect:icon=>{void save(icon);},onRemove:()=>{void save(null);}}).catch(error=>{status.textContent=error instanceof Error ? error.message : 'Sélecteur indisponible.';});
  });
  remove.addEventListener('click',()=>{void save(null);});
  const controls=document.createElement('div');controls.setAttribute('data-desktop-workspace-icon-controls','');controls.append(trigger);
  area.append(title,help,controls);
  if(canEdit)controls.append(remove);
  else status.textContent='Seuls les administrateurs de cet espace peuvent modifier son identité.';
  area.append(status);container.append(area);render();
  return {dismiss(){if(!state.picker || state.picker.getElement().hidden)return false;state.picker.close();return true;},destroy(){state.dead=true;state.picker?.close();state.picker?.getElement().remove();}};
}

/** The shared sidebar owns its chevron; decorate only its workspace mark. */
export function bindWorkspaceGlyph(root: HTMLElement, ref: WorkspaceRef): void {
  const state={ref,icon:ref.icon};
  const paint=():void=>{
    const mark=root.querySelector('[data-blok-sidebar-teamspace-mark]');
    if(!mark)return;
    const current=mark.querySelector('[data-desktop-teamspace-icon]');
    if(current?.textContent === (state.icon || workspaceGlyph(state.ref)))return;
    const glyph=document.createElement('span');glyph.setAttribute('data-desktop-teamspace-icon','');glyph.textContent=state.icon || workspaceGlyph(state.ref);
    mark.firstChild?.replaceWith(glyph);
  };
  new MutationObserver(paint).observe(root,{childList:true,subtree:true});
  root.addEventListener('blok:desktop-workspace-renamed',event=>{
    const detail=(event as CustomEvent<{key:string;name:string;icon?:string|null}>).detail;
    if(detail?.key!==workspaceKey(state.ref))return;
    state.ref={...state.ref,name:detail.name,...('icon' in detail ? {icon:detail.icon} : {})};state.icon=state.ref.icon;paint();
  });paint();
}
