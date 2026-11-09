import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import type { AgentModelResponse } from '../../types/api';
import { mountAgentAssistant, type AgentAssistantHandle } from '../shell/agent-assistant';
import type { CliCommand } from '../shell/agent-model';

type Mode = 'side' | 'floating' | 'full';

const live: {
  assistant: AgentAssistantHandle | null;
  resolve: ((response: AgentModelResponse) => void) | null;
  reject: ((reason: Error) => void) | null;
} = { assistant: null, resolve: null, reject: null };

const renderMode = (mode: Mode): HTMLElement => {
  live.assistant?.destroy();
  live.assistant = null;
  live.resolve = null;
  live.reject = null;
  localStorage.setItem('blok.shell.agent.panel-mode', mode);

  const assistant = mountAgentAssistant({
    getPageText: () => 'Le projet Blok prépare un espace de travail partagé.',
    openSettings: () => undefined,
    inspectProvider: async (command: CliCommand) => ({ command, installed: true, connected: true, version: 'story' }),
    modelFor: (_command, onProgress) => async ({ signal }) => {
      onProgress('Codex analyse la demande…');
      return await new Promise<AgentModelResponse>((resolve, reject) => {
        live.resolve = resolve;
        live.reject = reject;
        signal.addEventListener('abort', () => reject(new Error('Réponse arrêtée')), { once: true });
      });
    },
  });

  assistant.element.style.cssText = 'height:700px;--blok-popover-bg:#161616;--blok-text-primary:#ececec;--blok-text-secondary:#a2a2a2;--blok-popover-border:#303030;--blok-item-hover-bg:#2a2a2a;--blok-icon-active-bg:#2a2a2a;--blok-bg-light:#262626;--blok-font-sans:Inter,-apple-system,sans-serif;--blok-focus-ring:#7eaefa';
  const page = document.createElement('div');

  page.style.cssText = 'padding:40px;color:#ececec';
  page.textContent = 'Page Blok ouverte';
  assistant.editorSlot.append(page);
  assistant.open();
  live.assistant = assistant;
  return assistant.element;
};

const reply = (text: string): AgentModelResponse => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });

const meta: Meta = {
  title: 'Shell/Agent/Conversation intégrée',
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj;

export const Reponse: Story = {
  render: () => renderMode('side'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByRole('textbox', { name: 'Demander à l’assistant' });

    await waitFor(() => expect(canvas.getByRole('combobox', { name: 'Moteur IA' })).toHaveValue('codex'));
    await userEvent.type(field, 'Résume cette page');
    await userEvent.click(canvas.getByRole('button', { name: 'Envoyer à l\'assistant IA' }));
    await waitFor(() => expect(canvas.getByRole('status')).toHaveTextContent('Codex analyse la demande…'));
    live.resolve?.(reply('Cette page présente un espace de travail partagé pour Blok.'));
    await waitFor(() => expect(canvas.getByText('Cette page présente un espace de travail partagé pour Blok.')).toBeTruthy());
    expect(canvas.getByRole('button', { name: 'Copier' })).toBeTruthy();
  },
};

export const EnCours: Story = {
  render: () => renderMode('floating'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByRole('combobox', { name: 'Moteur IA' })).toHaveValue('codex'));
    await userEvent.type(canvas.getByRole('textbox', { name: 'Demander à l’assistant' }), 'Quels sont les points clés ?');
    await userEvent.click(canvas.getByRole('button', { name: 'Envoyer à l\'assistant IA' }));
    expect(canvas.getByRole('status')).toHaveTextContent('Codex analyse la demande…');
    expect(canvas.getByRole('button', { name: 'Arrêter la réponse' })).toBeTruthy();
  },
};

export const EchecEtReprise: Story = {
  render: () => renderMode('side'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByRole('combobox', { name: 'Moteur IA' })).toHaveValue('codex'));
    await userEvent.type(canvas.getByRole('textbox', { name: 'Demander à l’assistant' }), 'Relis la page');
    await userEvent.click(canvas.getByRole('button', { name: 'Envoyer à l\'assistant IA' }));
    live.reject?.(new Error('Connexion interrompue'));
    await waitFor(() => expect(canvas.getByRole('alert')).toHaveTextContent('Connexion interrompue'));
    await userEvent.click(canvas.getByRole('button', { name: 'Réessayer' }));
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Arrêter la réponse' })).toBeTruthy());
  },
};

export const PleinePage: Story = {
  render: () => renderMode('full'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const composer = canvasElement.querySelector<HTMLElement>('[data-blok-agent-composer]');
    const panel = canvasElement.querySelector<HTMLElement>('[data-blok-agent-panel]');

    if (!composer || !panel) throw new Error('Le panneau et son compositeur doivent être présents.');
    expect(composer.getBoundingClientRect().bottom).toBeLessThanOrEqual(panel.getBoundingClientRect().bottom);
    expect(canvas.getByRole('button', { name: 'Résumer cette page' })).toBeTruthy();
  },
};
