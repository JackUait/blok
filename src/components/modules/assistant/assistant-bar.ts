import type { AgentThinkingLevel } from '../../../../types/api';
import { PopoverEvent } from '../../../../types/utils/popover/popover-event';
import { DATA_ATTR } from '../../constants/data-attributes';
import { IconArrowUp, IconCheck, IconEmojiSparkles, IconPlayerSpeed } from '../../icons';
import { PopoverDesktop } from '../../utils/popover';
import { onHover } from '../../utils/tooltip';
import { promoteToTopLayer, removeFromTopLayer } from '../../utils/top-layer';

export interface AssistantBarCallbacks {
  onSubmit(prompt: string): void;
  onStop(): void;
  onKeep(): void;
  onDiscard(): void;
  onEscape(): void;
  onThinking(level: AgentThinkingLevel): void;
}

/** The levels the host allows, and the one picked now. */
export interface AssistantThinkingView {
  levels: AgentThinkingLevel[];
  current: AgentThinkingLevel;
}

export type AssistantBarView =
  | { kind: 'prompt' }
  | { kind: 'working'; status: string }
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
  thinking: 'data-blok-assistant-thinking',
  thinkingMenu: 'data-blok-assistant-thinking-menu',
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

/**
 * Parse reply HTML with every image swapped for its alt text.
 * A reply image would load its URL with no click, so a prompt-injected
 * document could make the model leak text through the query string.
 * A template is inert: nothing in it loads before the swap.
 * @param html - the rendered reply
 */
const withoutImages = (html: string): DocumentFragment => {
  const template = document.createElement('template');

  template.innerHTML = html;
  template.content.querySelectorAll('picture, img').forEach((image) => {
    const img = image instanceof HTMLImageElement ? image : image.querySelector('img');

    image.replaceWith(img?.alt ?? '');
  });

  return template.content;
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
  private readonly thinking: HTMLButtonElement;
  private thinkingView: AssistantThinkingView | null = null;
  private thinkingMenu: PopoverDesktop | null = null;
  private replyToken = 0;

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
    this.reply = build('div', { [ATTR.reply]: '' });
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
    this.thinking = build('button', {
      type: 'button',
      [ATTR.thinking]: '',
      'data-blok-testid': 'assistant-thinking',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
    });
    this.thinking.innerHTML = IconPlayerSpeed;
    this.thinking.hidden = true;
    row.append(icon, this.field, this.thinking, this.send, this.stop);

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
    this.thinking.addEventListener('click', () => this.toggleThinkingMenu());
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
    this.thinkingMenu?.hide();
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
    this.showReply((view.kind === 'answered' && view.reply) || '');
    this.alert.textContent = view.kind === 'error' ? view.message : '';
    this.alert.hidden = this.alert.textContent === '';
    this.status.textContent = working ? view.status : '';
    this.stop.hidden = !working;
    this.send.hidden = working;
    if (working) {
      this.thinkingMenu?.hide();
    }
    this.thinking.hidden = working || this.thinkingView === null;
    this.field.readOnly = working;
    this.field.placeholder = this.t(view.kind === 'prompt' ? 'assistant.placeholder' : 'assistant.followUp');
    this.actions.hidden = !((view.kind === 'answered' || view.kind === 'error') && view.changed);
    this.syncSend();
  }

  /**
   * Show the level picker, or hide it with null or a single level.
   * @param view - the allowed levels and the current pick
   */
  public setThinking(view: AssistantThinkingView | null): void {
    this.thinkingView = view !== null && view.levels.length >= 2 ? view : null;
    this.thinking.hidden = this.thinkingView === null || this.element.hasAttribute(ATTR.working);
    if (this.thinkingView === null) {
      this.thinkingMenu?.hide();

      return;
    }

    const label = this.t('assistant.thinkingCurrent', { level: this.t(`assistant.thinking.${this.thinkingView.current}`) });

    this.thinking.setAttribute('aria-label', label);
    onHover(this.thinking, label);
  }

  public focusField(): void {
    this.field.focus({ preventScroll: true });
  }

  private toggleThinkingMenu(): void {
    const view = this.thinkingView;

    if (this.thinkingMenu !== null) {
      this.thinkingMenu.hide();

      return;
    }
    if (view === null) {
      return;
    }

    const menu = new PopoverDesktop({
      trigger: this.thinking,
      flippable: true,
      width: 'auto',
      minWidth: '180px',
      autoFocusFirstItem: false,
      contextLabel: this.t('assistant.thinking'),
      messages: { actions: this.t('assistant.thinking') },
      items: view.levels.map((level) => ({
        title: this.t(`assistant.thinking.${level}`),
        name: level,
        trailingIcon: level === view.current ? IconCheck : undefined,
        // One toggle group makes the rows a radio group, so assistive tech hears which is chosen.
        toggle: 'thinking',
        isActive: level === view.current,
        closeOnActivate: true,
        onActivate: (): void => this.callbacks.onThinking(level),
      })),
    });
    // One Escape closes one layer: the menu, not the bar. Window capture runs
    // before the field's own handler and the popover registry's.
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        menu.hide();
      }
    };

    menu.getElement().setAttribute(ATTR.thinkingMenu, '');
    menu.on(PopoverEvent.Closed, () => {
      window.removeEventListener('keydown', onKeydown, true);
      if (this.thinkingMenu !== menu) {
        return;
      }
      this.thinkingMenu = null;
      this.thinking.setAttribute('aria-expanded', 'false');
      // A row click or Escape leaves focus on <body>, where the bar's keys stop working.
      if (this.isOpen && (document.activeElement === document.body || (document.activeElement !== null && menu.hasNode(document.activeElement)))) {
        this.focusField();
      }
      menu.destroy();
    });
    window.addEventListener('keydown', onKeydown, true);
    this.thinking.setAttribute('aria-expanded', 'true');
    this.thinkingMenu = menu;
    menu.show();
  }

  /**
   * Show the reply as plain text at once, then swap in its markdown rendering.
   * The renderer is imported lazily so the core bundle does not carry it.
   * @param reply - the model's final message, in markdown
   */
  private showReply(reply: string): void {
    const token = this.replyToken + 1;

    this.replyToken = token;
    this.reply.textContent = reply;
    this.reply.hidden = reply === '';
    if (reply === '') {
      return;
    }
    void import('../../../markdown/markdownToHtml')
      .then(({ markdownToHtml }) => markdownToHtml(reply))
      .then((html) => {
        // A later render (a new prompt, close) owns the reply now.
        if (this.replyToken === token) {
          this.reply.replaceChildren(withoutImages(html));
        }
      })
      .catch(() => undefined);
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
