import type * as CloudModule from './cloud';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const ui=vi.hoisted(()=>({mount:vi.fn(),gateway:vi.fn(async()=>undefined)}));
vi.mock('./react-grab',()=>({reactGrabAvailable:false,loadReactGrab:vi.fn()}));
vi.mock('./shell',()=>({mountDesktop:ui.mount,flushDesktop:vi.fn(async()=>undefined)}));
vi.mock('./cloud',async original=>({...await original<typeof CloudModule>(),mountCloudGateway:ui.gateway}));
const uuid='2a7aee31-f541-41e8-9190-6eae552291b8';
const workspace={id:'destination-ws',slug:'renamed-workspace',name:'Renamed Workspace',role:'member',icon:'🌱'};
let status=200;
function isSession(url:RequestInfo|URL):boolean {if(typeof url==='string')return url.endsWith('/api/session');if(url instanceof URL)return url.href.endsWith('/api/session');return url.url.endsWith('/api/session');}
function stub(){vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
 if(url.endsWith('/api/session'))return new Response(JSON.stringify({user:{id:'user',email:'user@example.org'},workspaces:[workspace]}),{status});
 if(url.includes('/api/pages/resolve'))return new Response(JSON.stringify(status===404 ? {error:'Not found'} : {pageId:'welcome-old-workspace',publicId:uuid,title:'Nouveau titre',workspace,teamspaceId:null}),{status:status===404 ? 404 : 200});
 return new Response('{}',{status:404});
}));}
beforeEach(()=>{vi.resetModules();vi.clearAllMocks();localStorage.clear();sessionStorage.clear();document.body.innerHTML='<div id="app"></div>';status=200;});
afterEach(()=>{vi.unstubAllGlobals();history.replaceState(null,'','/');});
describe('page destination before workspace mount',()=>{
 it('resolves and activates the authorized target before mounting, even when the saved selection was local',async()=>{
  history.replaceState(null,'',`/p/old-name-${uuid}`);stub();await import('./main');await vi.waitFor(()=>expect(ui.mount).toHaveBeenCalledOnce());
  expect(location.pathname).toBe(`/p/nouveau-titre-${uuid}`);
  const {activeWorkspace}=await import('./workspace-registry');expect(activeWorkspace()).toMatchObject({kind:'remote',workspaceId:'renamed-workspace',accountId:'user'});
 });
 it('does not mount a different page when resolution fails',async()=>{
  history.replaceState(null,'',`/p/unknown-${uuid}`);stub();const fetch=vi.mocked(globalThis.fetch);fetch.mockImplementation(async(url)=>new Response(JSON.stringify(isSession(url) ? {user:{id:'user',email:'user@example.org'},workspaces:[workspace]} : {error:'Not found'}),{status:isSession(url) ? 200 : 404}));
  await import('./main');await vi.waitFor(()=>expect(document.querySelector('[data-page-unavailable]')).not.toBeNull());expect(ui.mount).not.toHaveBeenCalled();
 });
 it('keeps the exact destination visible while requesting login',async()=>{
  history.replaceState(null,'',`/p/old-name-${uuid}`);status=401;stub();await import('./main');await vi.waitFor(()=>expect(ui.gateway).toHaveBeenCalledOnce());
  expect(location.pathname).toBe(`/p/old-name-${uuid}`);expect(ui.mount).not.toHaveBeenCalled();
 });
 it('converts a legacy named link instead of opening the saved page',async()=>{
  history.replaceState(null,'','/?page=welcome-old-workspace');stub();await import('./main');await vi.waitFor(()=>expect(ui.mount).toHaveBeenCalledOnce());expect(location.pathname).toBe(`/p/nouveau-titre-${uuid}`);expect(location.search).toBe('');
 });
});
