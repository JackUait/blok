import blokMascot from '../../docs/public/logo-no-sign.png';

export type Provider = 'codex' | 'claude';

export interface ProviderStatus {
  provider: Provider;
  installed: boolean;
  connected: boolean;
  version: string;
}

const KEY = 'blok:desktop:ai-provider';

type NativeWindow = Window & {
  __TAURI_INTERNALS__?: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
};

function bridge(): NativeWindow['__TAURI_INTERNALS__'] {
  return (window as NativeWindow).__TAURI_INTERNALS__;
}

export function selectedProvider(): Provider {
  return localStorage.getItem(KEY) === 'claude' ? 'claude' : 'codex';
}

export function setProvider(provider: Provider): void {
  localStorage.setItem(KEY, provider);
}

export async function providerStatus(provider: Provider): Promise<ProviderStatus> {
  const native = bridge();
  if (!native) return { provider, installed: false, connected: false, version: '' };
  return await native.invoke('agent_provider_status', { provider }) as ProviderStatus;
}

export async function askAssistant(provider: Provider, question: string, pageText: string): Promise<string> {
  const native = bridge();
  if (!native) throw new Error('L’assistant IA est disponible dans l’app Blok pour macOS.');
  return await native.invoke('agent_ask', { provider, question, pageText }) as string;
}

export function createAssistant(getPageText: () => string, openSettings: () => void): { button: HTMLButtonElement; dialog: HTMLElement } {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('data-desktop-ai-button', '');
  button.setAttribute('aria-label', 'Ouvrir l’assistant IA');
  button.setAttribute('title', 'Assistant IA');
  const mascot = document.createElement('img');
  mascot.src = blokMascot;
  mascot.alt = '';
  button.append(mascot);
  const overlay = document.createElement('div');
  overlay.setAttribute('data-desktop-ai-overlay', '');
  overlay.hidden = true;
  const dialog = document.createElement('section');
  dialog.setAttribute('data-desktop-ai-dialog', '');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Assistant IA');
  const header = document.createElement('header');
  const heading = document.createElement('h2');
  heading.textContent = 'Assistant IA';
  const settings = document.createElement('button');
  settings.type = 'button';
  settings.setAttribute('aria-label', 'Réglages IA');
  settings.textContent = 'Réglages';
  const close = document.createElement('button');
  close.type = 'button';
  close.setAttribute('aria-label', 'Fermer l’assistant IA');
  close.textContent = '×';
  header.append(heading, settings, close);
  const note = document.createElement('p');
  note.setAttribute('data-desktop-ai-note', '');
  const form = document.createElement('form');
  const field = document.createElement('textarea');
  field.setAttribute('aria-label', 'Demander à l’assistant IA');
  field.placeholder = 'Pose une question sur cette page…';
  field.rows = 3;
  const includePage = document.createElement('label');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = true;
  includePage.append(checkbox, document.createTextNode(' Inclure cette page'));
  const send = document.createElement('button');
  send.type = 'submit';
  send.textContent = 'Envoyer';
  const response = document.createElement('div');
  response.setAttribute('data-desktop-ai-response', '');
  response.setAttribute('role', 'status');
  form.append(field, includePage, send);
  dialog.append(header, note, response, form);
  overlay.append(dialog);
  document.body.append(overlay);
  const closeDialog = (): void => { overlay.hidden = true; button.focus(); };
  button.addEventListener('click', () => {
    overlay.hidden = false;
    const provider = selectedProvider();
    note.textContent = `${provider === 'codex' ? 'Codex' : 'Claude Code'} · la page est envoyée seulement quand tu demandes une réponse.`;
    field.focus();
  });
  close.addEventListener('click', closeDialog);
  settings.addEventListener('click', () => { closeDialog(); openSettings(); });
  overlay.addEventListener('pointerdown', (event) => { if (event.target === overlay) closeDialog(); });
  overlay.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDialog(); });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const question = field.value.trim();
    if (!question) return;
    send.disabled = true;
    button.setAttribute('data-thinking', '');
    response.textContent = 'L’assistant répond…';
    void askAssistant(selectedProvider(), question, checkbox.checked ? getPageText() : '')
      .then((answer) => { response.textContent = answer || 'Aucune réponse.'; })
      .catch((error: unknown) => { response.textContent = error instanceof Error ? error.message : String(error); })
      .finally(() => { send.disabled = false; button.removeAttribute('data-thinking'); });
  });
  return { button, dialog: overlay };
}
