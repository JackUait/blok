import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {readSidebarLayout, saveSidebarLayout, subscribeSidebarLayout, initializeSidebarPresets} from './sidebar-preferences';
import {defaultSidebarLayout} from '../../src/shell/sidebar-layout';
import {workspaceKey} from './workspace-registry';
import type {RemoteWorkspace} from './workspace-registry';
import type {CloudClient} from './cloud/client';
const ref: RemoteWorkspace = {kind:'remote',id:'x',name:'Test',server:'https://example.com',workspaceId:'space',accountId:'one'};
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();});
afterEach(()=>vi.restoreAllMocks());
describe('personal sidebar preferences',()=>{
  it('isolates accounts and broadcasts changes only to the matching workspace',()=>{
    const callback=vi.fn(); const other=vi.fn(); const stop=subscribeSidebarLayout(ref,callback); const stopOther=subscribeSidebarLayout({...ref,accountId:'two'},other);
    const layout=defaultSidebarLayout();layout.tabs[0].name='Mon accueil';saveSidebarLayout(ref,layout);
    expect(readSidebarLayout({...ref,accountId:'two'}).tabs[0].name).toBe('Accueil');expect(callback).toHaveBeenCalledOnce();expect(other).not.toHaveBeenCalled();stop();stopOther();
  });
  it('refreshes from another window and stops listening on destroy',()=>{
    const callback=vi.fn();const stop=subscribeSidebarLayout(ref,callback);
    const storageKey=`blok:desktop:sidebar:v1:${workspaceKey(ref)}`;const layout=defaultSidebarLayout();layout.tabs[0].name='Autre fenêtre';localStorage.setItem(storageKey,JSON.stringify(layout));
    window.dispatchEvent(new StorageEvent('storage',{key:storageKey}));expect(callback).toHaveBeenCalledWith(expect.objectContaining({tabs:expect.arrayContaining([expect.objectContaining({name:'Autre fenêtre'})])}));
    stop();window.dispatchEvent(new StorageEvent('storage',{key:storageKey}));expect(callback).toHaveBeenCalledOnce();
  });
  it('does not overwrite changes made while default presets load',async()=>{
    let resolve: (value:unknown)=>void=()=>{};
    const client={request:vi.fn(()=>new Promise(r=>{resolve=r;}))} as unknown as CloudClient;
    const pending=initializeSidebarPresets(ref,client); const layout=defaultSidebarLayout();layout.tabs[0].name='Personnel';saveSidebarLayout(ref,layout);
    resolve({presets:[{id:'p',name:'Équipe',default:true,tab:defaultSidebarLayout().tabs[0]}]});await pending;
    expect(readSidebarLayout(ref).tabs[0].name).toBe('Personnel');
  });
});
