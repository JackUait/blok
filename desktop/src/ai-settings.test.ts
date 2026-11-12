import {afterEach,describe,expect,it,vi} from 'vitest';
import {mountAiSettings} from './ai-settings';
import type {AiClient,AiConfig} from './ai-client';
import type {RemoteWorkspace} from './workspace-registry';
const ref:RemoteWorkspace={kind:'remote',id:'r',name:'Team',server:'https://example.org',accountId:'a',workspaceId:'team',role:'admin'};
const base:AiConfig={personal:{configured:true,model:'gpt-personal'},workspace:{configured:true,model:'gpt-team'},effective:{source:'personal',model:'gpt-personal'},canManageWorkspace:true};
const cleanup:Array<()=>void>=[];
afterEach(()=>{cleanup.splice(0).forEach(fn=>fn());document.body.replaceChildren();localStorage.clear();vi.restoreAllMocks();});
function mount(config:AiConfig=base,patch:Partial<AiClient>={}) {
 const client:AiClient={available:true,config:vi.fn(async()=>config),save:vi.fn(async()=>undefined),remove:vi.fn(async()=>undefined),models:vi.fn(async()=>({models:[{id:'gpt-personal'},{id:'gpt-new'},{id:'gpt-team'}]})),respond:vi.fn(),...patch};
 const container=document.createElement('div');document.body.append(container);const handle=mountAiSettings(container,ref,client);cleanup.push(()=>handle.destroy());return {client,container,handle};
}
async function ready(container:HTMLElement){await vi.waitFor(()=>expect(container.querySelector('[data-ai-scope=personal]')).not.toBeNull());}
describe('OpenAI credential settings',()=>{
 it('shows personal priority and workspace controls only for administrators',async()=>{
  const {container}=mount();await ready(container);expect(container.querySelector('[data-ai-effective]')?.textContent).toContain('Clé personnelle');expect(container.querySelector('[data-ai-scope=workspace]')).not.toBeNull();
  const member=mount({...base,canManageWorkspace:false});await ready(member.container);expect(member.container.querySelector('[data-ai-scope=workspace]')).toBeNull();expect(member.container.textContent).toContain('Gérée par un administrateur');
 });
 it('saves a model with no API key, preserving the stored credential',async()=>{
  const {container,client}=mount();await ready(container);await vi.waitFor(()=>expect(container.querySelector('[data-ai-scope=personal] [data-desktop-choice]')).not.toBeNull());
  container.querySelector<HTMLButtonElement>('[data-ai-scope=personal] [data-desktop-choice]')!.click();document.querySelector<HTMLElement>('[data-blok-item-name=gpt-new]')!.click();
  await vi.waitFor(()=>expect(client.save).toHaveBeenCalledWith('personal',{model:'gpt-new'}));expect(JSON.stringify(vi.mocked(client.save).mock.calls)).not.toContain('apiKey');
 });
 it('never repaints or persists a submitted API key and clears the input on success',async()=>{
  const {container,client}=mount();await ready(container);const input=container.querySelector<HTMLInputElement>('[data-ai-scope=personal] input[type=password]')!;input.value='private-secret';input.dispatchEvent(new Event('input'));
  expect(container.innerHTML).not.toContain('private-secret');container.querySelector('[data-ai-scope=personal] form')!.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));
  await vi.waitFor(()=>expect(client.save).toHaveBeenCalledWith('personal',{apiKey:'private-secret'}));await vi.waitFor(()=>expect(input.value).toBe(''));
  expect(container.innerHTML).not.toContain('private-secret');expect(JSON.stringify(localStorage)).not.toContain('private-secret');
 });
 it('refreshes effective workspace fallback after removing a personal key',async()=>{
  const fallback={...base,personal:{configured:false,model:''},effective:{source:'workspace' as const,model:'gpt-team'}};
  const config=vi.fn().mockResolvedValueOnce(base).mockResolvedValue(fallback);const {container,client}=mount(base,{config});await ready(container);
  [...container.querySelectorAll<HTMLButtonElement>('[data-ai-scope=personal] button')].find(button=>button.textContent==='Retirer la clé')!.click();
  await vi.waitFor(()=>expect(client.remove).toHaveBeenCalledWith('personal'));await vi.waitFor(()=>expect(container.querySelector('[data-ai-effective]')?.textContent).toContain('Clé du workspace'));
 });
 it('aborts discovery and ignores late rendering after destruction',async()=>{
  let resolve!:(value:AiConfig)=>void;const config=vi.fn((signal?:AbortSignal)=>new Promise<AiConfig>(done=>{resolve=done;expect(signal).toBeInstanceOf(AbortSignal);}));
  const {container,handle}=mount(base,{config});const before=container.innerHTML;handle.destroy();resolve(base);await Promise.resolve();await Promise.resolve();expect(container.innerHTML).toBe(before);expect(config.mock.calls[0]![0]?.aborted).toBe(true);
 });
 it('does not start another config request after a save completes on a destroyed panel',async()=>{
  let finish!:()=>void;const save=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));const {container,handle,client}=mount(base,{save});await ready(container);
  const input=container.querySelector<HTMLInputElement>('input[type=password]')!;input.value='private-secret';container.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));handle.destroy();const before=container.textContent;finish();await Promise.resolve();await Promise.resolve();await Promise.resolve();
  expect(client.config).toHaveBeenCalledOnce();expect(container.textContent).toBe(before);expect(input.value).toBe('');
 });
 it('shows asynchronous discovery failures without exposing credential values',async()=>{
  const {container}=mount(base,{config:vi.fn(async()=>{throw new Error('Session expirée');})});await vi.waitFor(()=>expect(container.textContent).toContain('Session expirée'));expect(container.querySelector('input')).toBeNull();expect(container.querySelector('button')?.textContent).toBe('Réessayer');
 });
});
