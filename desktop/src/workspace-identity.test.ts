import {must} from './test-helpers';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mountWorkspaceIcon, workspaceGlyph, bindWorkspaceGlyph} from './workspace-identity';
import {CloudClient} from './cloud/client';
import {activeWorkspace, rememberWorkspace, listWorkspaces, type WorkspaceRef} from './workspace-registry';
const picker=vi.hoisted(()=>({options:null as null|{onSelect(icon:string):void;onRemove():void}}));
vi.mock('@blok/emoji-picker',()=>({EmojiPicker:class {
 element=document.createElement('div');
 constructor(options:typeof picker.options){picker.options=options;}
 getElement(){return this.element;}open(){return Promise.resolve();}close(){}
}}));
afterEach(()=>{document.body.replaceChildren();localStorage.clear();vi.restoreAllMocks();picker.options=null;});
const local=():WorkspaceRef=>({kind:'local',id:'personal',name:'Mes notes'});
const remote=(role:'admin'|'member'|'viewer'='admin'):WorkspaceRef=>({kind:'remote',id:'team',workspaceId:'team',server:'https://example.org',accountId:'user',name:'Équipe',role,icon:'🏡'});
function mount(ref:WorkspaceRef){const changed=vi.fn();const client=new CloudClient({origin:'https://example.org'});const handle=mountWorkspaceIcon(document.body,ref,client,changed);return {changed,handle};}
function choose(icon:string){must(document.querySelector<HTMLButtonElement>('[data-desktop-workspace-icon]')).click();must(picker.options).onSelect(icon);}
describe('workspace identity',()=>{
 it('restores the default local identity without an explicit workspace selection',()=>{
  rememberWorkspace({kind:'local',id:'default',name:'Mon carnet',icon:'👩🏽‍💻'});
  expect(activeWorkspace()).toMatchObject({id:'default',name:'Mon carnet',icon:'👩🏽‍💻'});
 });
 it('persists composed emoji locally and restores it when reconstructed, then falls back to initial on remove',async()=>{
  const ref=local();const {handle}=mount(ref);choose('👩🏽‍💻');await vi.waitFor(()=>expect(listWorkspaces().find(item=>item.id===ref.id)?.icon).toBe('👩🏽‍💻'));
  handle.destroy();document.body.replaceChildren();const restored=must(listWorkspaces().find(item=>item.id===ref.id));mount(restored);expect(document.querySelector('[data-desktop-workspace-icon]')?.textContent).toBe('👩🏽‍💻');
  must([...document.querySelectorAll('button')].find(el=>el.textContent==='Supprimer l’icône')).click();await vi.waitFor(()=>expect(listWorkspaces().find(item=>item.id===ref.id)?.icon).toBeNull());expect(workspaceGlyph(restored)).toBe('M');
 });
 it('waits for acknowledgement, sends only the icon, and keeps previous state on server failure',async()=>{
  const ref=remote();const changed=mount(ref).changed;
  const patch=vi.spyOn(CloudClient.prototype,'updateWorkspaceIdentity').mockRejectedValue(new Error('Connexion perdue'));
  choose('👨‍👩‍👧‍👦');await vi.waitFor(()=>expect(document.querySelector('[role=status]')?.textContent).toBe('Connexion perdue'));
  expect(ref.icon).toBe('🏡');expect(changed).not.toHaveBeenCalled();expect(patch).toHaveBeenCalledWith('team',{icon:'👨‍👩‍👧‍👦'});
  patch.mockResolvedValue({id:'team',slug:'team',name:'Équipe',role:'admin',icon:'🇫🇷'});choose('🇫🇷');await vi.waitFor(()=>expect(changed).toHaveBeenCalledOnce());expect(ref.icon).toBe('🇫🇷');
  expect(listWorkspaces().find(item=>item.id===ref.id)?.icon).toBe('🇫🇷');
 });
 it.each(['member','viewer'] as const)('keeps identity read only for a %s',role=>{
  const patch=vi.spyOn(CloudClient.prototype,'updateWorkspaceIdentity');mount(remote(role));must(document.querySelector<HTMLButtonElement>('[data-desktop-workspace-icon]')).click();expect(picker.options).toBeNull();expect(patch).not.toHaveBeenCalled();expect(document.body.textContent).toContain('Seuls les administrateurs');
 });
 it('updates sidebar glyph while preserving its chevron after rerender',async()=>{
  const ref=remote();const root=document.createElement('div');document.body.append(root);root.innerHTML='<span data-blok-sidebar-teamspace-mark><svg></svg><i data-chevron></i></span>';bindWorkspaceGlyph(root,ref);
  expect(root.querySelector('[data-desktop-teamspace-icon]')?.textContent).toBe('🏡');
  root.dispatchEvent(new CustomEvent('blok:desktop-workspace-renamed',{detail:{key:JSON.stringify(['remote','https://example.org','user','team']),name:'Nouvelle',icon:'👩🏽‍💻'}}));
  expect(root.querySelector('[data-desktop-teamspace-icon]')?.textContent).toBe('👩🏽‍💻');expect(root.querySelector('[data-chevron]')).not.toBeNull();
  root.innerHTML='<span data-blok-sidebar-teamspace-mark><svg></svg><i data-chevron></i></span>';await vi.waitFor(()=>expect(root.querySelector('[data-desktop-teamspace-icon]')?.textContent).toBe('👩🏽‍💻'));
 });
});
