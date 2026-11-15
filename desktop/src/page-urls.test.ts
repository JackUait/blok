import {afterEach,describe,expect,it,vi} from 'vitest';
import {pageDestination,publicPageUrl,resolvePageDestination,workspaceSwitchUrl,rememberPageLinks,pageIdForHref,copiedPageLink} from './page-urls';
import type {CloudSession} from './cloud/client';
const uuid='2a7aee31-f541-41e8-9190-6eae552291b8';
const workspace={id:'ws',slug:'new-workspace',name:'New name',role:'member' as const};
const session:CloudSession={user:{id:'user',email:'user@example.org'},workspaces:[workspace]};
afterEach(()=>rememberPageLinks(location.origin,location.origin,[]));
describe('stable public page URLs',()=>{
 it('parses the UUID independently of title and keeps legacy internal IDs intact',()=>{
  expect(pageDestination(`https://example.org/p/ancien-titre-${uuid}`)).toEqual({kind:'public',id:uuid});
  expect(pageDestination('https://example.org/?page=welcome-original-workspace')).toEqual({kind:'legacy',id:'welcome-original-workspace'});
  expect(pageDestination('https://example.org/p/page-inconnue')).toEqual({kind:'invalid'});
  expect(publicPageUrl('https://example.org','Équipe / Été 👩🏽‍💻',uuid)).toBe(`https://example.org/p/equipe-ete-${uuid}`);
 });
 it('resolves old page/workspace names through the authenticated identity, never through slug guesses',async()=>{
  const request=vi.fn(async(_path:string)=>({pageId:'welcome-original-workspace',publicId:uuid,title:'Titre renommé',workspace,teamspaceId:null}));
  const result=await resolvePageDestination({request} as Parameters<typeof resolvePageDestination>[0],'https://example.org/?page=welcome-original-workspace',session);
  expect(request).toHaveBeenCalledExactlyOnceWith('/api/pages/resolve-id/welcome-original-workspace');
  expect(publicPageUrl('https://example.org',result.title,result.publicId)).toBe(`https://example.org/p/titre-renomme-${uuid}`);
  await resolvePageDestination({request} as Parameters<typeof resolvePageDestination>[0],`https://example.org/p/ancien-titre-${uuid}`,session);
  expect(request).toHaveBeenLastCalledWith(`/api/pages/resolve/${uuid}`);
 });
 it('does not open any fallback workspace for unavailable or foreign-membership pages',async()=>{
  const request=vi.fn(async()=>({pageId:'private',publicId:uuid,title:'Private',workspace:{...workspace,id:'other'},teamspaceId:null}));
  await expect(resolvePageDestination({request} as Parameters<typeof resolvePageDestination>[0],`https://example.org/p/page-${uuid}`,session)).rejects.toThrow('Page indisponible');
  request.mockRejectedValue(new Error('Not found'));
  await expect(resolvePageDestination({request} as Parameters<typeof resolvePageDestination>[0],`https://example.org/p/page-${uuid}`,session)).rejects.toThrow('Not found');
 });
 it('preserves a destination across login, but a deliberate workspace switch discards it',()=>{
  const href=`https://example.org/p/ancien-${uuid}?cloud=1&server=https://example.org`;
  expect(workspaceSwitchUrl(href,false,true)).toBe(`https://example.org/p/ancien-${uuid}`);
  expect(workspaceSwitchUrl(href,false)).toBe('https://example.org/');
  expect(workspaceSwitchUrl('https://example.org/?page=secret&cloud=1',true)).toBe('https://example.org/?local=1');
 });
 it('keeps copies and tab icons tied to the same page across renamed title routes, and isolates origins',()=>{
  rememberPageLinks(location.origin,'https://example.org',[{id:'internal',title:'New title',publicId:uuid}]);
  expect(pageIdForHref(`${location.origin}/p/old-title-${uuid}`)).toBe('internal');
  expect(copiedPageLink(`${location.origin}/?page=internal`)).toBe(`https://example.org/p/new-title-${uuid}`);
  expect(pageIdForHref(`https://other.example.org/p/old-title-${uuid}`)).toBeNull();
  rememberPageLinks(location.origin,'https://example.org',[]);
  expect(pageIdForHref(`${location.origin}/p/old-title-${uuid}`)).toBeNull();
  expect(copiedPageLink(`${location.origin}/?page=internal`)).toBe('blok://page/internal');
 });
});
