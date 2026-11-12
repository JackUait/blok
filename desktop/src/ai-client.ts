import { CloudClient } from './cloud/client';
import { nativeSessionAdapter } from './native-session';
import { workspaceKey, type WorkspaceRef } from './workspace-registry';

export type AiScope = 'personal' | 'workspace';
export interface AiCredential { configured: boolean; model: string }
export interface AiConfig {
  personal: AiCredential;
  workspace: AiCredential;
  effective: { source: AiScope | 'none'; model: string };
  canManageWorkspace: boolean;
}
export interface AiMessage { role: 'user' | 'assistant'; content: string }
export interface AiResponse { text: string; model: string; source?: AiScope }
export interface AiClient {
  available: boolean;
  config(signal?: AbortSignal): Promise<AiConfig>;
  save(scope: AiScope, value: {apiKey?: string; model?: string}): Promise<unknown>;
  remove(scope: AiScope): Promise<unknown>;
  models(scope?: AiScope, signal?: AbortSignal): Promise<{models: {id: string}[]}>;
  respond(value: {model: string; system: string; messages: AiMessage[]}, signal: AbortSignal): Promise<AiResponse>;
}
type Bridge = {invoke(command: string, args?: Record<string, unknown>): Promise<unknown>};
export const nativeBridge = (): Bridge | undefined => (window as Window & {__TAURI_INTERNALS__?: Bridge}).__TAURI_INTERNALS__;
export const aiChanged = (): void => { window.dispatchEvent(new Event('blok:ai-settings-changed')); };
export const selectionKey = (ref: WorkspaceRef): string => `blok:ai:selection:${workspaceKey(ref)}`;
export function createAiClient(ref: WorkspaceRef): AiClient {
  const native = nativeBridge();
  if (ref.kind === 'remote') {
    const client = new CloudClient({origin: ref.server, ...(native ? {sessionAdapter: nativeSessionAdapter(ref.server)} : {})});
    const path = `/api/workspaces/${encodeURIComponent(ref.workspaceId)}/ai`;
    return {
      available: true,
      config: (signal) => client.request(path, {signal}),
      save: (scope, value) => client.request(`${path}/credentials`, {method:'PUT', body: JSON.stringify({scope, ...value})}),
      remove: (scope) => client.request(`${path}/credentials?scope=${scope}`, {method:'DELETE'}),
      models: (scope, signal) => client.request(`${path}/models${scope ? `?scope=${scope}` : ''}`, {signal}),
      respond: (value, signal) => client.request(`${path}/respond`, {method:'POST', body:JSON.stringify(value), signal}),
    };
  }
  const invoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    if (!native) throw new Error('Ouvrez un espace en ligne ou utilisez l’application Blok pour configurer OpenAI.');
    return await native.invoke(command, args) as T;
  };
  return {
    available: !!native,
    config: async () => {
      const personal = await invoke<AiCredential>('ai_local_status');
      return {personal, workspace:{configured:false, model:''}, effective:{source:personal.configured ? 'personal' : 'none', model:personal.model}, canManageWorkspace:false};
    },
    save: (scope, value) => scope === 'personal' ? invoke('ai_local_save', value) : Promise.reject(new Error('Un espace local ne possède pas de clé partagée.')),
    remove: (scope) => scope === 'personal' ? invoke('ai_local_delete') : Promise.reject(new Error('Un espace local ne possède pas de clé partagée.')),
    models: (scope) => scope !== 'workspace' ? invoke('ai_local_models') : Promise.reject(new Error('Un espace local ne possède pas de clé partagée.')),
    respond: async (value, signal) => {
      signal.throwIfAborted();
      const runId = crypto.randomUUID();
      const cancel = (): void => { void invoke('ai_local_cancel', {runId}).catch(()=>undefined); };
      signal.addEventListener('abort', cancel, {once:true});
      try { const result = await invoke<AiResponse>('ai_local_respond', {...value, runId}); signal.throwIfAborted(); return result; }
      finally { signal.removeEventListener('abort', cancel); }
    },
  };
}
