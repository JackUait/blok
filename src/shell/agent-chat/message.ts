import { chatIcon } from './icons';

export interface ChatMessageOptions {
  kind: 'user' | 'assistant' | 'error';
  text: string;
  provider?: string;
  time?: string;
  onCopy?: () => void;
  onRetry?: () => void;
}

const action = (label: string, icon: 'copy' | 'retry', callback: () => void): HTMLButtonElement => {
  const button = document.createElement('button');

  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.append(chatIcon(icon, 16), document.createTextNode(label));
  button.addEventListener('click', callback);

  return button;
};

export const createChatMessage = (options: ChatMessageOptions): HTMLElement => {
  const article = document.createElement('article');
  const body = document.createElement('div');

  article.setAttribute('data-blok-chat-message', options.kind);
  const labels = { user: 'Votre message', error: 'Erreur de l’assistant', assistant: 'Réponse de l’assistant' };

  article.setAttribute('aria-label', labels[options.kind]);
  body.setAttribute('data-blok-chat-message-body', '');
  body.textContent = options.text;

  if (options.kind === 'error') article.setAttribute('role', 'alert');
  if (options.kind === 'assistant' && (options.provider || options.time)) {
    const meta = document.createElement('div');

    meta.setAttribute('data-blok-chat-message-meta', '');
    meta.textContent = [options.provider, options.time].filter(Boolean).join(' · ');
    article.append(meta);
  }

  article.append(body);
  if (options.onCopy || options.onRetry) {
    const actions = document.createElement('div');

    actions.setAttribute('data-blok-chat-message-actions', '');
    if (options.onCopy) actions.append(action('Copier', 'copy', options.onCopy));
    if (options.onRetry) actions.append(action('Réessayer', 'retry', options.onRetry));
    article.append(actions);
  }

  return article;
};
