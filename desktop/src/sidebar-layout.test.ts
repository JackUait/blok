import { describe, expect, it } from 'vitest';
import {defaultSidebarLayout, normalizeSidebarLayout} from '../../src/shell/sidebar-layout';
describe('sidebar layout persistence boundary',()=>{
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
