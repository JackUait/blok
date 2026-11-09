import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect, userEvent, within } from 'storybook/test';

import {
  createChatActivity,
  createChatComposer,
  createChatMessage,
  createChatSuggestions,
  type ChatSuggestion,
} from '../shell/agent-chat';

const suggestions: ChatSuggestion[] = [
  { id: 'summary', label: 'Résumer cette page', icon: 'summary' },
  { id: 'insight', label: 'Trouver les points clés', icon: 'insight' },
  { id: 'question', label: 'Que manque-t-il dans cette page ?', icon: 'question' },
];

const palette = {
  dark: { background: '#161616', text: '#ececec', muted: '#a2a2a2', border: '#333333', hover: '#2a2a2a', accent: '#df6958', error: '#432825', errorBorder: '#844b42' },
  light: { background: '#ffffff', text: '#242424', muted: '#717171', border: '#e8e8e6', hover: '#ebebea', accent: '#d95f4b', error: '#fff4f1', errorBorder: '#e8b7ad' },
};

function surface(theme: 'dark' | 'light', width = 392): HTMLDivElement {
  const colors = palette[theme];
  const root = document.createElement('div');

  root.setAttribute('data-chat-story', theme);
  root.style.cssText = `box-sizing:border-box;width:min(${width}px,100%);min-height:620px;margin:24px auto;padding:24px 18px;background:${colors.background};color:${colors.text};font:14px Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;`;
  root.style.setProperty('--blok-popover-bg', colors.background);
  root.style.setProperty('--blok-text-primary', colors.text);
  root.style.setProperty('--blok-text-secondary', colors.muted);
  root.style.setProperty('--blok-popover-border', colors.border);
  root.style.setProperty('--blok-item-hover-bg', colors.hover);
  root.style.setProperty('--blok-icon-active-bg', colors.hover);
  root.style.setProperty('--blok-chat-accent', colors.accent);
  root.style.setProperty('--blok-chat-error-bg', colors.error);
  root.style.setProperty('--blok-chat-error-border', colors.errorBorder);

  return root;
}

function label(text: string): HTMLHeadingElement {
  const heading = document.createElement('h3');

  heading.textContent = text;
  heading.style.cssText = 'margin:0 0 20px;font-size:15px;font-weight:600';
  return heading;
}

function composer(onSend: (message: string) => void) {
  return createChatComposer({
    providers: [{ id: 'codex', label: 'Codex' }, { id: 'claude', label: 'Claude Code' }],
    selectedProvider: 'codex',
    onSend: (message) => onSend(message),
  });
}

const meta: Meta = {
  title: 'Shell/Agent/Composants chat',
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj;

export const Activite: Story = {
  render: () => {
    const root = surface('dark');
    const active = createChatActivity('Codex répond…');
    const settled = createChatActivity('Réponse terminée', false);

    root.append(label('Activité réelle'), active.element);
    settled.element.style.marginTop = '28px';
    root.append(settled.element);
    return root;
  },
  play: async ({ canvasElement }) => {
    const statuses = within(canvasElement).getAllByRole('status');

    expect(statuses).toHaveLength(2);
    expect(statuses[0]).toHaveAttribute('data-running');
    expect(statuses[1]).not.toHaveAttribute('data-running');
  },
};

/** Preview of status changes; production labels must come from actual model events. */
export const ApercuEtapes: Story = {
  render: () => {
    const root = surface('dark');
    const activity = createChatActivity('Analyse de la page…');
    const choices = document.createElement('div');

    choices.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:24px';
    ['Analyse de la page…', 'Recherche des points clés…', 'Rédaction de la réponse…'].forEach((text) => {
      const button = document.createElement('button');

      button.type = 'button';
      button.textContent = text;
      button.style.cssText = 'padding:7px 9px;border:1px solid #444;border-radius:7px;background:#252525;color:inherit;cursor:pointer';
      button.addEventListener('click', () => { activity.setLabel(text); activity.setRunning(true); });
      choices.append(button);
    });
    const finish = document.createElement('button');

    finish.type = 'button';
    finish.textContent = 'Terminer';
    finish.style.cssText = 'padding:7px 9px;border:1px solid #444;border-radius:7px;background:#252525;color:inherit;cursor:pointer';
    finish.addEventListener('click', () => { activity.setLabel('Réponse terminée'); activity.setRunning(false); });
    choices.append(finish);
    root.append(label('Aperçu des étapes'), activity.element, choices);
    return root;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const status = canvas.getByRole('status');

    await userEvent.click(canvas.getByRole('button', { name: 'Recherche des points clés…' }));
    expect(status).toHaveTextContent('Recherche des points clés…');
    expect(status).toHaveAttribute('data-running');
    await userEvent.click(canvas.getByRole('button', { name: 'Terminer' }));
    expect(status).toHaveTextContent('Réponse terminée');
    expect(status).not.toHaveAttribute('data-running');
  },
};

export const Conversation: Story = {
  render: () => {
    const root = surface('dark');
    const copied = document.createElement('output');

    copied.setAttribute('aria-live', 'polite');
    root.append(label('Conversation'),
      createChatMessage({ kind: 'user', text: 'Peux-tu résumer cette page ?' }),
      createChatMessage({
        kind: 'assistant', provider: 'Codex', time: '10:24',
        text: 'Cette page présente les objectifs du projet et les prochaines étapes.\n\nLe point à trancher : la date de livraison.',
        onCopy: () => { copied.textContent = 'Réponse copiée'; },
      }),
      createChatMessage({ kind: 'user', text: 'Et les risques ?' }),
      createChatActivity('Codex répond…').element,
      copied);
    return root;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole('button', { name: 'Copier' }));
    expect(canvas.getByText('Réponse copiée')).toBeTruthy();
    expect(canvasElement.querySelector('[data-blok-chat-activity]')).toHaveAttribute('data-running');
  },
};

export const Erreur: Story = {
  render: () => {
    const root = surface('light');
    const outcome = document.createElement('output');

    root.append(label('Échec et reprise'),
      createChatMessage({ kind: 'user', text: 'Résume la page.' }),
      createChatMessage({ kind: 'error', text: 'La connexion avec Codex a été interrompue.', onRetry: () => { outcome.textContent = 'Nouvel essai demandé'; } }),
      outcome);
    return root;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    expect(canvas.getByRole('alert')).toBeTruthy();
    await userEvent.click(canvas.getByRole('button', { name: 'Réessayer' }));
    expect(canvas.getByText('Nouvel essai demandé')).toBeTruthy();
  },
};

export const CompositeurEtSuggestions: Story = {
  render: () => {
    const root = surface('light');
    const result = document.createElement('output');
    const input = composer((message) => { result.textContent = `Envoyé : ${message}`; });
    const options = createChatSuggestions(suggestions, (suggestion) => input.setText(suggestion.label));

    root.append(label('Suggestions et message'), options, input.element, result);
    options.style.marginBottom = '18px';
    return root;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const send = canvas.getByRole('button', { name: 'Envoyer' });

    expect(send).toBeDisabled();
    await userEvent.click(canvas.getByRole('button', { name: 'Trouver les points clés' }));
    expect(canvas.getByRole('textbox', { name: 'Demander à l’assistant' })).toHaveValue('Trouver les points clés');
    expect(send).not.toBeDisabled();
    await userEvent.click(send);
    expect(canvas.getByText('Envoyé : Trouver les points clés')).toBeTruthy();
    await userEvent.click(canvas.getByRole('button', { name: 'Inclure cette page' }));
    expect(canvas.getByRole('button', { name: 'Inclure cette page' })).toHaveAttribute('aria-pressed', 'false');
  },
};

export const Etroit: Story = {
  render: () => {
    const root = surface('dark', 320);
    const input = composer(() => undefined);

    root.append(label('Panneau étroit · 320 px'),
      createChatMessage({ kind: 'user', text: 'Comment résumer cette partie sans perdre les points importants ?' }),
      createChatActivity('Codex répond…').element,
      input.element);
    return root;
  },
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<HTMLElement>('[data-chat-story]');
    const composerElement = canvasElement.querySelector<HTMLElement>('[data-blok-chat-composer]');

    if (!host || !composerElement) throw new Error('Le panneau et son compositeur doivent être présents.');

    expect(composerElement.getBoundingClientRect().right).toBeLessThanOrEqual(host.getBoundingClientRect().right + 1);
    expect(composerElement.getBoundingClientRect().left).toBeGreaterThanOrEqual(host.getBoundingClientRect().left - 1);
  },
};
