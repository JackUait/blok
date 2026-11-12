import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createWorkspaceAssistant} from './assistant';
import type {AgentModelRequest} from '../../types/api';
import type {RemoteWorkspace} from './workspace-registry';
const ai=vi.hoisted(()=>({config:vi.fn(),models:vi.fn(),respond:vi.fn()}));
vi.mock('./ai-client',async(importOriginal)=>({...await importOriginal<typeof import('./ai-client')>(),nativeBridge:()=>undefined,createAiClient:()=>({available:true,...ai})}));
const ref:RemoteWorkspace={kind:'remote',id:'r',name:'Team',server:'https://example.org',accountId:'a',workspaceId:'team'};
beforeEach(()=>{vi.clearAllMocks();ai.config.mockResolvedValue({effective:{source:'personal',model:'gpt-default'}});ai.models.mockResolvedValue({models:[{id:'gpt-default'},{id:'gpt-other'}]});ai.respond.mockResolvedValue({text:'Answer',model:'gpt-other',source:'personal'});});
afterEach(()=>localStorage.clear());
describe('workspace OpenAI assistant adapter',()=>{
 it('labels models with effective personal/workspace credential source and persists only opaque model IDs',async()=>{
  const adapter=createWorkspaceAssistant(ref);const providers=await adapter.listProviders(new AbortController().signal);expect(providers).toContainEqual({id:'openai:gpt-default',label:'OpenAI · gpt-default · clé personnelle'});
  adapter.onProviderSelected('openai:gpt-other');expect(adapter.preferredProvider()).toBe('openai:gpt-other');expect(JSON.stringify(localStorage)).not.toContain('apiKey');
  ai.config.mockResolvedValue({effective:{source:'workspace',model:'gpt-default'}});expect((await adapter.listProviders(new AbortController().signal))[0]?.label).toContain('clé du workspace');
 });
 it('keeps configured model available when catalog discovery fails and empties providers after credentials are removed',async()=>{
  ai.models.mockRejectedValue(new Error('Catalog unavailable'));const adapter=createWorkspaceAssistant(ref);expect(await adapter.listProviders(new AbortController().signal)).toEqual([{id:'openai:gpt-default',label:'OpenAI · gpt-default · clé personnelle'}]);
  ai.config.mockResolvedValue({effective:{source:'none',model:''}});expect(await adapter.listProviders(new AbortController().signal)).toEqual([]);
 });
 it('does not advertise a paid model before an explicit default model is configured',async()=>{
  ai.config.mockResolvedValue({effective:{source:'personal',model:''}});expect(await createWorkspaceAssistant(ref).listProviders(new AbortController().signal)).toEqual([]);
 });
 it('adapts history to plain text without treating tool blocks as user prompts and forwards cancellation',async()=>{
  const adapter=createWorkspaceAssistant(ref),progress=vi.fn(),signal=new AbortController().signal;
  const request={system:'System',messages:[{role:'user',content:[{type:'text',text:'Question'},{type:'tool_use',id:'tool',name:'blok_read',input:{secret:'private'}}]},{role:'assistant',content:'Earlier answer'}],tools:[],signal} as unknown as AgentModelRequest;
  const result=await adapter.modelFor('openai:gpt-other',progress)(request);
  expect(ai.respond).toHaveBeenCalledWith({model:'gpt-other',system:'System',messages:[{role:'user',content:expect.stringMatching(/^Question\s*$/)},{role:'assistant',content:'Earlier answer'}]},signal);
  expect(result.content).toEqual([{type:'text',text:'Answer'}]);expect(progress).toHaveBeenCalledWith(expect.stringContaining('gpt-other'));
 });
 it('propagates config and response failures instead of silently choosing another credential',async()=>{
  ai.config.mockRejectedValue(new Error('Session expirée'));const adapter=createWorkspaceAssistant(ref);await expect(adapter.listProviders(new AbortController().signal)).rejects.toThrow('Session expirée');
  ai.respond.mockRejectedValue(new Error('Clé refusée'));await expect(adapter.modelFor('openai:gpt-other',()=>undefined)({system:'',messages:[],tools:[],signal:new AbortController().signal})).rejects.toThrow('Clé refusée');
 });
});
