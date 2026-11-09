import { chatIcon, type ChatIcon } from './icons';

export interface ChatSuggestion {
  id: string;
  label: string;
  icon: Extract<ChatIcon, 'summary' | 'insight' | 'question'>;
}

export const createChatSuggestions = (
  suggestions: readonly ChatSuggestion[],
  onChoose: (suggestion: ChatSuggestion) => void,
): HTMLDivElement => {
  const list = document.createElement('div');

  list.setAttribute('data-blok-chat-suggestions', '');
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', 'Suggestions pour l’assistant');
  suggestions.forEach((suggestion) => {
    const button = document.createElement('button');
    const label = document.createElement('span');

    button.type = 'button';
    button.setAttribute('data-blok-chat-suggestion', suggestion.id);
    label.textContent = suggestion.label;
    button.append(chatIcon(suggestion.icon), label, chatIcon('arrow', 15));
    button.addEventListener('click', () => onChoose(suggestion));
    list.append(button);
  });

  return list;
};
