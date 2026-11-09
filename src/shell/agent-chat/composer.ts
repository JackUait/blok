import { chatIcon } from './icons';

export interface ChatProvider {
  id: string;
  label: string;
}

export interface ChatComposerOptions {
  providers: readonly ChatProvider[];
  selectedProvider?: string;
  includePage?: boolean;
  sendLabel?: string;
  onSend: (message: string, provider: string, includePage: boolean) => void;
  onStop?: () => void;
  onProviderChange?: (provider: string) => void;
  onContextChange?: (includePage: boolean) => void;
}

export interface ChatComposerHandle {
  element: HTMLFormElement;
  field: HTMLTextAreaElement;
  submit: HTMLButtonElement;
  setRunning: (running: boolean) => void;
  setProviders: (providers: readonly ChatProvider[], selectedProvider?: string) => void;
  setText: (text: string) => void;
  focus: () => void;
}

export const createChatComposer = (options: ChatComposerOptions): ChatComposerHandle => {
  const element = document.createElement('form');
  const field = document.createElement('textarea');
  const controls = document.createElement('div');
  const page = document.createElement('button');
  const providerWrap = document.createElement('span');
  const provider = document.createElement('select');
  const submit = document.createElement('button');
  const state = { running: false, includePage: options.includePage ?? true };

  element.setAttribute('data-blok-chat-composer', '');
  element.setAttribute('aria-label', 'Message à l’assistant');
  field.setAttribute('aria-label', 'Demander à l’assistant');
  field.placeholder = 'Demander à l’assistant…';
  field.rows = 2;
  controls.setAttribute('data-blok-chat-composer-controls', '');
  page.type = 'button';
  page.setAttribute('data-blok-chat-page-context', '');
  page.setAttribute('aria-label', 'Inclure cette page');
  page.setAttribute('aria-pressed', String(state.includePage));
  page.append(chatIcon('check', 14), document.createTextNode('Cette page'));
  providerWrap.setAttribute('data-blok-chat-provider', '');
  provider.setAttribute('aria-label', 'Moteur IA');
  const fillProviders = (providers: readonly ChatProvider[], selected?: string): void => {
    provider.replaceChildren();
    providers.forEach((item) => {
      const choice = document.createElement('option');

      choice.value = item.id;
      choice.textContent = item.label;
      provider.append(choice);
    });
    if (selected && providers.some((item) => item.id === selected)) provider.value = selected;
    provider.disabled = providers.length === 0;
  };

  fillProviders(options.providers, options.selectedProvider);
  providerWrap.append(provider, chatIcon('chevron', 14));
  submit.type = 'submit';
  submit.setAttribute('data-blok-chat-submit', '');
  submit.setAttribute('aria-label', options.sendLabel ?? 'Envoyer');
  submit.append(chatIcon('send'));
  controls.append(page, providerWrap, submit);
  element.append(field, controls);

  const sizeField = (): void => {
    field.style.height = 'auto';
    field.style.height = `${Math.max(52, Math.min(field.scrollHeight, 144))}px`;
    field.style.overflowY = field.scrollHeight > 144 ? 'auto' : 'hidden';
  };
  const sync = (): void => {
    submit.disabled = state.running ? options.onStop === undefined : field.value.trim() === '' || provider.disabled;
    submit.setAttribute('aria-label', state.running ? 'Arrêter la réponse' : options.sendLabel ?? 'Envoyer');
    submit.replaceChildren(chatIcon(state.running ? 'stop' : 'send'));
  };

  field.addEventListener('input', () => { sizeField(); sync(); });
  field.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;

    event.preventDefault();
    if (!submit.disabled) element.requestSubmit();
  });
  page.addEventListener('click', () => {
    state.includePage = !state.includePage;
    page.setAttribute('aria-pressed', String(state.includePage));
    options.onContextChange?.(state.includePage);
  });
  provider.addEventListener('change', () => options.onProviderChange?.(provider.value));
  element.addEventListener('submit', (event) => {
    event.preventDefault();
    if (state.running) {
      options.onStop?.();
      return;
    }

    const message = field.value.trim();

    if (message === '' || provider.disabled) return;
    options.onSend(message, provider.value, state.includePage);
    field.value = '';
    sizeField();
    sync();
  });
  sizeField();
  sync();

  return {
    element,
    field,
    submit,
    setRunning: (next) => {
      state.running = next;
      field.disabled = next;
      element.toggleAttribute('data-running', next);
      sync();
    },
    setProviders: (providers, selected) => {
      fillProviders(providers, selected ?? provider.value);
      sync();
    },
    setText: (text) => {
      field.value = text;
      sizeField();
      sync();
    },
    focus: () => field.focus(),
  };
};
