import type { AgentModel, AgentModelContentBlock } from '../../types/api';
import type { CliCommand, CliStatus } from '../../src/shell/agent-model';
import blokMascot from '../../docs/public/logo-no-sign.png';

export type Provider = CliCommand;

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

export async function inspectNativeProvider(command: CliCommand, signal: AbortSignal): Promise<CliStatus> {
  if (signal.aborted) throw signal.reason;
  try {
    const status = await providerStatus(command);
    return { command, installed: status.installed, connected: status.connected, version: status.version };
  } catch {
    return { command, installed: false, connected: false, version: '' };
  }
}

export async function askAssistant(provider: Provider, question: string, pageText: string): Promise<string> {
  const native = bridge();
  if (!native) throw new Error('L’assistant IA est disponible dans l’app Blok pour macOS.');
  return await native.invoke('agent_ask', { provider, question, pageText }) as string;
}

const plain = (content: string | AgentModelContentBlock[]): string =>
  typeof content === 'string' ? content : content.map((block) => block.type === 'text' && typeof block.text === 'string' ? block.text : '').join('\n');

export const nativeAgentModel = (provider: Provider): AgentModel => async (request) => {
  if (request.signal.aborted) throw request.signal.reason;
  const history = request.messages.slice(-9).map((message) => `${message.role}: ${plain(message.content)}`).join('\n\n');
  const prompt = `${request.system}\n\n${history}`.slice(-100_000);
  const answer = await askAssistant(provider, prompt, '');
  if (request.signal.aborted) throw request.signal.reason;
  return { content: [{ type: 'text', text: answer }], stop_reason: 'end_turn' };
};

export function createAssistantButton(onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('data-desktop-ai-button', '');
  button.setAttribute('aria-label', 'Ouvrir l’assistant IA');
  button.setAttribute('title', 'Assistant IA');
  const mascot = document.createElement('img');
  mascot.src = blokMascot;
  mascot.alt = '';
  button.append(mascot);
  button.addEventListener('click', onClick);
  return button;
}

export function bindAssistantButton(button: HTMLButtonElement, panel: HTMLElement): MutationObserver {
  const sync = (): void => {
    const expanded = !panel.hidden;
    button.hidden = expanded && panel.getAttribute('data-blok-agent-mode') !== 'floating';
    button.setAttribute('aria-expanded', String(expanded));
    button.setAttribute('aria-label', expanded ? 'Fermer l’assistant IA' : 'Ouvrir l’assistant IA');
    button.title = expanded ? 'Fermer l’assistant IA' : 'Assistant IA';
  };
  const observer = new MutationObserver(sync);
  observer.observe(panel, { attributes: true, attributeFilter: ['hidden', 'data-blok-agent-mode'] });
  sync();
  return observer;
}
