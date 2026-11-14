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
  const state: { timer: ReturnType<typeof setTimeout> | undefined; destroyed: boolean } = {
    timer: undefined,
    destroyed: false,
  };

  const clear = (): void => {
    clearTimeout(state.timer);
    state.timer = undefined;
    element.hidden = true;
    element.textContent = '';
    element.removeAttribute('data-desktop-feedback-kind');
  };

  return {
    element,
    show(message, kind = 'status') {
      if (state.destroyed) return;
      clearTimeout(state.timer);
      element.textContent = message;
      element.setAttribute('data-desktop-feedback-kind', kind);
      element.setAttribute('role', kind === 'error' ? 'alert' : 'status');
      element.hidden = false;
      if (options.timeoutMs !== undefined) {
        state.timer = setTimeout(clear, options.timeoutMs);
      }
    },
    clear,
    destroy() {
      if (state.destroyed) return;
      state.destroyed = true;
      clear();
      element.remove();
    },
  };
}
