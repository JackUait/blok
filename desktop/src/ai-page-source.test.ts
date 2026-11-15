import {describe,expect,it,vi} from 'vitest';
import {readAiPageSource} from './ai-page-source';
describe('semantic AI source',()=>{
 it('exports title and blocks with separators, without taking page chrome or empty toggle placeholder text',async()=>{
  document.body.innerHTML='<article data-desktop-document><button>Ajouter une couverture</button><h1>Projet</h1><p>Premier bloc</p><p>Deuxième bloc</p><button>Liste dépliante vide...</button></article>';
  const exportMarkdown=vi.fn(async()=> '# Projet\n\nPremier bloc\n\nDeuxième bloc\n\n<details>\n<summary>Détails</summary>\n</details>');
  const result=await readAiPageSource({id:'page',editor:{isReady:Promise.resolve(),blocks:{exportMarkdown}}},()=>true);
  expect(exportMarkdown).toHaveBeenCalledExactlyOnceWith({title:true});
  expect(result?.text).toContain('Premier bloc\n\nDeuxième bloc');
  expect(result?.text).not.toContain('Ajouter une couverture');expect(result?.text).not.toContain('Liste dépliante vide');
 });
 it('drops an export if the page changes or access is revoked during the save',async()=>{
  const state={accessible:true};const exportMarkdown=vi.fn(async()=>{state.accessible=false;return 'Secret';});
  expect(await readAiPageSource({id:'old',editor:{isReady:Promise.resolve(),blocks:{exportMarkdown}}},()=>state.accessible)).toBeNull();
 });
 it('does not export inaccessible pages and surfaces save failures',async()=>{
  const exportMarkdown=vi.fn(async():Promise<string>=>{throw new Error('Extraction impossible');});
  const snapshot={id:'page',editor:{isReady:Promise.resolve(),blocks:{exportMarkdown}}};
  expect(await readAiPageSource(snapshot,()=>false)).toBeNull();expect(exportMarkdown).not.toHaveBeenCalled();
  await expect(readAiPageSource(snapshot,()=>true)).rejects.toThrow('Extraction impossible');
 });
});
