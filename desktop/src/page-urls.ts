import type { CloudClient, CloudSession, CloudWorkspace } from './cloud/client';
export type PageDestination = {kind:'public';id:string}|{kind:'legacy';id:string}|{kind:'invalid'}|{kind:'none'};
const UUID='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const isPublicPageId=(value:string):boolean=>new RegExp(`^${UUID}$`,'i').test(value);
export function pageDestination(href:string):PageDestination {
  const url=new URL(href,location.href);
  if(url.pathname==='/p' || url.pathname.startsWith('/p/')){
    const match=new RegExp(`^/p/(?:[^/]*-)?(${UUID})/?$`,'i').exec(url.pathname);
    return match ? {kind:'public',id:match[1].toLowerCase()} : {kind:'invalid'};
  }
  if(url.searchParams.has('page')) {const id=url.searchParams.get('page');return id ? {kind:'legacy',id} : {kind:'invalid'};}
  return {kind:'none'};
}
export function publicPageUrl(server:string,title:string,publicId:string):string {
  if(!isPublicPageId(publicId))throw new Error('Identité publique de page invalide.');
  const slug=title.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,100).replace(/-$/,'') || 'page';
  return new URL(`/p/${slug}-${publicId.toLowerCase()}`,server).href;
}
export function legacyPageUrl(base:string,id:string):string {const url=new URL('/',base);url.searchParams.set('page',id);return url.href;}
export interface ResolvedPage {pageId:string;publicId:string;title:string;workspace:CloudWorkspace;teamspaceId:string|null}
export async function resolvePageDestination(client:Pick<CloudClient,'request'>,href:string,session:CloudSession):Promise<ResolvedPage> {
  const destination=pageDestination(href);
  if(destination.kind==='invalid' || destination.kind==='none')throw new Error('Page indisponible.');
  const route=destination.kind==='public' ? 'resolve' : 'resolve-id';
  const result=await client.request<ResolvedPage>(`/api/pages/${route}/${encodeURIComponent(destination.id)}`);
  if((destination.kind==='public' && result.publicId.toLowerCase()!==destination.id) || (destination.kind==='legacy' && result.pageId!==destination.id) || !isPublicPageId(result.publicId) || !session.workspaces.some(workspace=>workspace.id===result.workspace.id && workspace.slug===result.workspace.slug))throw new Error('Page indisponible.');
  return result;
}
const pageLinks=new Map<string,{id:string;publicId:string;href:string}>();
export function rememberPageLinks(origin:string,server:string,pages:{id:string;title:string;publicId?:string}[]):void {
  for(const key of pageLinks.keys())if(key.startsWith(`${origin}|`))pageLinks.delete(key);
  pages.forEach(page=>{if(page.publicId && isPublicPageId(page.publicId))pageLinks.set(`${origin}|${page.id}`,{id:page.id,publicId:page.publicId,href:publicPageUrl(server,page.title,page.publicId)});});
}
export function pageIdForHref(href:string):string|null {
  try {
    const url=new URL(href,location.href),destination=pageDestination(url.href);
    if(destination.kind==='legacy')return destination.id;
    if(destination.kind!=='public')return null;
    return [...pageLinks.entries()].find(([key,value])=>key.startsWith(`${url.origin}|`) && value.publicId===destination.id)?.[1].id ?? null;
  }catch{return null;}
}
export function copiedPageLink(href:string):string|null {
  try {
    const url=new URL(href,location.href),destination=pageDestination(url.href);
    if(destination.kind==='public')return url.href;
    if(destination.kind!=='legacy')return null;
    return pageLinks.get(`${url.origin}|${destination.id}`)?.href ?? `blok://page/${destination.id}`;
  }catch{return null;}
}
/** A voluntary switch drops the destination; only an explicit login continuation retains it. */
export function workspaceSwitchUrl(href:string,local:boolean,resumePage=false):string {
  const url=new URL(href);
  if(!resumePage){url.pathname='/';url.searchParams.delete('page');url.hash='';}
  for(const key of ['cloud','manage','section','server'])url.searchParams.delete(key);
  if(local)url.searchParams.set('local','1');else url.searchParams.delete('local');
  return url.href;
}
