import { el } from './dom';

export interface FeedbackHandle {
  element: HTMLElement;
  show(message: string, kind?: 'status' | 'error'): void;
  clear(): void;
  destroy(): void;
}

export interface FeedbackOptions {
  attribute?: string;
  /** Auto-hide delay in ms; omit to keep the message until cleared. */
  timeoutMs?: number;
}

/** Ephemeral status / error message for toolbars and panels. */
export function createFeedback(options: FeedbackOptions = {}): FeedbackHandle {
  const element = el('span', { attribute: options.attribute ?? 'data-desktop-feedback' });
  element.setAttribute('role', 'status');
  element.hidden = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;

  const clear = (): void => {
    clearTimeout(timer);
    timer = undefined;
    element.hidden = true;
    element.textContent = '';
    element.removeAttribute('data-desktop-feedback-kind');
  };

  return {
    element,
    show(message, kind = 'status') {
      if (destroyed) return;
      clearTimeout(timer);
      element.textContent = message;
      element.setAttribute('data-desktop-feedback-kind', kind);
      element.setAttribute('role', kind === 'error' ? 'alert' : 'status');
      element.hidden = false;
      if (options.timeoutMs !== undefined) {
        timer = setTimeout(clear, options.timeoutMs);
      }
    },
    clear,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clear();
      element.remove();
    },
  };
}
