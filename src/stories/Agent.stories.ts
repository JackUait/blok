/**
 * Shell/Agent — the host assistant beside a Blok editor.
 * Mod+J stays Blok's. This story opens the host panel and the provider dialog.
 */
import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { Blok } from '../blok';
import { mountAgentAssistant } from '../shell/agent-assistant';
import type { AgentAssistantHandle } from '../shell/agent-assistant';
import { createCliAgentModel, inspectCli } from '../shell/agent-model';
import { mountAgentSettings, preferredCommand } from '../shell/agent-settings';
import type { AgentSettingsHandle } from '../shell/agent-settings';
import { defaultTools } from './helpers';

import type { AgentModel, OutputData } from '@/types';

const live: {
  editor: Blok | null;
  assistant: AgentAssistantHandle | null;
  settings: AgentSettingsHandle | null;
} = { editor: null, assistant: null, settings: null };

const sample: OutputData = {
  time: Date.now(),
  version: '2.1.0',
  blocks: [
    {
      id: 'agent-page',
      type: 'paragraph',
      data: { text: 'Une page à relire avec l\'assistant.' },
    },
  ],
};

const shellModel: AgentModel = async (request) => {
  const [codex, claude] = await Promise.all([
    inspectCli('codex', request.signal),
    inspectCli('claude', request.signal),
  ]);
  const command = preferredCommand([codex, claude]);

  if (command === null) {
    return {
      content: [{ type: 'text', text: 'The CLI is not available.' }],
      stop_reason: 'end_turn',
    };
  }

  return createCliAgentModel({ command })(request);
};

const render = (): HTMLElement => {
  live.assistant?.destroy();
  live.settings?.destroy();

  const previous = live.editor;

  live.editor = null;

  if (previous !== null) {
    try {
      previous.destroy();
    } catch {
      // The previous story's editor may already be gone.
    }
  }

  const settings = mountAgentSettings();
  const host: { assistant: AgentAssistantHandle | null } = { assistant: null };
  const assistant = mountAgentAssistant({
    getPageText: () => host.assistant?.editorSlot.innerText ?? '',
    openSettings: () => {
      settings.open();
    },
  });

  host.assistant = assistant;
  const holder = document.createElement('div');

  holder.style.setProperty('min-height', '100%');
  assistant.editorSlot.append(holder);
  assistant.element.append(settings.element);

  const editor = new Blok({
    holder,
    tools: defaultTools,
    autofocus: false,
    data: sample,
    agent: {
      assistant: {
        model: shellModel,
        name: 'Assistant IA',
      },
    },
  });

  live.editor = editor;
  live.assistant = assistant;
  live.settings = settings;
  void editor.isReady.catch(() => undefined);

  return assistant.element;
};

const renderMode = (mode: 'side' | 'floating' | 'full'): HTMLElement => {
  localStorage.setItem('blok.shell.agent.panel-mode', mode);
  return render();
};

const meta: Meta = {
  title: 'Shell/Agent',
  parameters: { layout: 'fullscreen' },
  render,
};

export default meta;

type Story = StoryObj;

/** The assistant button, the panel, and the provider dialog around an editor. */
export const Assistant: Story = {
  render: () => renderMode('side'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const openButton = canvas.getByRole('button', { name: 'Ouvrir l\'assistant IA' });

    await waitFor(() => {
      expect(canvasElement.querySelector('[data-blok-editor]')).toBeTruthy();
    }, { timeout: 5000 });

    await userEvent.click(openButton);

    const panel = canvas.getByRole('dialog', { name: 'Assistant IA' });

    expect(panel).toBeTruthy();
    expect(within(panel).getByText('Comment puis-je t\'aider ?')).toBeTruthy();
    const lastSuggestion = within(panel).getByRole('button', { name: /Que manque-t-il dans cette page/ });
    const composer = panel.querySelector<HTMLElement>('[data-blok-agent-composer]')!;
    const gap = composer.getBoundingClientRect().top - lastSuggestion.getBoundingClientRect().bottom;

    expect(gap).toBeLessThanOrEqual(40);
    expect(composer.getBoundingClientRect().bottom).toBeLessThanOrEqual(panel.getBoundingClientRect().bottom);
  },
};

/** The same conversation floats over the page without shrinking the editor. */
export const Floating: Story = {
  render: () => renderMode('floating'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvasElement.querySelector('[data-blok-editor]')).toBeTruthy());
    await userEvent.click(canvas.getByRole('button', { name: 'Ouvrir l\'assistant IA' }));
    const panel = canvas.getByRole('dialog', { name: 'Assistant IA' });
    const composer = panel.querySelector('[data-blok-agent-composer]')!;
    expect(panel.getAttribute('data-blok-agent-mode')).toBe('floating');
    expect(composer.getBoundingClientRect().right).toBeLessThanOrEqual(panel.getBoundingClientRect().right);
    expect(composer.getBoundingClientRect().bottom).toBeLessThanOrEqual(panel.getBoundingClientRect().bottom);
  },
};

/** Full conversation view replaces the editor canvas while keeping it mounted. */
export const FullScreen: Story = {
  render: () => renderMode('full'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvasElement.querySelector('[data-blok-editor]')).toBeTruthy());
    await userEvent.click(canvas.getByRole('button', { name: 'Ouvrir l\'assistant IA' }));
    const panel = canvas.getByRole('region', { name: 'Assistant IA' });
    const editor = canvasElement.querySelector('[data-blok-agent-editor]');
    expect(panel.getAttribute('data-blok-agent-mode')).toBe('full');
    expect(editor).toBeTruthy();
    expect(getComputedStyle(editor!).display).toBe('none');
    const welcome = panel.querySelector('[data-blok-agent-empty]')!;
    const composer = panel.querySelector('[data-blok-agent-composer]')!;
    const suggestions = panel.querySelector('[data-blok-agent-suggestions]')!;
    const send = panel.querySelector<HTMLButtonElement>('[data-blok-agent-send]')!;
    expect(panel.hasAttribute('data-blok-agent-empty-view')).toBe(true);
    expect(suggestions.hasAttribute('hidden')).toBe(false);
    expect(welcome.getBoundingClientRect().bottom).toBeLessThan(composer.getBoundingClientRect().top);
    if (getComputedStyle(suggestions).display !== 'none') {
      expect(composer.getBoundingClientRect().bottom).toBeLessThan(suggestions.getBoundingClientRect().top);
    }
    expect(composer.getBoundingClientRect().bottom).toBeLessThanOrEqual(panel.getBoundingClientRect().bottom);
    expect(send.querySelector('svg')).toBeTruthy();
    expect(send.disabled).toBe(true);
  },
};

/** Conversation switcher state. */
export const History: Story = {
  render: () => renderMode('side'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvasElement.querySelector('[data-blok-editor]')).toBeTruthy());
    await userEvent.click(canvas.getByRole('button', { name: 'Ouvrir l\'assistant IA' }));
    await userEvent.click(canvas.getByRole('button', { name: /Historique/ }));
    expect(canvas.getByRole('menu', { name: '' })).toBeTruthy();
  },
};

/** Provider settings, shown separately so the assistant story opens on its main panel. */
export const Providers: Story = {
  render: () => renderMode('side'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const openButton = canvas.getByRole('button', { name: 'Ouvrir l\'assistant IA' });

    await waitFor(() => {
      expect(canvasElement.querySelector('[data-blok-editor]')).toBeTruthy();
    }, { timeout: 5000 });
    await userEvent.click(openButton);
    const panel = canvas.getByRole('dialog', { name: 'Assistant IA' });

    await userEvent.click(within(panel).getByRole('button', { name: 'Réglages de l\'assistant IA' }));

    const dialog = await waitFor(() => canvas.getByRole('dialog', { name: 'Paramètres' }));

    expect(within(dialog).getByRole('heading', { name: 'Providers IA' })).toBeTruthy();
    await waitFor(() => {
      expect(within(dialog).getAllByText('CLI non installée', { selector: '[data-blok-agent-status-label]' })).toHaveLength(2);
    });
  },
};
