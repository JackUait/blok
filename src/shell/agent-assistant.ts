/**
 * Host chrome for the assistant: a button that opens a panel. The in-editor
 * Ask AI bar is Blok's. This panel calls the same CLI model and does not run
 * blok_* tools itself.
 */

import type { AgentModel, AgentModelMessage, AgentModelResponse } from '../../types/api';
import blokMascot from '../../docs/public/logo-no-sign.png';
import { createChatActivity, createChatComposer, createChatMessage, createChatSuggestions, type ChatSuggestion } from './agent-chat';
import { chatIcon, type ChatIcon } from './agent-chat/icons';
import './agent-chat/styles.css';
import { createCliAgentModel, inspectCli, providerLabel, type CliCommand, type CliStatus } from './agent-model';
import { readAgentSettings, subscribeAgentSettings } from './agent-settings';
import './agent-assistant.css';

export interface AgentAssistantOptions {
  /** Visible text of the open page, included when "Cette page" is checked. */
  getPageText: () => string;
  /** Closes the panel, then the host opens provider settings. */
  openSettings: () => void;
  /** Host-specific provider inspection, e.g. Tauri's native CLI bridge. */
  inspectProvider?: (command: CliCommand, signal: AbortSignal) => Promise<CliStatus>;
  /** Host-specific model, leaving the Node CLI adapter as the default. */
  modelFor?: (command: CliCommand, onProgress: (status: string) => void) => AgentModel;
  /** Preferred connected provider when this panel opens. */
  preferredProvider?: () => CliCommand | null;
}

export interface AgentAssistantHandle {
  element: HTMLElement;
  editorSlot: HTMLElement;
  open: () => void;
  close: () => void;
  destroy: () => void;
}

type PanelMode = 'side' | 'floating' | 'full';

interface Turn {
  question: string;
  sent: string;
  command: CliCommand;
  answer: string;
  pending: boolean;
  error?: boolean;
  cancelled?: boolean;
  status?: string;
}

interface Conversation {
  id: string;
  turns: Turn[];
}

const MODE_KEY = 'blok.shell.agent.panel-mode';
const MIN_WIDTH = 320;
const MAX_WIDTH = 720;
const START_WIDTH = 392;

const SUGGESTIONS: readonly ChatSuggestion[] = [
  { id: 'summary', label: 'Résumer cette page', icon: 'summary' },
  { id: 'insight', label: 'Trouver les points clés', icon: 'insight' },
  { id: 'question', label: 'Que manque-t-il dans cette page ?', icon: 'question' },
];

const MODES: readonly { id: PanelMode; label: string }[] = [
  { id: 'side', label: 'Panneau latéral' },
  { id: 'floating', label: 'Fenêtre flottante' },
  { id: 'full', label: 'Plein écran' },
];

const SYSTEM = [
  'You are the writing assistant beside a Blok page.',
  'Reply in the user\'s language, in plain text.',
  'Do not claim you edited the page.',
].join('\n');

const readMode = (): PanelMode => {
  try {
    const value = localStorage.getItem(MODE_KEY);

    if (value === 'floating' || value === 'full' || value === 'side') return value;
  } catch {
    // Private mode starts on the side panel.
  }

  return 'side';
};

const writeMode = (mode: PanelMode): void => {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // The choice still applies to this page.
  }
};

const clampWidth = (value: number): number => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value));

const historyLabel = (conversation: Conversation): string => {
  const first = conversation.turns.find((turn) => turn.question.trim() !== '');

  if (first === undefined) return 'Nouvelle conversation';

  const trimmed = first.question.trim().replace(/\s+/g, ' ');

  return trimmed.length > 48 ? `${trimmed.slice(0, 47)}…` : trimmed;
};

const answerOf = (response: AgentModelResponse): string => response.content
  .map((block) => (block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
  .filter((text) => text.trim() !== '')
  .join('\n')
  .trim();

const runningLabel = (command: CliCommand): string => (
  command === 'codex' ? 'Codex répond…' : 'Claude Code répond…'
);

const makeButton = (label: string): HTMLButtonElement => {
  const node = document.createElement('button');

  node.type = 'button';
  node.textContent = label;

  return node;
};

const iconButton = (node: HTMLButtonElement, label: string, icon: ChatIcon): void => {
  node.setAttribute('aria-label', label);
  node.setAttribute('title', label);
  node.replaceChildren(chatIcon(icon));
};

/**
 * The assistant button and its panel. Modes are remembered. Provider buttons
 * list only CLIs that are enabled, installed, and connected.
 */
export const mountAgentAssistant = (options: AgentAssistantOptions): AgentAssistantHandle => {
  const titleId = `blok-agent-title-${crypto.randomUUID()}`;
  const panelId = `blok-agent-panel-${crypto.randomUUID()}`;
  const shell = document.createElement('div');
  const bar = document.createElement('div');
  const toggle = makeButton('Assistant IA');
  const body = document.createElement('div');
  const editorSlot = document.createElement('div');
  const panel = document.createElement('div');
  const header = document.createElement('div');
  const title = document.createElement('h2');
  const titleIcon = document.createElement('img');
  const historyButton = makeButton('Nouvelle conversation');
  const freshButton = makeButton('Nouvelle conversation');
  const modeButton = makeButton('Changer le mode du chat');
  const settingsButton = makeButton('Réglages de l\'assistant IA');
  const closeButton = makeButton('Fermer');
  const historyMenu = document.createElement('div');
  const modeMenu = document.createElement('div');
  const transcript = document.createElement('div');
  const composerSlot = document.createElement('div');
  const providerHint = document.createElement('p');
  const fullSuggestions = document.createElement('div');
  const resize = document.createElement('div');
  const session = {
    open: false,
    mode: readMode(),
    width: START_WIDTH,
    menu: null as 'history' | 'mode' | null,
    conversations: [{ id: crypto.randomUUID(), turns: [] }] as Conversation[],
    active: 0,
    picked: null as CliCommand | null,
    statuses: [] as CliStatus[],
    includePage: true,
    run: null as AbortController | null,
    token: { id: 0 },
    inspect: null as AbortController | null,
  };
  const composerHandle = createChatComposer({
    providers: [],
    includePage: session.includePage,
    sendLabel: 'Envoyer à l\'assistant IA',
    onSend: (message, provider, includePage) => {
      session.picked = provider === 'claude' ? 'claude' : 'codex';
      session.includePage = includePage;
      send(message);
    },
    onStop: () => { stopRun(); render(); },
    onProviderChange: (provider) => { session.picked = provider === 'claude' ? 'claude' : 'codex'; },
    onContextChange: (includePage) => { session.includePage = includePage; },
  });
  const composer = composerHandle.element;
  const sendButton = composerHandle.submit;

  shell.setAttribute('data-blok-agent-shell', '');
  bar.setAttribute('data-blok-agent-bar', '');
  toggle.setAttribute('data-blok-agent-toggle', '');
  toggle.setAttribute('aria-haspopup', 'dialog');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', panelId);
  body.setAttribute('data-blok-agent-body', '');
  editorSlot.setAttribute('data-blok-agent-editor', '');
  panel.id = panelId;
  panel.setAttribute('data-blok-agent-panel', '');
  // Non-modal: the page editor stays reachable beside the panel, Escape closes
  // only the panel, and typing in the page is the point of "Cette page".
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', titleId);
  panel.setAttribute('hidden', '');
  header.setAttribute('data-blok-agent-header', '');
  title.id = titleId;
  title.textContent = 'Assistant IA';
  titleIcon.src = blokMascot;
  titleIcon.alt = '';
  titleIcon.setAttribute('data-blok-agent-title-icon', '');
  iconButton(historyButton, 'Historique', 'history');
  iconButton(freshButton, 'Nouvelle conversation', 'plus');
  iconButton(modeButton, 'Changer le mode du chat', 'panel');
  iconButton(settingsButton, 'Réglages de l\'assistant IA', 'settings');
  iconButton(closeButton, 'Fermer', 'close');
  historyButton.setAttribute('data-blok-agent-history', '');
  historyButton.setAttribute('aria-haspopup', 'menu');
  historyButton.setAttribute('aria-expanded', 'false');
  freshButton.setAttribute('data-blok-agent-new', '');
  modeButton.setAttribute('aria-haspopup', 'menu');
  modeButton.setAttribute('aria-expanded', 'false');
  historyMenu.setAttribute('data-blok-agent-menu', 'history');
  historyMenu.setAttribute('role', 'menu');
  historyMenu.setAttribute('hidden', '');
  modeMenu.setAttribute('data-blok-agent-menu', 'mode');
  modeMenu.setAttribute('role', 'menu');
  modeMenu.setAttribute('hidden', '');
  transcript.setAttribute('data-blok-agent-transcript', '');
  composerSlot.setAttribute('data-blok-agent-composer', '');
  providerHint.setAttribute('data-blok-agent-providers-empty', '');
  providerHint.textContent = 'Connecte et active un provider dans les réglages.';
  providerHint.hidden = true;
  composerSlot.append(composer, providerHint);
  fullSuggestions.setAttribute('data-blok-agent-suggestions', '');
  fullSuggestions.hidden = true;
  sendButton.setAttribute('data-blok-agent-send', '');
  resize.setAttribute('data-blok-agent-resize', '');
  resize.setAttribute('role', 'separator');
  resize.setAttribute('aria-orientation', 'vertical');
  resize.setAttribute('aria-label', 'Largeur du panneau');
  resize.setAttribute('aria-valuemin', String(MIN_WIDTH));
  resize.setAttribute('aria-valuemax', String(MAX_WIDTH));
  resize.tabIndex = 0;
  header.append(titleIcon, title, historyButton, freshButton, modeButton, settingsButton, closeButton, historyMenu, modeMenu);
  panel.append(resize, header, transcript, composerSlot, fullSuggestions);
  body.append(editorSlot, panel);
  bar.append(toggle);
  shell.append(bar, body);

  MODES.forEach((mode) => {
    const item = document.createElement('button');
    const mark = document.createElement('span');

    item.type = 'button';
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('data-blok-agent-mode-option', mode.id);
    mark.setAttribute('aria-hidden', 'true');
    mark.setAttribute('data-blok-agent-check', '');
    item.append(mark, document.createTextNode(mode.label));
    item.addEventListener('click', () => {
      session.mode = mode.id;
      session.menu = null;
      writeMode(mode.id);
      render();
    });
    modeMenu.append(item);
  });

  const current = (): Conversation | undefined => session.conversations[session.active];

  const stopRun = (): void => {
    session.token = { id: session.token.id + 1 };
    session.run?.abort();
    session.run = null;

    const conversation = current();
    const last = conversation?.turns[conversation.turns.length - 1];

    if (last !== undefined && last.pending) {
      last.pending = false;
      last.cancelled = true;
    }
  };

  const paintProviders = (usable: CliCommand[]): void => {
    composerHandle.setProviders(usable.map((command) => ({ id: command, label: providerLabel(command) })), session.picked ?? undefined);
    providerHint.hidden = usable.length > 0;
  };

  const refreshProviders = async (): Promise<void> => {
    const gate = new AbortController();

    session.inspect?.abort();
    session.inspect = gate;

    const inspect = options.inspectProvider ?? ((command: CliCommand, signal: AbortSignal) => inspectCli(command, signal, true));
    const [codex, claude] = await Promise.all([
      inspect('codex', gate.signal),
      inspect('claude', gate.signal),
    ]);

    if (session.inspect !== gate) return;

    session.statuses = [codex, claude];

    const settings = readAgentSettings();
    const usable = settings.order.filter((command) => {
      const status = session.statuses.find((item) => item.command === command);

      return status !== undefined && status.installed && status.connected && settings.enabled[command];
    });

    if (session.picked !== null && !usable.includes(session.picked)) session.picked = null;
    if (session.picked === null) {
      const preferred = options.preferredProvider?.();
      session.picked = preferred !== undefined && preferred !== null && usable.includes(preferred)
        ? preferred : usable[0] ?? null;
    }

    paintProviders(usable);
  };

  const paintHistory = (): void => {
    const conversation = current();

    const label = conversation === undefined ? 'Nouvelle conversation' : historyLabel(conversation);

    historyButton.setAttribute('aria-label', `Historique : ${label}`);
    historyButton.title = `Historique : ${label}`;
    historyMenu.replaceChildren();
    session.conversations.forEach((item, index) => {
      const row = document.createElement('button');
      const mark = document.createElement('span');
      const selected = index === session.active;

      row.type = 'button';
      row.setAttribute('role', 'menuitemradio');
      row.setAttribute('aria-checked', selected ? 'true' : 'false');
      mark.setAttribute('aria-hidden', 'true');
      mark.setAttribute('data-blok-agent-check', '');
      mark.textContent = selected ? '✓' : '';
      row.append(mark, document.createTextNode(historyLabel(item)));
      row.addEventListener('click', () => {
        stopRun();
        session.active = index;
        session.menu = null;
        render();
      });
      historyMenu.append(row);
    });
  };

  const paintMessages = (): void => {
    const conversation = current();
    const turns = conversation?.turns ?? [];

    transcript.replaceChildren();
    fullSuggestions.replaceChildren();
    const fullWelcome = session.mode === 'full' && turns.length === 0;
    fullSuggestions.hidden = !fullWelcome;

    if (turns.length === 0) {
      const empty = document.createElement('div');
      const mark = document.createElement('span');
      const mascot = document.createElement('img');
      const prompt = document.createElement('p');
      const intro = document.createElement('span');
      const ideas = createChatSuggestions(SUGGESTIONS, (suggestion) => send(suggestion.label));

      empty.setAttribute('data-blok-agent-empty', '');
      mark.setAttribute('data-blok-agent-empty-mark', '');
      mark.setAttribute('aria-hidden', 'true');
      mascot.src = blokMascot;
      mascot.alt = '';
      mark.append(mascot);
      prompt.textContent = 'Comment puis-je t\'aider ?';
      intro.setAttribute('data-blok-agent-empty-intro', '');
      intro.textContent = 'Une question sur ta page ? Commence par une idée.';
      empty.append(mark, prompt, intro);
      (fullWelcome ? fullSuggestions : empty).append(ideas);
      transcript.append(empty);

      return;
    }

    turns.forEach((turn) => {
      const article = document.createElement('div');

      article.setAttribute('data-blok-agent-turn', '');
      article.append(createChatMessage({ kind: 'user', text: turn.question }));

      if (turn.pending) {
        const running = createChatActivity(turn.status ?? runningLabel(turn.command)).element;

        running.setAttribute('data-blok-agent-running', '');
        article.append(running);
      } else if (turn.error) {
        article.append(createChatMessage({
          kind: 'error',
          text: turn.answer,
          onRetry: () => send(turn.question),
        }));
      } else if (turn.answer !== '') {
        article.append(createChatMessage({
          kind: 'assistant',
          text: turn.answer,
          provider: providerLabel(turn.command),
          onCopy: () => {
            const clipboard = navigator.clipboard;

            if (clipboard) void clipboard.writeText(turn.answer).catch(() => undefined);
          },
        }));
      } else if (turn.cancelled) {
        article.append(createChatActivity('Réponse arrêtée', false).element);
      }

      transcript.append(article);
    });
    transcript.scrollTop = transcript.scrollHeight;
  };

  const render = (): void => {
    const openLabel = session.open ? 'Fermer l\'assistant IA' : 'Ouvrir l\'assistant IA';

    toggle.textContent = 'Assistant IA';
    toggle.setAttribute('aria-label', openLabel);
    toggle.setAttribute('aria-expanded', session.open ? 'true' : 'false');

    if (session.open) panel.removeAttribute('hidden');
    else panel.setAttribute('hidden', '');

    panel.setAttribute('data-blok-agent-mode', session.mode);
    panel.toggleAttribute('data-blok-agent-empty-view', current()?.turns.length === 0);
    panel.setAttribute('role', session.mode === 'full' ? 'region' : 'dialog');
    panel.style.setProperty('--blok-agent-width', `${session.width}px`);
    resize.setAttribute('aria-valuenow', String(session.width));

    if (session.open && session.mode === 'side') resize.removeAttribute('hidden');
    else resize.setAttribute('hidden', '');

    historyButton.setAttribute('aria-expanded', session.menu === 'history' ? 'true' : 'false');
    modeButton.setAttribute('aria-expanded', session.menu === 'mode' ? 'true' : 'false');

    if (session.menu === 'history') historyMenu.removeAttribute('hidden');
    else historyMenu.setAttribute('hidden', '');

    if (session.menu === 'mode') modeMenu.removeAttribute('hidden');
    else modeMenu.setAttribute('hidden', '');

    modeMenu.querySelectorAll('[data-blok-agent-mode-option]').forEach((node) => {
      if (!(node instanceof HTMLElement)) return;

      const selected = node.getAttribute('data-blok-agent-mode-option') === session.mode;
      const mark = node.querySelector('[data-blok-agent-check]');

      node.setAttribute('aria-checked', selected ? 'true' : 'false');
      if (mark !== null) mark.textContent = selected ? '✓' : '';
    });

    composerHandle.setRunning(session.run !== null);
    paintHistory();
    paintMessages();
  };

  const composed = (question: string): string => {
    if (!session.includePage) return question;

    const page = options.getPageText().trim();

    return page === '' ? question : `${question}\n\nPage:\n${page}`;
  };

  const send = (question: string): void => {
    const text = question.trim();
    const command = session.picked;
    const conversation = current();

    if (text === '' || session.run !== null || command === null || conversation === undefined) return;

    const sent = composed(text);
    const turn: Turn = { question: text, sent, command, answer: '', pending: true, status: runningLabel(command) };
    const prior: AgentModelMessage[] = conversation.turns.flatMap((item) => (
      item.pending || item.answer === ''
        ? []
        : [
          { role: 'user' as const, content: item.sent },
          { role: 'assistant' as const, content: item.answer },
        ]
    ));
    const controller = new AbortController();
    const token = { id: session.token.id + 1 };

    conversation.turns.push(turn);
    session.run = controller;
    session.token = token;
    session.menu = null;
    composerHandle.setText('');
    render();

    const model = options.modelFor?.(command, (status) => {
      if (session.token !== token || !turn.pending || turn.status === status) return;

      turn.status = status;
      paintMessages();
    }) ?? createCliAgentModel({ command });
    void model({
      system: SYSTEM,
      messages: [...prior, { role: 'user', content: sent }],
      tools: [],
      signal: controller.signal,
    }).then((response) => {
      if (session.token !== token) return;

      turn.answer = answerOf(response);
      turn.pending = false;
      turn.error = false;
      session.run = null;
      render();
    }, (error: unknown) => {
      if (session.token !== token) return;

      turn.pending = false;
      if (!controller.signal.aborted) {
        turn.answer = error instanceof Error ? error.message : String(error);
        turn.error = true;
      }
      session.run = null;
      render();
    });
  };

  const open = (): void => {
    session.open = true;
    session.picked = null;
    render();
    void refreshProviders();
    composerHandle.focus();
  };

  const close = (): void => {
    session.open = false;
    session.menu = null;
    render();
  };

  toggle.addEventListener('click', () => {
    if (session.open) close();
    else open();
  });
  closeButton.addEventListener('click', close);
  freshButton.addEventListener('click', () => {
    const conversation = current();

    if (conversation !== undefined && conversation.turns.length > 0) {
      stopRun();
      session.conversations.push({ id: crypto.randomUUID(), turns: [] });
      session.active = session.conversations.length - 1;
    }

    session.menu = null;
    render();
  });
  historyButton.addEventListener('click', () => {
    session.menu = session.menu === 'history' ? null : 'history';
    render();
  });
  modeButton.addEventListener('click', () => {
    session.menu = session.menu === 'mode' ? null : 'mode';
    render();
  });
  settingsButton.addEventListener('click', () => {
    close();
    options.openSettings();
  });
  const onPointerDown = (event: PointerEvent): void => {
    if (session.mode !== 'side' || !session.open) return;

    const startX = event.clientX;
    const startWidth = session.width;
    const move = (ev: PointerEvent): void => {
      session.width = clampWidth(startWidth + startX - ev.clientX);
      panel.style.setProperty('--blok-agent-width', `${session.width}px`);
      resize.setAttribute('aria-valuenow', String(session.width));
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };

    event.preventDefault();
    resize.setPointerCapture(event.pointerId);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  resize.addEventListener('pointerdown', onPointerDown);
  resize.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

    event.preventDefault();
    const delta = event.key === 'ArrowLeft' ? 16 : -16;

    session.width = clampWidth(session.width + delta);
    panel.style.setProperty('--blok-agent-width', `${session.width}px`);
    resize.setAttribute('aria-valuenow', String(session.width));
  });

  const onPointerAway = (event: Event): void => {
    if (session.menu === null) return;

    const target = event.target;

    if (!(target instanceof Node)) return;
    if (historyMenu.contains(target) || modeMenu.contains(target) || historyButton.contains(target) || modeButton.contains(target)) return;

    session.menu = null;
    render();
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !session.open) return;

    event.preventDefault();
    event.stopPropagation();

    if (session.menu !== null) {
      session.menu = null;
      render();

      return;
    }

    close();
  };

  document.addEventListener('pointerdown', onPointerAway);
  document.addEventListener('keydown', onKey);

  const unsubscribe = subscribeAgentSettings(() => {
    void refreshProviders();
  });

  render();
  void refreshProviders();

  return {
    element: shell,
    editorSlot,
    open,
    close,
    destroy: () => {
      stopRun();
      session.inspect?.abort();
      unsubscribe();
      document.removeEventListener('pointerdown', onPointerAway);
      document.removeEventListener('keydown', onKey);
      shell.remove();
    },
  };
};
