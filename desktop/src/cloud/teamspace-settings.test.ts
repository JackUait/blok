import {afterEach,describe,expect,it,vi} from 'vitest';
import {must} from '../test-helpers';
import {mountTeamspaceSettings} from './teamspace-settings';
import {teamspaceClient,type Teamspace,type TeamspaceClient} from './teamspaces';
const picker=vi.hoisted(()=>({options:null as null|{onSelect(icon:string):void;onRemove():void}}));
vi.mock('@blok/emoji-picker',()=>({EmojiPicker:class{node=document.createElement('div');constructor(options:typeof picker.options){picker.options=options;}getElement(){return this.node;}open(){return Promise.resolve();}close(){this.node.hidden=true;}}}));
const team:Teamspace={id:'product',workspaceId:'ws',name:'Produit',icon:'🛠️',description:'Docs produit',mode:'closed',archived:false,myRole:'owner',canManage:true};
const click=(label:string):void=>must([...document.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent===label)).click();
function setup(over:Partial<Teamspace>={},canCreate=true){
 const current={...team,...over};
 const api={list:vi.fn(async()=>({teamspaces:[current]})),get:vi.fn(async()=>current),create:vi.fn(async()=>current),update:vi.fn(async()=>current),members:vi.fn(async()=>({members:[{userId:'owner',email:'owner@example.org',role:'owner' as const}]})),workspaceMembers:vi.fn(async()=>({members:[{id:'owner',email:'owner@example.org',role:'admin' as const},{id:'member',email:'member@example.org',role:'member' as const}]})),setMember:vi.fn(async()=>({ok:true})),removeMember:vi.fn(async()=>({ok:true})),archive:vi.fn(async()=>({...current,archived:true})),createPage:vi.fn()} satisfies TeamspaceClient;
 const changed=vi.fn();const handle=mountTeamspaceSettings(document.body,{api,canCreate,onChanged:changed});return {api,changed,handle,current};
}
async function openDetail(){await vi.waitFor(()=>expect(document.querySelector('[data-teamspace-list]')).not.toBeNull());click('🛠️ Produit');await vi.waitFor(()=>expect(document.querySelector('[data-teamspace-identity-form]')).not.toBeNull());}
afterEach(()=>{document.body.replaceChildren();picker.options=null;vi.restoreAllMocks();});
describe('teamspace settings',()=>{
 it('updates the fallback initial while typing without replacing a chosen emoji',async()=>{
  const {api}=setup();await vi.waitFor(()=>expect(api.list).toHaveBeenCalled());click('Créer un espace d’équipe');
  const name=must(document.querySelector<HTMLInputElement>('[aria-label="Nom de l’espace d’équipe"]'));
  const icon=must(document.querySelector<HTMLButtonElement>('[data-teamspace-icon]'));
  const type=(value:string)=>{name.value=value;name.dispatchEvent(new Event('input',{bubbles:true}));};
  type('test');expect(icon.textContent).toBe('T');
  type('  équipe');expect(icon.textContent).toBe('É');
  type('');expect(icon.textContent).toBe('É');
  icon.click();must(picker.options).onSelect('🛠️');type('Produit');expect(icon.textContent).toBe('🛠️');
  type('  rédaction');click('Supprimer l’icône');expect(icon.textContent).toBe('R');
  type('support');expect(icon.textContent).toBe('S');
  expect(api.create).not.toHaveBeenCalled();
 });

 it('keeps workspace and teamspace identity separate, saves draft emoji/name/description only on submit',async()=>{
  const {api}=setup();await openDetail();
  const name=must(document.querySelector<HTMLInputElement>('[aria-label="Nom de l’espace d’équipe"]'));name.value='  Rédaction  ';
  must(document.querySelector<HTMLTextAreaElement>('textarea')).value='Guide éditorial';
  must(document.querySelector<HTMLButtonElement>('[data-teamspace-icon]')).click();must(picker.options).onSelect('👩🏽‍💻');
  expect(api.update).not.toHaveBeenCalled();click('Enregistrer');
  await vi.waitFor(()=>expect(api.update).toHaveBeenCalledExactlyOnceWith('product',{name:'Rédaction',icon:'👩🏽‍💻',description:'Guide éditorial'}));
 });
 it('creates only a closed teamspace and keeps creation out of member/viewer UI',async()=>{
  const {api,handle}=setup();await vi.waitFor(()=>expect(api.list).toHaveBeenCalled());click('Créer un espace d’équipe');
  must(document.querySelector<HTMLInputElement>('[aria-label="Nom de l’espace d’équipe"]')).value='Équipe';click('Créer l’espace d’équipe');await vi.waitFor(()=>expect(api.create).toHaveBeenCalledWith({name:'Équipe',icon:null,description:''}));
  handle.destroy();document.body.replaceChildren();setup({myRole:null,canManage:false},false);await openDetail();
  expect([...document.querySelectorAll('button')].some(node=>node.textContent==='Enregistrer')).toBe(false);
  expect([...document.querySelectorAll('button')].some(node=>node.textContent==='Membres')).toBe(false);
 });
 it('offers existing workspace users without email invitation and surfaces last-owner errors without removing the roster',async()=>{
  const {api,changed}=setup();await openDetail();click('Membres');
  await vi.waitFor(()=>expect(document.querySelector('[data-teamspace-add-member]')).not.toBeNull());
  const select=must(document.querySelector<HTMLSelectElement>('[data-teamspace-add-member] select'));select.value='member';click('Ajouter à cet espace d’équipe');
  await vi.waitFor(()=>expect(api.setMember).toHaveBeenCalledExactlyOnceWith('product','member','member'));
  await vi.waitFor(()=>expect(document.querySelector('[aria-busy=true]')).toBeNull());
  api.removeMember.mockRejectedValue(new Error('Dernier propriétaire protégé'));
  click('Retirer');await vi.waitFor(()=>expect(document.querySelector('[role=status]')?.textContent).toBe('Dernier propriétaire protégé'));
  expect(document.body.textContent).toContain('owner@example.org');expect(changed).toHaveBeenCalledOnce();
 });
 it('keeps access read-only closed and requires a separate confirmation for archive',async()=>{
  const {api}=setup();await openDetail();click('Accès');await vi.waitFor(()=>expect(document.querySelector('[data-teamspace-archive]')).not.toBeNull());
  expect(document.body.textContent).toContain('ne sont pas pris en charge');click('Archiver…');expect(api.archive).not.toHaveBeenCalled();click('Confirmer l’archivage');await vi.waitFor(()=>expect(api.archive).toHaveBeenCalledExactlyOnceWith('product',true));
 });
 it('shows server failures instead of a fake empty list',async()=>{
  const {api,handle}=setup();handle.destroy();document.body.replaceChildren();api.list.mockRejectedValue(new Error('Session expirée'));mountTeamspaceSettings(document.body,{api,canCreate:false,onChanged:vi.fn()});await vi.waitFor(()=>expect(document.body.textContent).toContain('Session expirée'));expect(document.body.textContent).not.toContain('Aucun espace d’équipe.');
 });
});
describe('teamspace HTTP adapter',()=>{
 it('uses scoped encoded routes and distinct member/create-page operations, no invitation route',async()=>{
  const request=vi.fn(async(_path:string,_init?:RequestInit)=>team);const api=teamspaceClient({request} as Parameters<typeof teamspaceClient>[0],'ws /');
  await api.create({name:'Équipe',icon:'🇫🇷',description:'Docs'});await api.setMember('ts /','user /','member');await api.createPage('ts /','Notes');await api.archive('ts /',false);
  expect(request.mock.calls.map(call=>call[0])).toEqual(['/api/workspaces/ws%20%2F/teamspaces','/api/workspaces/ws%20%2F/teamspaces/ts%20%2F/members/user%20%2F','/api/workspaces/ws%20%2F/teamspaces/ts%20%2F/pages','/api/workspaces/ws%20%2F/teamspaces/ts%20%2F/restore']);
  expect(request).toHaveBeenNthCalledWith(1,expect.any(String),expect.objectContaining({method:'POST',body:JSON.stringify({name:'Équipe',icon:'🇫🇷',description:'Docs',mode:'closed'})}));
 });
});
