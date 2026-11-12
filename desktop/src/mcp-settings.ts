import { CloudClient } from './cloud/client';
import { styleTextField } from './ui/controls';

interface McpToken { id: string; label: string; createdAt: string; expiresAt: string; lastUsedAt: string | null }

export function mountMcpSettings(content: HTMLElement, client: CloudClient): void {
  const heading = document.createElement('h2'); heading.setAttribute('data-desktop-settings-section', ''); heading.textContent = 'Accès MCP';
  const help = document.createElement('p'); help.setAttribute('data-desktop-settings-explanation', '');
  help.textContent = 'Connectez Codex ou un autre client MCP à vos espaces avec vos propres droits. Le jeton est affiché une seule fois et expire après 90 jours.';
  const url = document.createElement('code'); url.setAttribute('data-desktop-settings-path', ''); url.textContent = `${client.origin}/mcp`;
  const name = document.createElement('input'); name.setAttribute('data-desktop-mcp-name', ''); name.type = 'text'; name.maxLength = 80; name.placeholder = 'Nom du client (ex. Codex)'; name.setAttribute('aria-label', 'Nom du jeton MCP'); styleTextField(name);
  const create = document.createElement('button'); create.type = 'button'; create.setAttribute('data-desktop-settings-copy', ''); create.textContent = 'Créer un jeton';
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.setAttribute('data-desktop-mcp-status', '');
  const secret = document.createElement('div'); secret.setAttribute('data-desktop-mcp-secret', ''); secret.hidden = true;
  const list = document.createElement('div'); list.setAttribute('data-desktop-mcp-list', '');
  const showSecret = (token: string): void => {
    const note = document.createElement('p'); note.textContent = 'Copiez ce jeton maintenant : il ne sera plus affiché.';
    const value = document.createElement('code'); value.setAttribute('data-desktop-settings-path', ''); value.textContent = token;
    const copy = document.createElement('button'); copy.type = 'button'; copy.setAttribute('data-desktop-settings-copy', ''); copy.textContent = 'Copier le jeton';
    copy.addEventListener('click', () => { void navigator.clipboard.writeText(token).then(() => { copy.textContent = 'Copié'; }).catch(() => { status.textContent = 'Copie impossible : sélectionnez le jeton affiché.'; }); });
    secret.replaceChildren(note, value, copy); secret.hidden = false;
  };
  const refresh = async (): Promise<void> => {
    try {
      const response = await client.request<{tokens: McpToken[]}>('/api/mcp/tokens');
      if (!content.isConnected) return;
      list.replaceChildren();
      if (!response.tokens.length) { list.textContent = 'Aucun jeton actif.'; return; }
      for (const token of response.tokens) {
        const row = document.createElement('div'); row.setAttribute('data-desktop-settings-row', '');
        const text = document.createElement('span'); text.textContent = `${token.label} · expire le ${new Date(token.expiresAt).toLocaleDateString()}`;
        const actions = document.createElement('span'); actions.setAttribute('data-desktop-mcp-actions', '');
        const rotate = document.createElement('button'); rotate.type = 'button'; rotate.setAttribute('data-desktop-settings-copy', ''); rotate.textContent = 'Renouveler';
        rotate.addEventListener('click', () => { void (async () => {
          rotate.disabled = true;
          try {
            const result = await client.request<{token: string}>(`/api/mcp/tokens/${encodeURIComponent(token.id)}/rotate`, {method: 'POST'});
            if (!content.isConnected) return;
            showSecret(result.token); status.textContent = 'Ancien jeton désactivé. Copiez le nouveau.'; await refresh();
          } catch { status.textContent = 'Impossible de renouveler ce jeton.'; rotate.disabled = false; }
        })(); });
        const revoke = document.createElement('button'); revoke.type = 'button'; revoke.setAttribute('data-desktop-settings-copy', ''); revoke.textContent = 'Révoquer';
        revoke.addEventListener('click', () => { void (async () => {
          revoke.disabled = true;
          try { await client.request(`/api/mcp/tokens/${encodeURIComponent(token.id)}`, {method: 'DELETE'}); status.textContent = 'Jeton révoqué.'; await refresh(); }
          catch { status.textContent = 'Impossible de révoquer ce jeton.'; revoke.disabled = false; }
        })(); });
        actions.append(rotate, revoke); row.append(text, actions); list.append(row);
      }
    } catch { if (content.isConnected) status.textContent = 'Impossible de charger les jetons MCP.'; }
  };
  create.addEventListener('click', () => { void (async () => {
    const label = name.value.trim();
    if (!label) { status.textContent = 'Donnez un nom au jeton.'; name.focus(); return; }
    create.disabled = true; secret.replaceChildren(); secret.hidden = true;
    try {
      const result = await client.request<{token: string}>('/api/mcp/tokens', {method: 'POST', body: JSON.stringify({label})});
      if (!content.isConnected) return;
      showSecret(result.token); name.value = ''; status.textContent = 'Jeton créé.'; await refresh();
    } catch { status.textContent = 'Impossible de créer le jeton.'; }
    finally { create.disabled = false; }
  })(); });
  content.append(heading, help, url, name, create, status, secret, list);
  void refresh();
}
