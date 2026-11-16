import { describe, expect, it } from 'vitest';
import {defaultSidebarLayout, normalizeSidebarLayout} from '../../src/shell/sidebar-layout';
describe('sidebar layout persistence boundary',()=>{
  it('starts with Home and Chat, with no placeholder Notes or Calendar tab',()=>{
    expect(defaultSidebarLayout().tabs.map(tab=>tab.name)).toEqual(['Home','Chat']);
  });
  it('migrates only the old built-in Notes tab and preserves customized tabs',()=>{
    const home=defaultSidebarLayout().tabs[0];
    const notes={id:'notes',name:'Notes',icon:'book',shortcuts:['new-note','new-page','library'].map(kind=>({id:kind,kind,visible:true})),sections:home.sections.map(section=>({...section,visible:section.id==='private'||section.id==='recents'}))};
    const legacy={...defaultSidebarLayout(),version:1,activeTabId:'notes',tabs:[{...home,name:'Accueil'},notes]};
    const migrated=normalizeSidebarLayout(legacy);
    expect(migrated.tabs.map(tab=>tab.name)).toEqual(['Home']);
    expect(migrated.activeTabId).toBe('home');
    expect(normalizeSidebarLayout({...legacy,tabs:[home,{...notes,name:'Mon journal'}]}).tabs[1].name).toBe('Mon journal');
    expect(normalizeSidebarLayout({...legacy,tabs:[home,{...notes,presetId:'team-notes'}]}).tabs).toHaveLength(2);
  });
  it('persists the new Lucide choices instead of replacing them with Home',()=>{
    const layout=defaultSidebarLayout();
    expect(normalizeSidebarLayout({...layout,tabs:[{...layout.tabs[0],icon:'rocket'}]}).tabs[0].icon).toBe('rocket');
  });
  it('recovers broken storage and never leaves navigation without a tab',()=>{
    expect(normalizeSidebarLayout(null)).toEqual(defaultSidebarLayout());
    expect(normalizeSidebarLayout({version:1,tabs:[]} ).tabs.length).toBeGreaterThan(0);
  });
  it('keeps separate per-tab visibility and page shortcuts without changing defaults',()=>{
    const layout=defaultSidebarLayout();
    layout.tabs[0].sections[0].visible=false;
    layout.tabs[0].shortcuts.push({id:'project',kind:'page',pageId:'p1',visible:true});
    const restored=normalizeSidebarLayout(JSON.parse(JSON.stringify(layout)));
    expect(restored.tabs[0].sections[0].visible).toBe(false);
    expect(restored.tabs[0].shortcuts.at(-1)?.pageId).toBe('p1');
    expect(defaultSidebarLayout().tabs[0].sections[0].visible).toBe(true);
  });
  it('bounds tabs, rejects duplicate identities and invalid page shortcuts, and clamps dimensions',()=>{
    const base=defaultSidebarLayout();
    base.tabs=Array.from({length:9},(_,i)=>({...base.tabs[0],id:`tab${i}`}));
    base.tabs[0].shortcuts.push({id:'broken',kind:'page',visible:true});
    base.tabs.splice(1,0,base.tabs[0]);base.activeTabId='missing';base.width=900;
    const clean=normalizeSidebarLayout(base);
    expect(clean.tabs).toHaveLength(6);
    expect(new Set(clean.tabs.map(tab=>tab.id)).size).toBe(6);
    expect(clean.tabs[0].shortcuts.some(shortcut=>shortcut.id==='broken')).toBe(false);
    expect(clean.activeTabId).toBe(clean.tabs[0].id);
    expect(clean.width).toBe(420);
  });
});
