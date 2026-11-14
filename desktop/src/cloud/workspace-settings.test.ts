import {afterEach,describe,expect,it,vi} from 'vitest';
import {WORKSPACE_ROLES} from '../access-vocabulary';
import {CloudClient} from './client';
import {mountWorkspaceMembers,openWorkspaceInvitation} from './workspace-settings';
import {openModalDialog} from '@blok/modal-dialog';
const reply=(value:unknown,status=200):Response=>({ok:status<400,status,json:async()=>value} as Response);
afterEach(()=>{vi.unstubAllGlobals();document.body.replaceChildren();});
async function loaded(text:string):Promise<void>{await vi.waitFor(()=>expect(document.body.textContent).toContain(text));}
function click(name:string):void{const button=[...document.querySelectorAll('button')].find(item=>item.textContent===name);expect(button).toBeTruthy();button!.click();}
function submit():void{document.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));}
async function choose(label:string,value:string):Promise<void>{
 const trigger=[...document.querySelectorAll<HTMLButtonElement>('[data-desktop-choice]')].find(item=>item.getAttribute('aria-label')===label);expect(trigger).toBeTruthy();trigger!.click();
 await vi.waitFor(()=>expect(document.querySelector('[data-desktop-choice-popover]')).toBeTruthy());
 const option=[...document.querySelectorAll<HTMLElement>('[data-desktop-choice-popover] [role=menuitemradio]')].find(item=>{
  const title=item.querySelector('[data-blok-popover-item-title]')?.textContent?.trim();
  return title===value || item.textContent?.trim()===value || item.textContent?.trim().startsWith(value);
 });expect(option).toBeTruthy();option!.click();
}
function mockAccess(){
 let approved=false;let revoked=false;let role='member';
 const fetch=vi.fn(async(url:string,init?:RequestInit)=>{
  if(url.endsWith('/approve')){approved=true;expect(JSON.parse(init!.body as string)).toEqual({role:'viewer'});return reply({ok:true});}
  if(init?.method==='PATCH'){role=JSON.parse(init.body as string).role;return reply({ok:true});}
  if(init?.method==='DELETE'){revoked=true;return reply({ok:true});}
  if(url.endsWith('/members'))return reply({members:[{id:'u1',email:'member@example.test',role}]});
  if(url.endsWith('/join-requests'))return reply({requests:approved?[]:[{id:'r1',email:'applicant@example.test',message:'Bonjour',status:'pending'}]});
  return reply({invites:revoked?[]:[{id:'i1',email:'invited@example.test',role:'viewer',status:'pending'}]});
 });vi.stubGlobal('fetch',fetch);return fetch;
}
describe('embedded workspace access panel',()=>{
 it('loads actual API data, changes member roles, approves requests and revokes invitations',async()=>{
  const fetch=mockAccess();const handle=mountWorkspaceMembers(document.body,{client:new CloudClient(),slug:'team'});await loaded('member@example.test');expect(document.querySelector('table th')?.textContent).toBe('Utilisateur');expect(document.querySelectorAll('table tbody tr')).toHaveLength(1);expect(document.querySelector('[role=tab]:nth-child(3)')?.textContent).toContain('Invitations 1');
  await choose('Rôle de member@example.test',WORKSPACE_ROLES.viewer);await vi.waitFor(()=>expect(fetch.mock.calls.some(([,init])=>init?.method==='PATCH')).toBe(true));await vi.waitFor(()=>expect(document.querySelector('button:disabled')).toBeNull());
  document.querySelector<HTMLButtonElement>('[role=tab]:nth-child(2)')!.click();await loaded('applicant@example.test');await choose('Accès pour applicant@example.test',WORKSPACE_ROLES.viewer);click('Accepter');await loaded('Aucune demande en attente.');
  document.querySelector<HTMLButtonElement>('[role=tab]:nth-child(3)')!.click();await loaded('invited@example.test');click('Révoquer');await loaded('Aucune invitation en attente.');handle.destroy();
 });
 it('keeps API failures visible without discarding the current access list',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>init?.method==='DELETE'?reply({error:'Keep at least one administrator'},409):url.endsWith('/members')?reply({members:[{id:'u1',email:'admin@example.test',role:'admin'}]}):url.endsWith('/invites')?reply({invites:[]}):reply({requests:[]})));
  const handle=mountWorkspaceMembers(document.body,{client:new CloudClient(),slug:'team'});await loaded('admin@example.test');document.querySelector<HTMLButtonElement>('[data-cloud-member-menu]')!.click();await vi.waitFor(()=>expect([...document.querySelectorAll('[role=menuitem]')].some(item=>item.textContent?.includes('Retirer de l’espace'))).toBe(true));[...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find(item=>item.textContent?.includes('Retirer de l’espace'))!.click();await loaded('Keep at least one administrator');expect(document.body.textContent).toContain('admin@example.test');handle.destroy();
 });
 it('does not render a late response after the settings tab was destroyed',async()=>{
  const releases:((value:Response)=>void)[]=[];const signals:AbortSignal[]=[];vi.stubGlobal('fetch',vi.fn((_url:string,init:RequestInit)=>{signals.push(init.signal!);return new Promise<Response>(resolve=>{releases.push(resolve);});}));
  const host=document.createElement('div');document.body.append(host);const handle=mountWorkspaceMembers(host,{client:new CloudClient(),slug:'team'});await vi.waitFor(()=>expect(releases).toHaveLength(3));handle.destroy();expect(signals.every(signal=>signal.aborted)).toBe(true);for(const release of releases)release(reply({members:[],requests:[],invites:[]}));await Promise.resolve();await Promise.resolve();expect(host.children).toHaveLength(0);
 });
});
describe('compact workspace invitation dialog',()=>{
 it('autofocuses email and restores the opener when cancelled',async()=>{
  const opener=document.createElement('button');document.body.append(opener);opener.focus();const handle=openWorkspaceInvitation({client:new CloudClient(),slug:'team'});await vi.waitFor(()=>expect(document.activeElement?.tagName).toBe('INPUT'));click('Annuler');expect(document.querySelector('[data-cloud-invite-dialog]')).toBeNull();expect(document.activeElement).toBe(opener);handle.close();
 });
 it('uses the shared role menu and Escape dismisses that menu before its invitation',async()=>{
  const handle=openWorkspaceInvitation({client:new CloudClient(),slug:'team'});const trigger=document.querySelector<HTMLButtonElement>('[data-desktop-choice]')!;
  expect(document.querySelector('select')).toBeNull();expect(document.querySelector('input')?.getAttribute('data-blok-field')).toBe('text');expect(document.querySelector('textarea')?.getAttribute('data-blok-field')).toBe('text');
  trigger.click();await vi.waitFor(()=>expect(document.querySelector('[data-desktop-choice-popover] [role=menuitemradio][aria-checked=true]')?.textContent).toContain(WORKSPACE_ROLES.member));
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await vi.waitFor(()=>expect(trigger.getAttribute('aria-expanded')).toBe('false'));expect(document.querySelector('[data-cloud-invite-dialog]')).toBeTruthy();expect(document.activeElement).toBe(trigger);handle.close();
 });
 it('sends normalized unique addresses with role/message and closes after success',async()=>{
  const fetch=vi.fn(async()=>reply({ok:true}));vi.stubGlobal('fetch',fetch);const done=vi.fn();openWorkspaceInvitation({client:new CloudClient(),slug:'team',onComplete:done});const email=document.querySelector<HTMLInputElement>('input')!;email.value='ALICE@example.test, bob@example.test, alice@example.test';await choose('Accès à l’espace',WORKSPACE_ROLES.viewer);document.querySelector<HTMLTextAreaElement>('textarea')!.value='Bienvenue !';submit();await vi.waitFor(()=>expect(document.querySelector('[data-cloud-invite-dialog]')).toBeNull());expect(fetch).toHaveBeenCalledTimes(2);expect(JSON.parse((fetch.mock.calls as unknown as [string,RequestInit][])[0][1].body as string)).toEqual({email:'alice@example.test',role:'viewer',message:'Bienvenue !'});expect(done).toHaveBeenCalledOnce();
 });
 it('retains only failed addresses after partial success and retries only those',async()=>{
  let fail=true;const sent:string[]=[];vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{const email=JSON.parse(init.body as string).email;sent.push(email);return email==='bob@example.test'&&fail?reply({error:'Delivery unavailable'},503):reply({ok:true});}));openWorkspaceInvitation({client:new CloudClient(),slug:'team'});document.querySelector<HTMLInputElement>('input')!.value='alice@example.test,bob@example.test';submit();await loaded('Delivery unavailable');expect(document.querySelector<HTMLInputElement>('input')!.value).toBe('bob@example.test');expect(document.querySelector('[role=status]')?.textContent).toContain('1 invitation envoyée');fail=false;submit();await vi.waitFor(()=>expect(document.querySelector('[data-cloud-invite-dialog]')).toBeNull());expect(sent).toEqual(['alice@example.test','bob@example.test','bob@example.test']);
 });
 it('validates the full address list before sending anything',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const handle=openWorkspaceInvitation({client:new CloudClient(),slug:'team'});document.querySelector<HTMLInputElement>('input')!.value='alice@example.test,invalid@bad@email.test';submit();await loaded('adresses e-mail valides');expect(fetch).not.toHaveBeenCalled();handle.close();
 });
 it('keeps the parent settings dialog open when Escape closes its child',async()=>{
  const parent=document.createElement('div');const trigger=document.createElement('button');trigger.textContent='Inviter';parent.append(trigger);let parentDismissed=false;const parentHandle=openModalDialog({content:parent,label:'Réglages',onDismiss:()=>{parentDismissed=true;parentHandle.close();}});await vi.waitFor(()=>expect(document.activeElement).toBe(trigger));openWorkspaceInvitation({client:new CloudClient(),slug:'team',container:parent});await vi.waitFor(()=>expect(document.activeElement?.tagName).toBe('INPUT'));document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await vi.waitFor(()=>expect(document.querySelector('[data-cloud-invite-dialog]')).toBeNull());expect(parentDismissed).toBe(false);expect(parent.isConnected).toBe(true);expect(document.activeElement).toBe(trigger);parentHandle.close();
 });
});
