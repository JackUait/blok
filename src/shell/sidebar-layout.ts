/** Personal navigation layout; it never grants access to a page. */
export type SidebarIcon = 'home' | 'message' | 'calendar' | 'book' | 'people';
export interface SidebarShortcut { id: string; kind: 'new-page' | 'new-note' | 'library' | 'assistant' | 'page'; pageId?: string; visible: boolean }
export interface SidebarSection { id: 'recents' | 'favorites' | 'teamspaces' | 'shared' | 'private'; visible: boolean; limit: number; sort: 'manual' | 'updated' }
export interface SidebarTab { id: string; name: string; icon: SidebarIcon; shortcuts: SidebarShortcut[]; sections: SidebarSection[]; presetId?: string }
export interface SidebarLayout { version: 1; activeTabId: string; tabs: SidebarTab[]; width: number; collapsed: boolean }
export interface SidebarPreset { id: string; name: string; default: boolean; tab: SidebarTab }
const sections: SidebarSection[] = ['recents','favorites','private','shared','teamspaces'].map(id => ({id: id as SidebarSection['id'], visible: true, limit: 5, sort: 'manual'}));
const shortcut = (kind: SidebarShortcut['kind']): SidebarShortcut => ({id: kind, kind, visible: true});
export function defaultSidebarLayout(): SidebarLayout {
  return {version:1,activeTabId:'home',width:260,collapsed:false,tabs:[
    {id:'home',name:'Accueil',icon:'home',shortcuts:['new-page','assistant','library'].map(kind=>shortcut(kind as SidebarShortcut['kind'])),sections:structuredClone(sections)},
    {id:'chat',name:'Chat',icon:'message',shortcuts:[shortcut('assistant'),shortcut('library')],sections:structuredClone(sections).map(section=>({...section,visible:section.id==='favorites'||section.id==='recents'}))},
    {id:'notes',name:'Notes',icon:'book',shortcuts:[shortcut('new-note'),shortcut('new-page'),shortcut('library')],sections:structuredClone(sections).map(section=>({...section,visible:section.id==='private'||section.id==='recents'}))},
  ]};
}
export function normalizeSidebarTab(value: unknown): SidebarTab | null {
  if (!value || typeof value !== 'object') return null;
  const v=value as Partial<SidebarTab>;
  if(typeof v.id!=='string'||!v.id||typeof v.name!=='string'||!v.name.trim())return null;
  const shortcuts: SidebarShortcut[]=[];const seen=new Set<string>();
  for(const item of Array.isArray(v.shortcuts)?v.shortcuts:[]){
    if(!item||typeof item.id!=='string'||seen.has(item.id)||!['new-page','new-note','library','assistant','page'].includes(item.kind))continue;
    if(item.kind==='page'&&(typeof item.pageId!=='string'||!item.pageId))continue;
    seen.add(item.id);shortcuts.push({id:item.id,kind:item.kind,visible:item.visible!==false,...(item.kind==='page'?{pageId:item.pageId}:{})});if(shortcuts.length===25)break;
  }
  const normalizedSections: SidebarSection[]=[];seen.clear();
  for(const item of Array.isArray(v.sections)?v.sections:[]){
    if(!item||seen.has(item.id)||!sections.some(section=>section.id===item.id))continue;
    seen.add(item.id);normalizedSections.push({id:item.id,visible:item.visible!==false,limit:[0,5,10,20,50].includes(item.limit)?item.limit:5,sort:item.sort==='updated'?'updated':'manual'});
  }
  for(const item of sections)if(!seen.has(item.id))normalizedSections.push({...item});
  return {id:v.id.slice(0,120),name:v.name.trim().slice(0,40),icon:['home','message','calendar','book','people'].includes(v.icon??'')?v.icon!:'home',shortcuts,sections:normalizedSections,...(typeof v.presetId==='string'?{presetId:v.presetId}:{})};
}
export function normalizeSidebarLayout(value: unknown): SidebarLayout {
  const fallback=defaultSidebarLayout();if(!value||typeof value!=='object')return fallback;
  const v=value as Partial<SidebarLayout>;if(v.version!==1)return fallback;
  const seen=new Set<string>();const tabs=(Array.isArray(v.tabs)?v.tabs:[]).map(normalizeSidebarTab).filter((tab):tab is SidebarTab=>{if(!tab||seen.has(tab.id))return false;seen.add(tab.id);return true;}).slice(0,6);
  if(!tabs.length)return fallback;
  return {version:1,tabs,activeTabId:tabs.some(tab=>tab.id===v.activeTabId)?v.activeTabId!:tabs[0].id,width:typeof v.width==='number'&&Number.isFinite(v.width)?Math.max(220,Math.min(420,v.width)):260,collapsed:v.collapsed===true};
}
