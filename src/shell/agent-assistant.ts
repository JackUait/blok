/**
 * Host chrome for the assistant: a button that opens a panel. The in-editor
 * Ask AI bar is Blok's. This panel calls the same CLI model and does not run
 * blok_* tools itself.
 */

import type { AgentModelMessage, AgentModelResponse } from '../../types/api';
import { createCliAgentModel, inspectCli, providerLabel, type CliCommand, type CliStatus } from './agent-model';
import { preferredCommand, readAgentSettings, subscribeAgentSettings } from './agent-settings';
import './agent-assistant.css';

export interface AgentAssistantOptions {
  /** Visible text of the open page, included when "Cette page" is checked. */
  getPageText: () => string;
  /** Closes the panel, then the host opens provider settings. */
  openSettings: () => void;
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
}

interface Conversation {
  id: string;
  turns: Turn[];
}

const MODE_KEY = 'blok.shell.agent.panel-mode';
const MIN_WIDTH = 320;
const MAX_WIDTH = 720;
const START_WIDTH = 360;

const SUGGESTIONS = [
  'Résumer cette page',
  'Trouver les points clés',
  'Que manque-t-il dans cette page ?',
] as const;

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

/**
 * The assistant button and its panel. Modes are remembered. Provider buttons
 * list only CLIs that are enabled, installed, and connected.
 */
export const mountAgentAssistant = (options: AgentAssistantOptions): AgentAssistantHandle => {
  const titleId = `blok-agent-title-${crypto.randomUUID()}`;
  const panelId = `blok-agent-panel-${crypto.randomUUID()}`;
  const shell = document.createElement('div');
  const bar = document.createElement('div');
  const toggle = makeButton('Ouvrir l\'assistant IA');
  const body = document.createElement('div');
  const editorSlot = document.createElement('div');
  const panel = document.createElement('div');
  const header = document.createElement('div');
  const title = document.createElement('h2');
  const historyButton = makeButton('Nouvelle conversation');
  const freshButton = makeButton('Nouvelle conversation');
  const modeButton = makeButton('Changer le mode du chat');
  const settingsButton = makeButton('Réglages de l\'assistant IA');
  const closeButton = makeButton('Fermer');
  const historyMenu = document.createElement('div');
  const modeMenu = document.createElement('div');
  const transcript = document.createElement('div');
  const composer = document.createElement('form');
  const field = document.createElement('textarea');
  const pageLabel = document.createElement('label');
  const pageBox = document.createElement('input');
  const providersHost = document.createElement('div');
  const sendButton = makeButton('Envoyer');
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
    run: null as AbortController | null,
    token: { id: 0 },
    inspect: null as AbortController | null,
  };

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
  composer.setAttribute('data-blok-agent-composer', '');
  field.setAttribute('aria-label', 'Demander à l\'assistant IA');
  field.setAttribute('placeholder', 'Demander à l\'IA…');
  field.rows = 3;
  pageBox.type = 'checkbox';
  pageBox.checked = true;
  pageLabel.append(pageBox, document.createTextNode(' Cette page'));
  providersHost.setAttribute('data-blok-agent-providers', '');
  sendButton.setAttribute('aria-label', 'Envoyer à l\'assistant IA');
  resize.setAttribute('data-blok-agent-resize', '');
  resize.setAttribute('role', 'separator');
  resize.setAttribute('aria-orientation', 'vertical');
  resize.setAttribute('aria-label', 'Largeur du panneau');
  resize.setAttribute('aria-valuemin', String(MIN_WIDTH));
  resize.setAttribute('aria-valuemax', String(MAX_WIDTH));
  resize.tabIndex = 0;
  header.append(historyButton, freshButton, modeButton, settingsButton, closeButton, historyMenu, modeMenu);
  composer.append(field, pageLabel, providersHost, sendButton);
  panel.append(resize, header, title, transcript, composer);
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

    if (last !== undefined && last.pending) last.pending = false;
  };

  const paintProviders = (usable: CliCommand[]): void => {
    providersHost.replaceChildren();

    if (usable.length === 0) {
      const empty = document.createElement('p');

      empty.setAttribute('data-blok-agent-providers-empty', '');
      empty.textContent = 'Connecte et active un provider dans les réglages.';
      providersHost.append(empty);

      return;
    }

    usable.forEach((command) => {
      const choice = document.createElement('button');
      const mark = document.createElement('span');
      const pressed = command === session.picked;

      choice.type = 'button';
      choice.setAttribute('data-blok-agent-provider', command);
      choice.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      mark.setAttribute('aria-hidden', 'true');
      mark.setAttribute('data-blok-agent-check', '');
      mark.textContent = pressed ? '✓' : '';
      choice.append(mark, document.createTextNode(providerLabel(command)));
      choice.addEventListener('click', () => {
        session.picked = command;
        paintProviders(usable);
      });
      providersHost.append(choice);
    });
  };

  const refreshProviders = async (): Promise<void> => {
    const gate = new AbortController();

    session.inspect?.abort();
    session.inspect = gate;

    const [codex, claude] = await Promise.all([
      inspectCli('codex', gate.signal, true),
      inspectCli('claude', gate.signal, true),
    ]);

    if (session.inspect !== gate) return;

    session.statuses = [codex, claude];

    const settings = readAgentSettings();
    const usable = settings.order.filter((command) => {
      const status = session.statuses.find((item) => item.command === command);

      return status !== undefined && status.installed && status.connected && settings.enabled[command];
    });

    if (session.picked !== null && !usable.includes(session.picked)) session.picked = null;
    if (session.picked === null) session.picked = preferredCommand(session.statuses);

    paintProviders(usable);
  };

  const paintHistory = (): void => {
    const conversation = current();

    historyButton.replaceChildren(document.createTextNode(conversation === undefined ? 'Nouvelle conversation' : historyLabel(conversation)));
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

    if (turns.length === 0) {
      const empty = document.createElement('div');
      const prompt = document.createElement('p');

      empty.setAttribute('data-blok-agent-empty', '');
      prompt.textContent = 'Comment puis-je t\'aider ?';
      empty.append(prompt);
      SUGGESTIONS.forEach((suggestion) => {
        const idea = makeButton(suggestion);

        idea.addEventListener('click', () => {
          send(suggestion);
        });
        empty.append(idea);
      });
      transcript.append(empty);

      return;
    }

    turns.forEach((turn) => {
      const article = document.createElement('article');
      const question = document.createElement('p');
      const who = document.createElement('p');

      article.setAttribute('data-blok-agent-turn', '');
      question.setAttribute('data-blok-agent-question', '');
      question.textContent = turn.question;
      who.setAttribute('data-blok-agent-who', '');
      who.textContent = providerLabel(turn.command);
      article.append(question, who);

      if (turn.pending) {
        const running = document.createElement('p');

        running.setAttribute('data-blok-agent-running', '');
        running.setAttribute('aria-live', 'polite');
        running.textContent = runningLabel(turn.command);
        article.append(running);
      } else if (turn.answer !== '') {
        const answer = document.createElement('p');
        const copy = makeButton('Copier la réponse');

        answer.setAttribute('data-blok-agent-answer', '');
        answer.textContent = turn.answer;
        copy.addEventListener('click', () => {
          const clipboard = navigator.clipboard;

          if (clipboard === undefined) return;

          void clipboard.writeText(turn.answer).catch(() => undefined);
        });
        article.append(answer, copy);
      }

      transcript.append(article);
    });
  };

  const render = (): void => {
    const openLabel = session.open ? 'Fermer l\'assistant IA' : 'Ouvrir l\'assistant IA';

    toggle.textContent = openLabel;
    toggle.setAttribute('aria-label', openLabel);
    toggle.setAttribute('aria-expanded', session.open ? 'true' : 'false');

    if (session.open) panel.removeAttribute('hidden');
    else panel.setAttribute('hidden', '');

    panel.setAttribute('data-blok-agent-mode', session.mode);
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

    sendButton.textContent = session.run === null ? 'Envoyer' : 'Arrêter la réponse';
    sendButton.setAttribute('aria-label', session.run === null ? 'Envoyer à l\'assistant IA' : 'Arrêter la réponse');
    paintHistory();
    paintMessages();
  };

  const composed = (question: string): string => {
    if (!pageBox.checked) return question;

    const page = options.getPageText().trim();

    return page === '' ? question : `${question}\n\nPage:\n${page}`;
  };

  const send = (question: string): void => {
    const text = question.trim();
    const command = session.picked;
    const conversation = current();

    if (text === '' || session.run !== null || command === null || conversation === undefined) return;

    const sent = composed(text);
    const turn: Turn = { question: text, sent, command, answer: '', pending: true };
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
    field.value = '';
    render();

    void createCliAgentModel({ command })({
      system: SYSTEM,
      messages: [...prior, { role: 'user', content: sent }],
      tools: [],
      signal: controller.signal,
    }).then((response) => {
      if (session.token !== token) return;

      turn.answer = answerOf(response);
      turn.pending = false;
      session.run = null;
      render();
    }, () => {
      if (session.token !== token) return;

      turn.pending = false;
      if (!controller.signal.aborted) turn.answer = 'The CLI is not available.';
      session.run = null;
      render();
    });
  };

  const open = (): void => {
    session.open = true;
    render();
    void refreshProviders();
    field.focus();
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
  composer.addEventListener('submit', (event) => {
    event.preventDefault();
    if (session.run !== null) {
      stopRun();
      render();

      return;
    }

    send(field.value);
  });
  field.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;

    event.preventDefault();
    if (session.run !== null) return;

    send(field.value);
  });
  sendButton.addEventListener('click', () => {
    if (session.run !== null) {
      stopRun();
      render();

      return;
    }

    send(field.value);
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
