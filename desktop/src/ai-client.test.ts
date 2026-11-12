import {afterEach,describe,expect,it,vi} from 'vitest';
import {createAiClient,selectionKey} from './ai-client';
import {initialWorkspace,type RemoteWorkspace} from './workspace-registry';
const ref:RemoteWorkspace={kind:'remote',id:'r',name:'Team',server:'https://example.org',accountId:'a',workspaceId:'team/one'};
afterEach(()=>{vi.unstubAllGlobals();Reflect.deleteProperty(window,'__TAURI_INTERNALS__');localStorage.clear();});
describe('OpenAI client transport',()=>{
 it('keeps remote credentials in authenticated API bodies without browser persistence',async()=>{
  const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true})});vi.stubGlobal('fetch',fetch);
  const client=createAiClient(ref);await client.save('personal',{apiKey:'private-secret'});await client.save('workspace',{model:'gpt-x'});await client.remove('personal');
  expect(fetch.mock.calls[0]![0]).toBe('https://example.org/api/workspaces/team%2Fone/ai/credentials');
  expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({scope:'personal',apiKey:'private-secret'});
  expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({scope:'workspace',model:'gpt-x'});
  expect(fetch.mock.calls[2]![0]).toContain('?scope=personal');expect(localStorage.length).toBe(0);
 });
 it('forwards cancellation to remote model discovery and responses',async()=>{
  const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({models:[]})});vi.stubGlobal('fetch',fetch);const signal=new AbortController().signal;const client=createAiClient(ref);
  await client.models('personal',signal);await client.respond({model:'gpt-x',system:'System',messages:[{role:'user',content:'Hello'}]},signal);
  expect(fetch.mock.calls[0]![1].signal).toBe(signal);expect(fetch.mock.calls[1]![1].signal).toBe(signal);
 });
 it('uses native secure AI commands and cancels an active request by its run ID',async()=>{
  let finish!:(value:unknown)=>void;
  const invoke=vi.fn(async(command:string)=>command==='ai_local_respond'?await new Promise(resolve=>{finish=resolve;}):command==='ai_local_status'?{configured:true,model:'gpt-x'}:undefined);
  Reflect.set(window,'__TAURI_INTERNALS__',{invoke});const client=createAiClient(initialWorkspace);await client.config();await client.save('personal',{apiKey:'private-secret'});
  const gate=new AbortController();const pending=client.respond({model:'gpt-x',system:'System',messages:[]},gate.signal);gate.abort();finish({text:'late',model:'gpt-x'});
  await expect(pending).rejects.toMatchObject({name:'AbortError'});
  const request=invoke.mock.calls.find(call=>call[0]==='ai_local_respond') as unknown as [string,{runId:string}];
  expect(invoke).toHaveBeenCalledWith('ai_local_cancel',{runId:request[1].runId});
  expect(invoke).toHaveBeenCalledWith('ai_local_save',{apiKey:'private-secret'});expect(localStorage.length).toBe(0);
 });
 it('rejects workspace credential operations for a local-only workspace',async()=>{
  const invoke=vi.fn();Reflect.set(window,'__TAURI_INTERNALS__',{invoke});const client=createAiClient(initialWorkspace);
  await expect(client.save('workspace',{apiKey:'private-secret'})).rejects.toThrow('clé partagée');await expect(client.remove('workspace')).rejects.toThrow('clé partagée');await expect(client.models('workspace')).rejects.toThrow('clé partagée');expect(invoke).not.toHaveBeenCalled();
 });
 it('rejects an already cancelled native request before invoking the bridge',async()=>{
  const invoke=vi.fn();Reflect.set(window,'__TAURI_INTERNALS__',{invoke});const gate=new AbortController();gate.abort();
  await expect(createAiClient(initialWorkspace).respond({model:'gpt-x',system:'',messages:[]},gate.signal)).rejects.toMatchObject({name:'AbortError'});expect(invoke).not.toHaveBeenCalled();
 });
 it('isolates model selections by server, account and workspace',()=>{
  expect(selectionKey(ref)).not.toBe(selectionKey({...ref,accountId:'b'}));expect(selectionKey(ref)).not.toBe(selectionKey({...ref,workspaceId:'other'}));expect(selectionKey(ref)).not.toBe(selectionKey({...ref,server:'https://other.org'}));
 });
});
