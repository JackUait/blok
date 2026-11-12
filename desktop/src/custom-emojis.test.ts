import {afterEach, describe, expect, it, vi} from 'vitest';
import {customEmojiStore, readEmojiImage} from './custom-emojis';
import {mountCustomEmojiSettings} from './custom-emoji-settings';
import type {RemoteWorkspace} from './workspace-registry';
const team:RemoteWorkspace={kind:'remote',id:'team',name:'Team',workspaceId:'team',server:'https://cloud.test',accountId:'me',role:'member'};
const png='data:image/png;base64,aGVsbG8=';
afterEach(()=>{localStorage.clear();document.body.replaceChildren();vi.unstubAllGlobals();});
describe('workspace custom emoji persistence',()=>{
 it('isolates local libraries and persists uploads and deletion',async()=>{
  const first=customEmojiStore({kind:'local',id:'first',name:'First'});const second=customEmojiStore({kind:'local',id:'second',name:'Second'});
  await first.create('team_logo',png);expect(await second.list()).toEqual([]);const [item]=await first.list();expect(item.url).toBe(png);expect(item.name).toBe('team_logo');await expect(first.create('TEAM_LOGO',png)).rejects.toThrow('déjà utilisé');await first.remove(item.id);expect(await first.list()).toEqual([]);
 });
 it('uses workspace endpoints and canonicalizes relative private image URLs',async()=>{
  const request=vi.fn(async(_path:string,init?:RequestInit)=>init?.method?{ok:true}:{emojis:[{id:'logo',name:'logo',url:'/files/team/logo.png',createdBy:'me'}]});
  const store=customEmojiStore(team,{request} as never);expect((await store.list())[0].url).toBe('https://cloud.test/files/team/logo.png');await store.create('logo',png);await store.remove('logo');expect(request.mock.calls.map(([path])=>path)).toEqual(['/api/workspaces/team/emojis','/api/workspaces/team/emojis','/api/workspaces/team/emojis/logo']);expect(JSON.parse(request.mock.calls[1][1]!.body as string)).toEqual({name:'logo',dataUrl:png});
 });
 it('rejects unsafe image formats and oversized images before reading',async()=>{
  await expect(readEmojiImage(new File(['svg'],'evil.svg',{type:'image/svg+xml'}))).rejects.toThrow('PNG');await expect(readEmojiImage(new File([new Uint8Array(2*1024*1024+1)],'large.png',{type:'image/png'}))).rejects.toThrow('2 Mo');
 });
 it('lists emojis for viewers without upload or deletion actions',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({emojis:[{id:'logo',name:'logo',url:'/files/logo.png',createdBy:'me'}]})})));
  const handle=mountCustomEmojiSettings(document.body,{...team,role:'viewer'});await vi.waitFor(()=>expect(document.body.textContent).toContain(':logo:'));expect(document.querySelector('[data-custom-emoji-tools] button')).toBeNull();expect(document.querySelector('[aria-label="Supprimer logo"]')).toBeNull();handle.destroy();
 });
 it('allows members to delete only their own emojis and displays API errors',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(_url:string,init?:RequestInit)=>({ok:init?.method!=='DELETE',status:init?.method==='DELETE'?403:200,json:async()=>init?.method==='DELETE'?{error:'Suppression refusée'}:{emojis:[{id:'mine',name:'mine',url:'/files/mine.png',createdBy:'me'},{id:'other',name:'other',url:'/files/other.png',createdBy:'someone'}]}})));
  const handle=mountCustomEmojiSettings(document.body,team);await vi.waitFor(()=>expect(document.querySelector('[aria-label="Supprimer mine"]')).toBeTruthy());expect(document.querySelector('[aria-label="Supprimer other"]')).toBeNull();document.querySelector<HTMLButtonElement>('[aria-label="Supprimer mine"]')!.click();await vi.waitFor(()=>expect(document.querySelector('[role=alert]')?.textContent).toBe('Suppression refusée'));expect(document.body.textContent).toContain(':mine:');handle.destroy();
 });
});
