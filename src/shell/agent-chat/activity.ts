export interface ChatActivityHandle {
  element: HTMLDivElement;
  setLabel: (label: string) => void;
  setRunning: (running: boolean) => void;
}

/** A live status label; the caller supplies real execution states. */
export const createChatActivity = (label: string, running = true): ChatActivityHandle => {
  const element = document.createElement('div');
  const text = document.createElement('span');

  element.setAttribute('data-blok-chat-activity', '');
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  element.setAttribute('aria-atomic', 'true');
  text.setAttribute('data-blok-chat-activity-text', '');
  text.textContent = label;
  element.toggleAttribute('data-running', running);
  element.append(text);

  return {
    element,
    setLabel: (next) => { text.textContent = next; },
    setRunning: (next) => { element.toggleAttribute('data-running', next); },
  };
};
