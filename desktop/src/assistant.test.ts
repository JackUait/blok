import { describe, expect, it } from 'vitest';
import { askAssistant, bindAssistantButton, createAssistantButton } from './assistant';

describe('desktop AI trigger', () => {
  it('stays available beside the floating panel and closes it', async () => {
    const panel = document.createElement('div');
    panel.hidden = true;
    panel.setAttribute('data-blok-agent-mode', 'floating');
    const button = createAssistantButton(() => { panel.hidden = !panel.hidden; });
    const observer = bindAssistantButton(button, panel);

    expect(button.hidden).toBe(false);
    expect(button.getAttribute('aria-label')).toBe('Ouvrir l’assistant IA');
    button.click();
    await Promise.resolve();
    expect(button.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('Fermer l’assistant IA');
    button.click();
    await Promise.resolve();
    expect(panel.hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');

    panel.hidden = false;
    panel.setAttribute('data-blok-agent-mode', 'full');
    await Promise.resolve();
    expect(button.hidden).toBe(true);
    observer.disconnect();
  });
});

describe('desktop AI request', () => {
  it('sends cancellation to Tauri for the active CLI process', async () => {
    const previous = (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    const calls: { command: string; args: Record<string, unknown> | undefined }[] = [];
    let rejectAsk: ((error: Error) => void) | undefined;

    Object.assign(window, {
      __TAURI_INTERNALS__: {
        transformCallback: () => 1,
        invoke: (command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          if (command === 'agent_ask') return new Promise<string>((_resolve, reject) => { rejectAsk = reject; });
          if (command === 'agent_cancel') {
            rejectAsk?.(new Error('Réponse arrêtée'));
            return Promise.resolve();
          }
          return Promise.reject(new Error(`Unexpected command: ${command}`));
        },
      },
    });

    try {
      const controller = new AbortController();
      const request = askAssistant('codex', 'Bonjour', '', undefined, controller.signal);

      controller.abort();
      await expect(request).rejects.toThrow('Réponse arrêtée');
      expect(calls.map((call) => call.command)).toEqual(['agent_ask', 'agent_cancel']);
      expect(calls[1]?.args?.runId).toBe(calls[0]?.args?.runId);
    } finally {
      if (previous === undefined) Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
      else Object.assign(window, { __TAURI_INTERNALS__: previous });
    }
  });
});
