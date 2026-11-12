import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {mountAgentAssistant,type AgentAssistantHandle} from '../../../src/shell/agent-assistant';
import type {AgentModel} from '../../../types/api';
const cli=vi.hoisted(()=>({inspect:vi.fn(),model:vi.fn()}));
vi.mock('../../../src/shell/agent-model',async(importOriginal)=>({...await importOriginal<typeof import('../../../src/shell/agent-model')>(),inspectCli:cli.inspect,createCliAgentModel:cli.model}));
const mounted: AgentAssistantHandle[]=[];
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();cli.inspect.mockImplementation(async(command)=>({command,installed:true,connected:true,version:'1'}));cli.model.mockReturnValue(async()=>({content:[{type:'text',text:'CLI answer'}],stop_reason:'end_turn'}));});
afterEach(()=>{mounted.splice(0).forEach(handle=>handle.destroy());document.body.replaceChildren();localStorage.clear();});
function mount(options: Parameters<typeof mountAgentAssistant>[0]) {const handle=mountAgentAssistant(options);mounted.push(handle);document.body.append(handle.element);handle.open();return handle;}
function ask(handle:AgentAssistantHandle,text='Question'){const field=handle.element.querySelector<HTMLTextAreaElement>('textarea')!;field.value=text;field.dispatchEvent(new Event('input',{bubbles:true}));handle.element.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));}
describe('host assistant provider adapters',()=>{
  it('keeps opaque model IDs through composer selection and renders the captured provider label',async()=>{
    const response: AgentModel=vi.fn(async()=>({content:[{type:'text',text:'OpenAI answer'}],stop_reason:'end_turn'}));
    const modelFor=vi.fn(()=>response), selected=vi.fn();
    const handle=mount({getPageText:()=>'',openSettings:()=>undefined,listProviders:async()=>[{id:'openai:gpt-model',label:'GPT model'},{id:'openai:another',label:'Another model'}],preferredProvider:()=> 'openai:gpt-model',modelFor,onProviderSelected:selected});
    await handle.refreshProviders();expect(cli.inspect).not.toHaveBeenCalled();
    const choice=handle.element.querySelector<HTMLButtonElement>('[data-blok-chat-provider-trigger]')!;expect(choice.value).toBe('openai:gpt-model');
    choice.click();document.querySelector<HTMLElement>('[data-blok-item-name="openai:another"]')!.click();expect(selected).toHaveBeenCalledWith('openai:another');
    await handle.refreshProviders();expect(choice.value).toBe('openai:another');
    ask(handle);
    await vi.waitFor(()=>expect(handle.element.textContent).toContain('OpenAI answer'));
    expect(modelFor).toHaveBeenCalledWith('openai:another',expect.any(Function));
    expect(handle.element.querySelector('[data-blok-agent-turn]')?.textContent).toContain('Another model');
    expect(cli.model).not.toHaveBeenCalled();
  });
  it('refreshes host providers through the public handle and settings event, removing revoked models',async()=>{
    let providers=[{id:'openai:first',label:'First'}];
    const handle=mount({getPageText:()=>'',openSettings:()=>undefined,listProviders:async()=>providers});await handle.refreshProviders();
    providers=[{id:'openai:second',label:'Second'}];window.dispatchEvent(new Event('blok:ai-settings-changed'));
    await vi.waitFor(()=>expect(handle.element.querySelector<HTMLButtonElement>('[data-blok-chat-provider-trigger]')!.value).toBe('openai:second'));
    providers=[];await handle.refreshProviders();expect(handle.element.querySelector<HTMLButtonElement>('[data-blok-chat-provider-trigger]')!.disabled).toBe(true);
  });
  it('retains default connected CLI discovery and the existing CLI model adapter',async()=>{
    const handle=mount({getPageText:()=>'',openSettings:()=>undefined,preferredProvider:()=> 'claude'});await handle.refreshProviders();
    expect(handle.element.querySelector<HTMLButtonElement>('[data-blok-chat-provider-trigger]')!.value).toBe('claude');ask(handle);
    await vi.waitFor(()=>expect(handle.element.textContent).toContain('CLI answer'));expect(cli.model).toHaveBeenCalledWith({command:'claude'});
  });
  it('never passes an opaque host ID to the default CLI executor',async()=>{
    const handle=mount({getPageText:()=>'',openSettings:()=>undefined,listProviders:async()=>[{id:'openai:private',label:'OpenAI'}]});await handle.refreshProviders();ask(handle);
    await vi.waitFor(()=>expect(handle.element.textContent).toContain('nécessite un adaptateur'));
    expect(cli.model).not.toHaveBeenCalled();
  });
  it('uses a searchable real core menu for model catalogs and keeps Escape local to the menu',async()=>{
    const providers=Array.from({length:12},(_,i)=>({id:`openai:model-${i}`,label:`Model ${i}`}));
    const handle=mount({getPageText:()=>'',openSettings:()=>undefined,listProviders:async()=>providers});await handle.refreshProviders();
    handle.element.querySelector<HTMLButtonElement>('[data-blok-chat-provider-trigger]')!.click();
    expect(document.querySelector('[data-blok-chat-model-menu] input')).not.toBeNull();expect(handle.element.querySelector('select')).toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    expect(handle.element.querySelector<HTMLElement>('[data-blok-agent-panel]')!.hidden).toBe(false);
    expect(handle.element.querySelector('[data-blok-chat-provider-trigger]')?.getAttribute('aria-expanded')).toBe('false');
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));expect(handle.element.querySelector<HTMLElement>('[data-blok-agent-panel]')!.hidden).toBe(true);
  });
  it('handles discovery errors without exposing stale selectable models',async()=>{
    const handle=mount({getPageText:()=>'',openSettings:()=>undefined,listProviders:async()=>{throw new Error('Session expirée');}});await handle.refreshProviders();
    expect(handle.element.querySelector<HTMLButtonElement>('[data-blok-chat-provider-trigger]')!.disabled).toBe(true);expect(handle.element.textContent).toContain('Session expirée');
  });
});
