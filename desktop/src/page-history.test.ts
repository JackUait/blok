import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {createPageHistory} from './page-history';
import type {HistoryPoint, PageHistoryApi} from './page-history-api';

const point = (sequence: number) => ({lineage:'epoch',sequence,startedAt:1731772800000,savedAt:1731772860000+sequence*60000,actors:['me']});
const data = (text: string) => ({blocks:[{id:'text',type:'paragraph',data:{text}}],page:{title:'Mon document'}});
function fixture() {
  const api: PageHistoryApi = {
    list:vi.fn(async ()=>({lineages:[{lineage:'epoch',current:true}],versions:[point(3),point(2),point(1)]})),
    read:vi.fn(async (p: HistoryPoint)=>data(`Version ${p.sequence}`)),
    preview:vi.fn(async ()=>({expectRevision:'epoch:3',wouldUndo:{blocks:[{id:'text',type:'paragraph',kind:'changed'}],page:[]},guards:[],fits:true,frameBytes:10,limitBytes:100})),
    restore:vi.fn(async ()=>undefined),
  };
  const restored=vi.fn();
  const history=createPageHistory({api,title:()=> 'Mon document',actorName:id=>id==='me'?'Jocelin':id,canRestore:()=>true,onRestored:restored});
  document.body.append(history.element);
  return {api,history,restored};
}
function button(text: string) {
  const found=[...document.querySelectorAll('button')].find(node=>node.textContent===text);
  if (!found) throw new Error(`Missing button ${text}`);
  return found;
}
const dialogShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const dialogClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
const scrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
beforeEach(()=>{
  vi.clearAllMocks();
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:vi.fn(function(this: HTMLDialogElement){this.open=true;})});
  Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:vi.fn(function(this: HTMLDialogElement){this.open=false;})});
  Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:vi.fn()});
});
afterEach(()=>{
  document.body.replaceChildren();vi.restoreAllMocks();
  if(dialogShowModal) Object.defineProperty(HTMLDialogElement.prototype,'showModal',dialogShowModal);
  else Reflect.deleteProperty(HTMLDialogElement.prototype,'showModal');
  if(dialogClose) Object.defineProperty(HTMLDialogElement.prototype,'close',dialogClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype,'close');
  if(scrollIntoView) Object.defineProperty(HTMLElement.prototype,'scrollIntoView',scrollIntoView);
  else Reflect.deleteProperty(HTMLElement.prototype,'scrollIntoView');
});
it('loads lazily, previews read only, marks changes and restores only after reviewing consequences',async ()=>{
  const {api,history,restored}=fixture();
  expect(api.list).not.toHaveBeenCalled();
  await history.open();
  expect(document.body.textContent).toContain('Version actuelle');
  expect(api.read).toHaveBeenCalledTimes(2);
  document.querySelector<HTMLButtonElement>('[data-history-version="epoch:2"]')?.click();
  await vi.waitFor(()=>expect(document.querySelector('[data-history-render]')?.textContent).toContain('Version 2'));
  expect(document.querySelector('[data-history-change="changed"]')).not.toBeNull();
  expect(document.querySelector('[contenteditable="true"]')).toBeNull();
  button('Restaurer cette version').click();
  await vi.waitFor(()=>expect(document.body.textContent).toContain('1 bloc'));
  expect(api.restore).not.toHaveBeenCalled();
  button('Confirmer la restauration').click();
  await vi.waitFor(()=>expect(restored).toHaveBeenCalledOnce());
  expect(api.restore).toHaveBeenCalledWith(point(2),expect.objectContaining({expectRevision:'epoch:3'}),expect.any(String));
  history.destroy();
});
it('ignores a slow old preview after selecting a newer version and after closing',async ()=>{
  const {api,history}=fixture(); await history.open();
  const slow: {resolve?: (value:ReturnType<typeof data>)=>void}={};
  vi.mocked(api.read).mockImplementation(p=>p.sequence===2?new Promise(resolve=>{slow.resolve=resolve;}):Promise.resolve(data(`Version ${p.sequence}`)));
  document.querySelector<HTMLButtonElement>('[data-history-version="epoch:2"]')?.click();
  document.querySelector<HTMLButtonElement>('[data-history-version="epoch:1"]')?.click();
  await vi.waitFor(()=>expect(document.querySelector('[data-history-render]')?.textContent).toContain('Version 1'));
  slow.resolve?.(data('OLD RESULT')); await Promise.resolve();
  expect(document.body.textContent).not.toContain('OLD RESULT');
  history.close(); expect(history.element.open).toBe(false); history.destroy();
});
it('shows server refusal and empty history without suggesting a restore',async ()=>{
  const {api,history}=fixture();
  vi.mocked(api.list).mockRejectedValueOnce(new Error('Vous n’avez pas accès à cet historique.'));
  await history.open(); expect(document.body.textContent).toContain('pas accès');
  expect(document.querySelector('[data-history-restore]')?.hasAttribute('disabled')).toBe(true);
  history.close(); vi.mocked(api.list).mockResolvedValueOnce({lineages:[],versions:[]});
  await history.open();expect(document.body.textContent).toContain('Aucune version');history.destroy();
});
it('blocks an unsupported restore guard and reports stale confirmation without writing again',async ()=>{
  const {api,history}=fixture();await history.open();
  document.querySelector<HTMLButtonElement>('[data-history-version="epoch:2"]')?.click();
  await vi.waitFor(()=>expect(document.querySelector('[data-history-render]')?.textContent).toContain('Version 2'));
  vi.mocked(api.preview).mockResolvedValueOnce({expectRevision:'epoch:3',wouldUndo:{blocks:[],page:[]},guards:[{kind:'futureGuard',blockId:'d'}],fits:true,frameBytes:10,limitBytes:100});
  button('Restaurer cette version').click();await vi.waitFor(()=>expect(button('Confirmer la restauration').disabled).toBe(true));
  expect(api.restore).not.toHaveBeenCalled();button('Annuler').click();
  vi.mocked(api.restore).mockRejectedValueOnce(new Error('La page a changé. Vérifiez de nouveau la restauration.'));
  button('Restaurer cette version').click();await vi.waitFor(()=>expect(button('Confirmer la restauration').disabled).toBe(false));
  button('Confirmer la restauration').click();await vi.waitFor(()=>expect(document.body.textContent).toContain('La page a changé'));
  expect(api.restore).toHaveBeenCalledOnce();history.destroy();
});

it('waits for local changes to synchronize before allowing restore and rechecks before confirmation',async ()=>{
  const api: PageHistoryApi={list:async()=>({lineages:[{lineage:'epoch',current:true}],versions:[point(3),point(2)]}),read:async p=>data(`Version ${p.sequence}`),preview:vi.fn(),restore:vi.fn()};
  const state={synced:false};
  const history=createPageHistory({api,title:()=> 'Page',actorName:()=> 'Jocelin',canRestore:()=>state.synced,onRestored:vi.fn()});
  await history.open();document.querySelector<HTMLButtonElement>('[data-history-version="epoch:2"]')?.click();
  await vi.waitFor(()=>expect(document.querySelector('[data-history-render]')?.textContent).toContain('Version 2'));
  expect(button('Restaurer cette version').disabled).toBe(true);
  state.synced=true;history.refreshAccess();expect(button('Restaurer cette version').disabled).toBe(false);
  state.synced=false;button('Restaurer cette version').click();expect(api.preview).not.toHaveBeenCalled();history.destroy();
});
