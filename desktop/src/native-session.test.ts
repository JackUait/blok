import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeSessionAdapter } from './native-session';
afterEach(()=>{Reflect.deleteProperty(window,'__TAURI_INTERNALS__');localStorage.clear();});
describe('native cloud session credentials',()=>{
  it('uses only native secure commands and clears credentials on logout',async()=>{
    const invoke=vi.fn().mockResolvedValueOnce('private-token').mockResolvedValue(undefined);
    Reflect.set(window,'__TAURI_INTERNALS__',{invoke});
    const adapter=nativeSessionAdapter('https://example.org/path');
    expect(await adapter.getToken()).toBe('private-token');
    await adapter.setToken('private-token');await adapter.setToken(null);
    expect(invoke.mock.calls).toEqual([
      ['load_cloud_session',{server:'https://example.org'}],
      ['save_cloud_session',{server:'https://example.org',token:'private-token'}],
      ['save_cloud_session',{server:'https://example.org',token:null}],
    ]);
    expect(localStorage.length).toBe(0);
  });
  it('refuses insecure remote origins and never falls back to browser storage',()=>{
    expect(()=>nativeSessionAdapter('https://example.org')).toThrow('native');
    expect(()=>nativeSessionAdapter('http://example.org')).toThrow('HTTPS');
    expect(localStorage.length).toBe(0);
  });
});
