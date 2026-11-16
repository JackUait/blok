import {defaultSidebarLayout, normalizeSidebarLayout, normalizeSidebarTab, type SidebarLayout, type SidebarPreset} from '../../src/shell/sidebar-layout';
import {workspaceKey, type WorkspaceRef} from './workspace-registry';
import type {CloudClient} from './cloud/client';
const EVENT = 'blok:desktop-sidebar-layout';
const key = (ref:WorkspaceRef):string => `blok:desktop:sidebar:v1:${workspaceKey(ref)}`;
export function readSidebarLayout(ref:WorkspaceRef):SidebarLayout {
  try {return normalizeSidebarLayout(JSON.parse(localStorage.getItem(key(ref)) ?? 'null'));} catch {return defaultSidebarLayout();}
}
export function saveSidebarLayout(ref:WorkspaceRef,layout:SidebarLayout):void {
  const value=normalizeSidebarLayout(layout);
  localStorage.setItem(key(ref),JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(EVENT,{detail:{key:key(ref),layout:value}}));
}
export function subscribeSidebarLayout(ref:WorkspaceRef,callback:(layout:SidebarLayout)=>void):()=>void {
  const changed=(event:Event):void=>{if((event as CustomEvent<{key:string}>).detail?.key===key(ref))callback(readSidebarLayout(ref));};
  const storage=(event:StorageEvent):void=>{if(event.key===key(ref)||event.key===null)callback(readSidebarLayout(ref));};
  window.addEventListener(EVENT,changed);window.addEventListener('storage',storage);
  return ()=>{window.removeEventListener(EVENT,changed);window.removeEventListener('storage',storage);};
}
export async function initializeSidebarPresets(ref:WorkspaceRef,client:CloudClient):Promise<void> {
  if(ref.kind!=='remote'||localStorage.getItem(key(ref))!==null)return;
  const result=await client.request<{presets:SidebarPreset[]}>(`/api/workspaces/${encodeURIComponent(ref.workspaceId)}/sidebar-presets`);
  if(localStorage.getItem(key(ref))!==null)return;
  const tabs=result.presets.filter(preset=>preset.default).map(preset=>normalizeSidebarTab({...preset.tab,id:`preset:${preset.id}`,presetId:preset.id})).filter((tab):tab is NonNullable<typeof tab>=>tab!==null).slice(0,6);
  if(tabs.length)saveSidebarLayout(ref,{...defaultSidebarLayout(),tabs,activeTabId:tabs[0].id});
}
