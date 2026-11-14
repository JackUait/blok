export type CloudRole = 'admin' | 'member' | 'viewer';
export interface CloudWorkspace { id: string; slug: string; name: string; role: CloudRole }
export interface CloudUser { id: string; email: string; name?: string; instanceAdmin?: boolean }
export interface CloudSession { user: CloudUser; workspaces: CloudWorkspace[] }
export type CloudSignupPolicy = 'invite' | 'domain' | 'open';
export type CloudWorkspaceCreation = 'anyone' | 'admins_only' | 'disabled';
export interface CloudInstance {
  name: string;
  setupRequired: boolean;
  signupPolicy: CloudSignupPolicy;
  workspaceCreation: CloudWorkspaceCreation;
  defaultWorkspace: {slug: string; name: string} | null;
}
export interface CloudAdminSettings {
  name: string;
  signupPolicy: CloudSignupPolicy;
  signupDomains: string[];
  workspaceCreation: CloudWorkspaceCreation;
  defaultWorkspaceId: string | null;
  setupCompletedAt: string | null;
  updatedAt: string;
}
export interface CloudAdminUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  workspaceCount: number;
  instanceAdmin: boolean;
}
export interface CloudAdminWorkspace {
  id: string;
  slug: string;
  name: string;
  memberCount: number;
  createdAt?: string;
}
export type CloudMailBackend = 'injected' | 'development' | 'smtp' | 'resend' | '';
export interface CloudEmailTestResult {
  ok: boolean;
  backend: CloudMailBackend;
  error?: string;
}
/** Native implementations persist this credential in the operating system secret store. */
export interface CloudSessionAdapter {
  getToken(): Promise<string | null>;
  setToken(token: string | null): Promise<void>;
}
export interface CloudWorkspaceStatus { id: string; slug: string; name: string; role: CloudRole | null; joinStatus: 'pending' | 'approved' | 'rejected' | null }
export class CloudApiError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'CloudApiError'; }
}
export interface CloudClientOptions { origin?: string; sessionAdapter?: CloudSessionAdapter }
export class CloudClient {
  currentSession: CloudSession | null = null;
  readonly origin: string;
  readonly sessionAdapter?: CloudSessionAdapter;
  constructor(options: CloudClientOptions = {}) {
    this.origin = (options.origin ?? '').replace(/\/$/, '');
    this.sessionAdapter = options.sessionAdapter;
  }
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const token = await this.sessionAdapter?.getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    let response: Response;
    try { response = await fetch(`${this.origin}${path}`, { ...init, headers, credentials: 'include' }); }
    catch { throw new CloudApiError(0, 'Connexion au serveur impossible. Vérifiez votre connexion puis réessayez.'); }
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new CloudApiError(response.status, typeof data?.error === 'string' ? data.error : 'La demande n’a pas pu aboutir. Réessayez.');
    return data as T;
  }
  instance(): Promise<CloudInstance> { return this.request<CloudInstance>('/api/instance'); }
  async session(): Promise<CloudSession> { const session = await this.request<CloudSession>('/api/session'); this.currentSession = session; return session; }
  async verifyCode(email: string, code: string): Promise<CloudSession> {
    const session = await this.request<CloudSession & {token?: string}>('/api/auth/verify-code', { method: 'POST', body: JSON.stringify({email, code, ...(this.sessionAdapter ? {client: 'desktop'} : {})}) });
    if (this.sessionAdapter) {
      if (!session.token) throw new Error('Le serveur n’a pas fourni de session pour cet appareil.');
      await this.sessionAdapter.setToken(session.token);
    }
    this.currentSession = session;
    return session;
  }
  async logout(): Promise<void> {
    await this.request('/api/auth/logout', {method:'POST'});
    await this.sessionAdapter?.setToken(null);
    this.currentSession = null;
  }
  workspace(slug: string): Promise<CloudWorkspaceStatus> { return this.request(`/api/workspaces/${encodeURIComponent(slug)}`); }
  async ticket(slug: string, doc: string): Promise<string> {
    const result = await this.request<{ticket: string}>(`/api/workspaces/${encodeURIComponent(slug)}/ticket?doc=${encodeURIComponent(doc)}`);
    return result.ticket;
  }
  adminSettings(): Promise<CloudAdminSettings> { return this.request('/api/admin/settings'); }
  patchAdminSettings(patch: {
    name?: string;
    signupPolicy?: CloudSignupPolicy;
    signupDomains?: string[];
    workspaceCreation?: CloudWorkspaceCreation;
    defaultWorkspaceId?: string | null;
  }): Promise<CloudAdminSettings> {
    return this.request('/api/admin/settings', { method: 'PATCH', body: JSON.stringify(patch) });
  }
  adminUsers(query: { limit?: number; offset?: number } = {}): Promise<{ users: CloudAdminUser[]; total: number; limit: number; offset: number }> {
    const params = new URLSearchParams();
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.offset !== undefined) params.set('offset', String(query.offset));
    const suffix = params.size ? `?${params}` : '';
    return this.request(`/api/admin/users${suffix}`);
  }
  patchAdminUser(id: string, patch: { instanceAdmin?: boolean; name?: string }): Promise<CloudAdminUser> {
    return this.request(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }
  deleteAdminUser(id: string): Promise<{ ok: true }> {
    return this.request(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
  adminWorkspaces(): Promise<{ workspaces: CloudAdminWorkspace[] }> {
    return this.request('/api/admin/workspaces');
  }
  /** Deliverability probe — keeps 503 SMTP bodies instead of throwing away `backend`. */
  async adminEmailTest(email: string): Promise<CloudEmailTestResult> {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    const token = await this.sessionAdapter?.getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    let response: Response;
    try {
      response = await fetch(`${this.origin}/api/admin/email-test`, {
        method: 'POST', headers, credentials: 'include', body: JSON.stringify({ email }),
      });
    } catch {
      throw new CloudApiError(0, 'Connexion au serveur impossible. Vérifiez votre connexion puis réessayez.');
    }
    const data = await response.json().catch(() => null) as { ok?: boolean; backend?: string; error?: string } | null;
    const backend = (data?.backend ?? '') as CloudMailBackend;
    if (response.ok) return { ok: true, backend };
    return {
      ok: false,
      backend,
      error: typeof data?.error === 'string' ? data.error : 'La demande n’a pas pu aboutir. Réessayez.',
    };
  }
}
