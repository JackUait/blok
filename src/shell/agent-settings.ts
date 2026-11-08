/**
 * Provider settings for the host assistant. Order, the enabled flag, and the
 * default provider are the only values stored. Login output is never saved.
 */

import {
  CLI_COMMANDS,
  inspectCli,
  invalidateCli,
  providerLabel,
  startCliLogin,
  type CliCommand,
  type CliStatus,
} from './agent-model';
import './agent-settings.css';

export interface AgentSettingsState {
  order: CliCommand[];
  enabled: Record<CliCommand, boolean>;
  defaultProviderId: CliCommand | null;
}

export interface AgentSettingsHandle {
  element: HTMLElement;
  open: () => void;
  close: () => void;
  destroy: () => void;
}

const STORAGE_KEY = 'blok.shell.agent.settings';

const isCommand = (value: unknown): value is CliCommand => value === 'codex' || value === 'claude';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const defaultState = (): AgentSettingsState => ({
  order: [...CLI_COMMANDS],
  enabled: { codex: true, claude: true },
  defaultProviderId: null,
});

const parseOrder = (value: unknown): CliCommand[] => {
  const listed = Array.isArray(value) ? value.filter(isCommand) : [];
  const missing = CLI_COMMANDS.filter((command) => !listed.includes(command));

  return [...listed, ...missing];
};

const parseState = (value: unknown): AgentSettingsState => {
  if (!isRecord(value)) return defaultState();

  const enabledRecord = isRecord(value.enabled) ? value.enabled : {};

  return {
    order: parseOrder(value.order),
    enabled: {
      codex: enabledRecord.codex !== false,
      claude: enabledRecord.claude !== false,
    },
    defaultProviderId: isCommand(value.defaultProviderId) ? value.defaultProviderId : null,
  };
};

const listeners = new Set<() => void>();

const emit = (): void => {
  listeners.forEach((listener) => {
    listener();
  });
};

export const readAgentSettings = (): AgentSettingsState => {
  try {
    return parseState(parseJson(localStorage.getItem(STORAGE_KEY) ?? ''));
  } catch {
    return defaultState();
  }
};

const writeAgentSettings = (state: AgentSettingsState): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      order: state.order,
      enabled: state.enabled,
      defaultProviderId: state.defaultProviderId,
    }));
  } catch {
    // Private mode keeps the choice for this page only.
  }

  emit();
};

export const updateAgentSettings = (change: (state: AgentSettingsState) => AgentSettingsState): void => {
  writeAgentSettings(change(readAgentSettings()));
};

export const subscribeAgentSettings = (listener: () => void): (() => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

/** The enabled, installed, connected provider the host should call. */
export const preferredCommand = (statuses: readonly CliStatus[]): CliCommand | null => {
  const settings = readAgentSettings();
  const usable = settings.order.filter((command) => {
    const status = statuses.find((item) => item.command === command);

    return status !== undefined && status.installed && status.connected && settings.enabled[command];
  });

  if (usable.length === 0) return null;
  if (settings.defaultProviderId !== null && usable.includes(settings.defaultProviderId)) return settings.defaultProviderId;

  return usable[0] ?? null;
};

const swap = (order: readonly CliCommand[], from: number, to: number): CliCommand[] => {
  if (to < 0 || to >= order.length) return [...order];

  const next = [...order];
  const moving = next[from];
  const displaced = next[to];

  if (moving === undefined || displaced === undefined) return [...order];

  next[from] = displaced;
  next[to] = moving;

  return next;
};

const statusText = (status: CliStatus | undefined): string => {
  if (status === undefined || !status.installed) return 'CLI non installée';

  return status.connected ? 'Connecté' : 'Connexion nécessaire';
};

const button = (label: string, name: string): HTMLButtonElement => {
  const node = document.createElement('button');

  node.type = 'button';
  node.setAttribute('aria-label', name);
  node.textContent = label;

  return node;
};

/**
 * The Paramètres dialog. Escape and Fermer close it. Connecting streams the
 * CLI into the dialog and does not persist that stream.
 */
export const mountAgentSettings = (): AgentSettingsHandle => {
  const titleId = `blok-agent-settings-${crypto.randomUUID()}`;
  const dialog = document.createElement('div');
  const card = document.createElement('div');
  const heading = document.createElement('h2');
  const closeButton = button('×', 'Fermer');
  const head = document.createElement('div');
  const section = document.createElement('section');
  const sectionTitle = document.createElement('h3');
  const description = document.createElement('p');
  const rows = document.createElement('div');
  const live = document.createElement('div');
  const note = document.createElement('p');
  const login: { stop: (() => void) | null } = { stop: null };
  const known = new Map<CliCommand, CliStatus>();

  dialog.setAttribute('data-blok-agent-settings', '');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', titleId);
  dialog.setAttribute('hidden', '');
  dialog.tabIndex = -1;
  card.setAttribute('data-blok-agent-settings-card', '');
  heading.id = titleId;
  heading.textContent = 'Paramètres';
  head.setAttribute('data-blok-agent-settings-head', '');
  head.append(heading, closeButton);
  sectionTitle.textContent = 'Providers IA';
  description.textContent = 'Choisis les agents disponibles sur cette machine. Leur connexion reste gérée par leur CLI.';
  rows.setAttribute('data-blok-agent-rows', '');
  live.setAttribute('data-blok-agent-login', '');
  live.setAttribute('aria-live', 'polite');
  note.setAttribute('data-blok-agent-note', '');
  note.textContent = 'La connexion et les identifiants restent dans les outils Codex et Claude Code installés sur cette machine. Ces réglages ne sauvegardent aucun secret.';
  section.append(sectionTitle, description, rows, live, note);
  card.append(head, section);
  dialog.append(card);

  const stopLogin = (): void => {
    login.stop?.();
    login.stop = null;
  };

  const paint = (): void => {
    const settings = readAgentSettings();

    rows.replaceChildren();
    settings.order.forEach((command, index) => {
      const status = known.get(command);
      const label = providerLabel(command);
      const row = document.createElement('div');
      const identity = document.createElement('div');
      const name = document.createElement('p');
      const line = document.createElement('p');
      const stateLabel = document.createElement('span');
      const actions = document.createElement('div');
      const up = button('Monter', `Monter ${label}`);
      const down = button('Descendre', `Descendre ${label}`);
      const enableLabel = document.createElement('label');
      const enable = document.createElement('input');

      row.setAttribute('data-blok-agent-row', command);
      name.textContent = label;
      line.setAttribute('data-blok-agent-status', '');
      stateLabel.setAttribute('data-blok-agent-status-label', '');
      stateLabel.textContent = status === undefined ? '' : statusText(status);
      line.append(stateLabel);

      if (status !== undefined && status.installed && status.version !== '') {
        const version = document.createElement('span');

        version.setAttribute('data-blok-agent-version', '');
        version.textContent = status.version;
        line.append(document.createTextNode(' · '), version);
      }

      identity.append(name, line);
      up.disabled = index === 0;
      down.disabled = index === settings.order.length - 1;
      up.addEventListener('click', () => {
        updateAgentSettings((state) => ({ ...state, order: swap(state.order, index, index - 1) }));
      });
      down.addEventListener('click', () => {
        updateAgentSettings((state) => ({ ...state, order: swap(state.order, index, index + 1) }));
      });
      enable.type = 'checkbox';
      enable.checked = settings.enabled[command];
      enable.setAttribute('aria-label', `Activer ${label}`);
      enable.addEventListener('change', () => {
        updateAgentSettings((state) => ({
          ...state,
          enabled: { ...state.enabled, [command]: enable.checked },
        }));
      });
      enableLabel.append(enable, document.createTextNode(' Activer'));
      actions.setAttribute('data-blok-agent-actions', '');
      actions.append(up, down, enableLabel);

      const isDefault = settings.defaultProviderId === command;
      const canDefault = status !== undefined && status.installed && status.connected && settings.enabled[command] && !isDefault;

      if (canDefault) {
        const makeDefault = button('Par défaut', `Par défaut ${label}`);

        makeDefault.addEventListener('click', () => {
          updateAgentSettings((state) => ({ ...state, defaultProviderId: command }));
        });
        actions.append(makeDefault);
      }

      if (isDefault) {
        const badge = document.createElement('span');

        badge.setAttribute('data-blok-agent-default', '');
        badge.textContent = 'Par défaut';
        actions.append(badge);
      }

      if (status !== undefined && status.installed && !status.connected) {
        const connect = button('Se connecter', `Se connecter ${label}`);

        connect.addEventListener('click', () => {
          beginLogin(command);
        });
        actions.append(connect);
      }

      row.append(identity, actions);
      rows.append(row);
    });
  };

  const refresh = async (): Promise<void> => {
    const [codex, claude] = await Promise.all([
      inspectCli('codex', undefined, true),
      inspectCli('claude', undefined, true),
    ]);

    known.set('codex', codex);
    known.set('claude', claude);
    paint();
  };

  const beginLogin = (command: CliCommand): void => {
    stopLogin();
    live.replaceChildren();

    const instruction = document.createElement('p');

    instruction.textContent = command === 'codex'
      ? 'Ouvre l\'adresse indiquée et saisis le code affiché ci-dessous'
      : 'Termine la connexion dans la fenêtre du navigateur ouverte par Claude Code.';
    live.append(instruction);

    const pre = document.createElement('pre');

    if (command === 'codex') live.append(pre);

    const session = startCliLogin(command, (chunk) => {
      if (command === 'codex') pre.append(document.createTextNode(chunk));
    });

    login.stop = session.stop;
    void session.done.then(() => {
      if (login.stop !== session.stop) return;

      login.stop = null;
      invalidateCli(command);
      void refresh();
    });
  };

  const close = (): void => {
    stopLogin();
    live.replaceChildren();
    dialog.setAttribute('hidden', '');
    document.removeEventListener('keydown', onKey, true);
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || dialog.hasAttribute('hidden')) return;

    event.preventDefault();
    event.stopPropagation();
    close();
  };

  const open = (): void => {
    dialog.removeAttribute('hidden');
    document.addEventListener('keydown', onKey, true);
    dialog.focus();
    paint();
    void refresh();
  };

  closeButton.addEventListener('click', close);
  const unsubscribe = subscribeAgentSettings(paint);

  return {
    element: dialog,
    open,
    close,
    destroy: () => {
      close();
      unsubscribe();
      dialog.remove();
    },
  };
};
