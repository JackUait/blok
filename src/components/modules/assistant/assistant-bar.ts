import { DATA_ATTR } from '../../constants/data-attributes';
import { IconArrowUp, IconEmojiSparkles } from '../../icons';
import { promoteToTopLayer, removeFromTopLayer } from '../../utils/top-layer';

export interface AssistantBarCallbacks {
  onSubmit(prompt: string): void;
  onStop(): void;
  onKeep(): void;
  onDiscard(): void;
  onEscape(): void;
}

export type AssistantBarView =
  | { kind: 'prompt' }
  | { kind: 'working'; status: string; progress?: string }
  | { kind: 'answered'; reply: string; changed: boolean }
  | { kind: 'error'; message: string; changed: boolean };

const ATTR = {
  dock: 'data-blok-assistant',
  reply: 'data-blok-assistant-reply',
  status: 'data-blok-assistant-status',
  alert: 'data-blok-assistant-alert',
  row: 'data-blok-assistant-row',
  icon: 'data-blok-assistant-icon',
  send: 'data-blok-assistant-send',
  actions: 'data-blok-assistant-actions',
  button: 'data-blok-assistant-button',
  primary: 'data-blok-assistant-primary',
  working: 'data-blok-assistant-working',
} as const;

const build = <K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string> = {}): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);

  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));

  return element;
};

/** Widest the bar grows, so a long line of prompt stays readable. */
const MAX_WIDTH = 720;

/**
 * The "Ask AI" prompt bar, docked to the bottom of the editor.
 *
 * It lives in the top layer, outside the editor's DOM. Keys typed in it belong
 * to it (data-blok-keyboard-owner), so Blok's block handlers stand down.
 */
export class AssistantBar {
  public readonly element: HTMLElement;

  private readonly field: HTMLTextAreaElement;
  private readonly reply: HTMLElement;
  private readonly status: HTMLElement;
  private readonly alert: HTMLElement;
  private readonly send: HTMLButtonElement;
  private readonly stop: HTMLButtonElement;
  private readonly actions: HTMLElement;

  public constructor(
    private readonly t: (key: string, vars?: Record<string, string | number>) => string,
    private readonly callbacks: AssistantBarCallbacks
  ) {
    this.element = build('div', {
      [ATTR.dock]: '',
      role: 'dialog',
      'aria-label': t('assistant.label'),
      [DATA_ATTR.keyboardOwner]: '',
      'data-blok-testid': 'assistant-bar',
    });
    // Scopes Blok's preflight and utilities to the bar in a host page; Find skips it too.
    this.element.setAttribute('data-blok-interface', 'assistant');
    this.reply = build('p', { [ATTR.reply]: '' });
    this.alert = build('p', { [ATTR.alert]: '', role: 'alert' });
    this.status = build('p', { [ATTR.status]: '', role: 'status' });

    const row = build('div', { [ATTR.row]: '' });
    const icon = build('span', { [ATTR.icon]: '', 'aria-hidden': 'true' });

    icon.innerHTML = IconEmojiSparkles;
    this.field = build('textarea', {
      'data-blok-field': 'text',
      rows: '1',
      'aria-label': t('assistant.prompt'),
      placeholder: t('assistant.placeholder'),
    });
    this.send = build('button', { type: 'button', [ATTR.send]: '', 'aria-label': t('assistant.send') });
    this.send.innerHTML = IconArrowUp;
    this.stop = build('button', { type: 'button', [ATTR.button]: '' });
    this.stop.textContent = t('assistant.stop');
    row.append(icon, this.field, this.send, this.stop);

    this.actions = build('div', { [ATTR.actions]: '' });

    const keep = build('button', { type: 'button', [ATTR.button]: '', [ATTR.primary]: '' });
    const discard = build('button', { type: 'button', [ATTR.button]: '' });

    keep.textContent = t('assistant.keep');
    discard.textContent = t('assistant.discard');
    this.actions.append(keep, discard);

    this.element.append(this.reply, this.alert, this.status, row, this.actions);

    this.field.addEventListener('keydown', (event) => this.onKeydown(event));
    this.field.addEventListener('input', () => this.syncSend());
    this.send.addEventListener('click', () => this.submit());
    this.stop.addEventListener('click', () => callbacks.onStop());
    keep.addEventListener('click', () => callbacks.onKeep());
    discard.addEventListener('click', () => callbacks.onDiscard());

    this.element.hidden = true;
    this.render({ kind: 'prompt' });
  }

  public get isOpen(): boolean {
    return !this.element.hidden;
  }

  /**
   * Show the bar across the editor's width.
   * @param editor - the editor's wrapper, to line the bar up with
   */
  public open(editor: HTMLElement): void {
    if (!this.element.isConnected) {
      document.body.appendChild(this.element);
    }
    this.element.hidden = false;
    promoteToTopLayer(this.element);
    this.place(editor);
    this.field.focus({ preventScroll: true });
  }

  public close(): void {
    this.element.hidden = true;
    this.field.value = '';
    removeFromTopLayer(this.element);
    this.render({ kind: 'prompt' });
  }

  /**
   * @param editor - the editor's wrapper
   */
  public place(editor: HTMLElement): void {
    const rect = editor.getBoundingClientRect();
    const width = Math.min(rect.width, MAX_WIDTH);

    // A zero-width rect (detached, jsdom) leaves the stylesheet's centering alone.
    if (width > 0) {
      this.element.style.left = `${rect.left + (rect.width - width) / 2}px`;
      this.element.style.width = `${width}px`;
    }
  }

  public render(view: AssistantBarView): void {
    const working = view.kind === 'working';

    this.element.toggleAttribute(ATTR.working, working);
    // Streamed text goes here, not into the status live region: a screen reader
    // would announce every token.
    this.reply.textContent = (view.kind === 'answered' && view.reply) || (view.kind === 'working' && view.progress) || '';
    this.reply.hidden = this.reply.textContent === '';
    this.alert.textContent = view.kind === 'error' ? view.message : '';
    this.alert.hidden = this.alert.textContent === '';
    this.status.textContent = working ? view.status : '';
    this.stop.hidden = !working;
    this.send.hidden = working;
    this.field.readOnly = working;
    this.field.placeholder = this.t(view.kind === 'prompt' ? 'assistant.placeholder' : 'assistant.followUp');
    this.actions.hidden = !((view.kind === 'answered' || view.kind === 'error') && view.changed);
    this.syncSend();
  }

  public focusField(): void {
    this.field.focus({ preventScroll: true });
  }

  private syncSend(): void {
    this.send.disabled = this.field.value.trim() === '';
  }

  private submit(): void {
    const prompt = this.field.value.trim();

    if (prompt === '' || this.field.readOnly) {
      return;
    }
    this.field.value = '';
    this.syncSend();
    this.callbacks.onSubmit(prompt);
  }

  private onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.callbacks.onEscape();

      return;
    }
    // isComposing: Enter that confirms an IME candidate must not send.
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.submit();
    }
  }
}
