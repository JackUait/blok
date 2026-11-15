import {must} from './test-helpers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openAiSummary, parseSummary, summaryOutput, appendSummaryBlocks, SUMMARY_LIMIT } from './ai-summary';
import type { AgentModelRequest } from '../../types/api';
const answer=JSON.stringify({blocks:[{type:'header',text:'Synthèse',level:2},{type:'paragraph',text:'Source conservée'},{type:'list',text:'Décision à confirmer'}]});
const click=(text:string):void=>{const button=[...document.querySelectorAll('button')].find(el=>el.textContent===text);expect(button).toBeTruthy();must(button).click();};
const source=():HTMLTextAreaElement=>must(document.querySelector('textarea'));
const status=():string=>document.querySelector('[role=status]')?.textContent ?? '';
async function setup(model=vi.fn(async(_request:AgentModelRequest)=>({content:[{type:'text' as const,text:answer}],stop_reason:'end_turn' as const}))) {
 const append=vi.fn(async()=>undefined);const getSource=vi.fn(()=>({id:'page',text:'Notes privées'}));
 openAiSummary({remote:true,append,getSource,listProviders:async()=>[{id:'openai:model',label:'OpenAI · modèle configuré'}],modelFor:()=>model,openSettings:vi.fn()});
 await vi.waitFor(()=>expect(document.querySelectorAll('select option')).toHaveLength(2));
 return {append,getSource,model};
}
function choose():void{const select=must(document.querySelector('select'));select.value='openai:model';select.dispatchEvent(new Event('change'));}
afterEach(()=>{document.querySelectorAll('button').forEach(button=>{if(button.textContent==='Fermer')button.click();});document.body.replaceChildren();vi.restoreAllMocks();});
describe('structured summary contract',()=>{
 it('keeps only safe block data and escapes model HTML before insertion',()=>{
  const blocks=parseSummary('{"blocks":[{"type":"list","text":"<img src=x onerror=alert(1)> & hi","id":"forged","data":{"url":"secret"}}]}');
  expect(summaryOutput(blocks)).toEqual([{type:'list',data:{text:'&lt;img src=x onerror=alert(1)&gt; &amp; hi',style:'unordered',depth:0}}]);
 });
 it.each(['null','{}','{"blocks":[]}','{"blocks":[{"type":"database","text":"x"}]}','{"blocks":[{"type":"header","text":"x","level":1}]}','{"blocks":[{"type":"paragraph","text":""}]}','bad'])('rejects malformed or unsupported output: %s',raw=>{expect(()=>parseSummary(raw)).toThrow();});
 it('accepts a fenced JSON answer without treating it as executable markdown',()=>{expect(parseSummary('```json\n'+answer+'\n```')).toHaveLength(3);});
});
describe('summary preview workflow',()=>{
 it('requires explicit provider, sends exactly the reviewed text without chat history, and appends only after approval',async()=>{
  const {model,append}=await setup();
  expect(source().value).toBe('');click('Charger la page ouverte');await vi.waitFor(()=>expect(status()).toContain('Page chargée'));expect(source().value).toBe('Notes privées');
  click('Générer un aperçu');expect(model).not.toHaveBeenCalled();expect(status()).toContain('explicitement');
  source().value='Contenu choisi';choose();click('Générer un aperçu');
  await vi.waitFor(()=>expect(status()).toContain('Aperçu prêt'));
  expect(model.mock.calls[0][0].messages).toEqual([{role:'user',content:'Résume le contenu source suivant :\n{"source":"Contenu choisi"}'}]);
  expect(model.mock.calls[0][0].tools).toEqual([]);expect(append).not.toHaveBeenCalled();expect(source().value).toBe('Contenu choisi');
  click('Ajouter à la fin de la page');await vi.waitFor(()=>expect(append).toHaveBeenCalledOnce());
  expect(append).toHaveBeenCalledWith('page',summaryOutput(parseSummary(answer)));expect(source().value).toBe('Contenu choisi');
  await vi.waitFor(()=>expect(status()).toContain('Vérifiez l’état de sauvegarde'));
 });
 it('does not silently truncate long content or call AI while offline',async()=>{
  const {model}=await setup();choose();source().value='a'.repeat(SUMMARY_LIMIT+1);click('Générer un aperçu');expect(status()).toContain('Aucun texte');expect(model).not.toHaveBeenCalled();
  source().value='a';vi.spyOn(navigator,'onLine','get').mockReturnValue(false);click('Générer un aperçu');expect(status()).toContain('connexion réseau');expect(model).not.toHaveBeenCalled();
 });
 it('ignores late model output after cancellation',async()=>{
  let finish!:(value:{content:{type:'text';text:string}[];stop_reason:'end_turn'})=>void;
  const model=vi.fn((_request:AgentModelRequest)=>new Promise<{content:{type:'text';text:string}[];stop_reason:'end_turn'}>(resolve=>{finish=resolve;}));
  await setup(model);choose();source().value='Source';click('Générer un aperçu');await vi.waitFor(()=>expect(model).toHaveBeenCalled());
  click('Arrêter');expect(model.mock.calls[0][0].signal.aborted).toBe(true);finish({content:[{type:'text',text:answer}],stop_reason:'end_turn'});await Promise.resolve();
  expect(status()).toContain('arrêtée');expect(must(document.querySelector<HTMLElement>('[data-ai-summary-preview]')).hidden).toBe(true);
 });
 it('rejects insertion when the source page changed or became inaccessible',async()=>{
  const {append,getSource}=await setup();choose();click('Charger la page ouverte');await vi.waitFor(()=>expect(status()).toContain('Page chargée'));click('Générer un aperçu');await vi.waitFor(()=>expect(status()).toContain('Aperçu prêt'));
  getSource.mockReturnValue({id:'other',text:'Autre page'});click('Ajouter à la fin de la page');expect(append).not.toHaveBeenCalled();await vi.waitFor(()=>expect(status()).toContain('page a changé'));
 });
 it('shows model failures and keeps the source for retry',async()=>{
  const model=vi.fn(async(_request:AgentModelRequest):Promise<never>=>{throw new Error('Clé refusée');});await setup(model);choose();source().value='Original';click('Générer un aperçu');await vi.waitFor(()=>expect(status()).toBe('Clé refusée'));expect(source().value).toBe('Original');
 });
});


describe('summary editor boundary',()=>{
 it('appends after existing blocks as one undo transaction and checks rights again',()=>{
  const insertMany=vi.fn(()=>[]),transact=vi.fn((action:()=>void)=>action());
  const editor={insertMany,getBlocksCount:()=>7,transact};
  const blocks=summaryOutput(parseSummary(answer));
  expect(()=>appendSummaryBlocks({editor,currentId:'page',sourceId:'page',editable:false},blocks)).toThrow('lecture seule');
  expect(()=>appendSummaryBlocks({editor,currentId:'other',sourceId:'page',editable:true},blocks)).toThrow();
  expect(insertMany).not.toHaveBeenCalled();
  appendSummaryBlocks({editor,currentId:'page',sourceId:'page',editable:true},blocks);
  expect(insertMany).toHaveBeenCalledExactlyOnceWith(blocks,7);expect(transact).toHaveBeenCalledOnce();
 });
});
