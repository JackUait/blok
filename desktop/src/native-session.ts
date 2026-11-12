import { serverOrigin } from './workspace-registry';
type Bridge = { invoke(command: string, args?: Record<string, unknown>): Promise<unknown> };
/** Never fall back to localStorage for a native bearer credential. */
export function nativeSessionAdapter(server: string) {
  const origin = serverOrigin(server);
  const bridge = (window as Window & { __TAURI_INTERNALS__?: Bridge }).__TAURI_INTERNALS__;
  if (!bridge) throw new Error('Le stockage sécurisé nécessite l’application native');
  return {
    async getToken(): Promise<string | null> { return await bridge.invoke('load_cloud_session', { server: origin }) as string | null; },
    async setToken(token: string | null): Promise<void> { await bridge.invoke('save_cloud_session', { server: origin, token }); },
  };
}
