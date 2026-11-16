import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mountSidebarCustomization} from './sidebar-customization';
import {readSidebarLayout,saveSidebarLayout} from './sidebar-preferences';
import type {CloudClient} from './cloud/client';
import type {RemoteWorkspace} from './workspace-registry';
const ref={kind:'local' as const,id:'editor',name:'Editor'};
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();});
afterEach(()=>{vi.restoreAllMocks();document.body.replaceChildren();});
function findButton(label:string):HTMLButtonElement {
  const result=Array.from(document.querySelectorAll('button')).find(button=>button.getAttribute('aria-label')===label||button.textContent?.trim()===label);
  if(!result)throw new Error(`Missing button ${label}`);return result;
}
it('keeps focus while renaming and lets keyboard controls reorder tabs',()=>{
  const handle=mountSidebarCustomization(document.body,ref);
  const input=document.querySelector<HTMLInputElement>('[aria-label="Nom de l’onglet"]');if(!input)throw new Error('Missing name');input.focus();input.value='Personnel';input.dispatchEvent(new Event('input'));
  expect(document.activeElement).toBe(input);expect(readSidebarLayout(ref).tabs[0].name).toBe('Personnel');
  findButton('Descendre Accueil').click();expect(readSidebarLayout(ref).tabs[1].name).toBe('Personnel');handle.destroy();
});
it('enforces six tabs and keeps at least one',()=>{
  const handle=mountSidebarCustomization(document.body,ref);
  for(let i=0;i<3;i++)findButton('Ajouter un onglet').click();expect(findButton('Ajouter un onglet').disabled).toBe(true);
  for(let i=0;i<5;i++)findButton('Supprimer l’onglet').click();expect(findButton('Supprimer l’onglet').disabled).toBe(true);expect(readSidebarLayout(ref).tabs).toHaveLength(1);handle.destroy();
});
it('ignores a tab dragged onto sections',()=>{
  const handle=mountSidebarCustomization(document.body,ref);const initial=readSidebarLayout(ref);
  const tabRow=findButton('Descendre Accueil').parentElement;const sectionRow=findButton('Descendre Récents').parentElement;
  tabRow?.dispatchEvent(new Event('dragstart'));sectionRow?.dispatchEvent(new Event('drop',{cancelable:true}));
  expect(readSidebarLayout(ref)).toEqual(initial);handle.destroy();
});
it('does not publish page shortcuts into workspace models',async()=>{
  const remote:RemoteWorkspace={kind:'remote',id:'w',name:'Workspace',server:'https://example.com',accountId:'a',workspaceId:'w',role:'admin'};
  const layout=readSidebarLayout(remote);layout.tabs[0].shortcuts.push({id:'private',kind:'page',pageId:'secret',visible:true});saveSidebarLayout(remote,layout);
  const request=vi.fn(async()=>({presets:[]}));const handle=mountSidebarCustomization(document.body,remote,{presetsOnly:true,admin:true,client:{request} as unknown as CloudClient});
  await vi.waitFor(()=>expect(findButton('Publier cet onglet comme modèle').disabled).toBe(false));findButton('Publier cet onglet comme modèle').click();
  expect(request).toHaveBeenCalledTimes(1);expect(document.body.textContent).toContain('Retirez les raccourcis');handle.destroy();
});
it('publishes a distinct tab id when creating a new model',async()=>{
  const remote:RemoteWorkspace={kind:'remote',id:'w',name:'Workspace',server:'https://example.com',accountId:'a',workspaceId:'w',role:'admin'};
  const request=vi.fn(async(_path:string,init?:RequestInit)=>init?.body?JSON.parse(String(init.body)) as unknown:{presets:[]});
  const handle=mountSidebarCustomization(document.body,remote,{presetsOnly:true,admin:true,client:{request} as unknown as CloudClient});
  await vi.waitFor(()=>expect(findButton('Publier cet onglet comme modèle').disabled).toBe(false));findButton('Publier cet onglet comme modèle').click();
  await vi.waitFor(()=>expect(request).toHaveBeenCalledTimes(2));const sent=JSON.parse(String(request.mock.calls[1][1]?.body)) as {presets:Array<{tab:{id:string}}>};expect(sent.presets[0].tab.id).not.toBe('home');handle.destroy();
});

it('preserves the tab glyph while its name changes',()=>{
  const handle=mountSidebarCustomization(document.body,ref);findButton('Chat').click();
  const selected=document.querySelector('button[aria-pressed="true"]');const glyph=selected?.querySelector('svg');expect(glyph).not.toBeNull();
  const input=document.querySelector<HTMLInputElement>('[aria-label="Nom de l’onglet"]');if(!input)throw new Error('Missing name');input.value='Échanges';input.dispatchEvent(new Event('input'));
  expect(selected?.querySelector('svg')).toBe(glyph);expect(selected?.textContent?.trim()).toBe('Échanges');handle.destroy();
});
