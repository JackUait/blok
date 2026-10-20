import type { AgentThinkingLevel } from '../../../../types/api';
import { PopoverEvent } from '../../../../types/utils/popover/popover-event';
import { DATA_ATTR } from '../../constants/data-attributes';
import { IconArrowUp, IconCheck, IconEmojiSparkles, IconPlayerSpeed, IconUndo } from '../../icons';
import { PopoverDesktop } from '../../utils/popover';
import { onHover } from '../../utils/tooltip';
import { promoteToTopLayer, removeFromTopLayer } from '../../utils/top-layer';

import { releaseGap, reserveGap } from './gap';

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
  /** `edited`: this answer changed the document, so only its first line shows. */
  | { kind: 'answered'; reply: string; changed: boolean; edited: boolean }
  | { kind: 'error'; message: string; changed: boolean };

const ATTR = {
  dock: 'data-blok-assistant',
  reply: 'data-blok-assistant-reply',
  status: 'data-blok-assistant-status',
  summary: 'data-blok-assistant-summary',
  alert: 'data-blok-assistant-alert',
  head: 'data-blok-assistant-head',
  answer: 'data-blok-assistant-answer',
  followUp: 'data-blok-assistant-follow-up',
  row: 'data-blok-assistant-row',
  field: 'data-blok-assistant-field',
  icon: 'data-blok-assistant-icon',
  send: 'data-blok-assistant-send',
  thinking: 'data-blok-assistant-thinking',
  thinkingMenu: 'data-blok-assistant-thinking-menu',
  button: 'data-blok-assistant-button',
  undo: 'data-blok-assistant-undo',
  keep: 'data-blok-assistant-keep',
  slots: 'data-blok-assistant-slots',
  working: 'data-blok-assistant-working',
} as const;

/** Gap keys on the anchor holder: the bar, then the shimmer slots under it. */
const BAR_GAP = 'bar';
const SLOTS_GAP = 'bar-slots';

/** Space above and below the bar inside its gap (the approved mockup's margins). */
const SPACE_BEFORE = 6;
const SPACE_AFTER = 10;

/** How far the bar reaches past the content column on each side. */
const OVERHANG = 12;

/** Least room kept between the bar and the window's sides on a narrow screen. */
const WINDOW_EDGE = 16;

/** Where the bar sits: the content column it spans, in viewport px. */
export interface AssistantBarColumn {
  left: number;
  width: number;
}

const build = <K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string> = {}): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);

  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));

  return element;
};

/** Split a reply into its first line and the rest. */
const splitReply = (reply: string): { summary: string; rest: string } => {
  const text = reply.trim();
  const end = text.indexOf('\n');

  return end === -1
    ? { summary: text, rest: '' }
    : { summary: text.slice(0, end).trim(), rest: text.slice(end + 1).trim() };
};

/** Most words in the note after an edit. */
const NOTE_WORDS = 10;

/** Cut text after its NOTE_WORDS-th word, with an ellipsis. Segmenter counts words in any script. */
const capWords = (text: string): string => {
  const words = [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)].filter((part) => part.isWordLike === true);

  if (words.length <= NOTE_WORDS) {
    return text;
  }

  const last = words[NOTE_WORDS - 1];

  return `${text.slice(0, last.index + last.segment.length)}…`;
};

const BLOCK_WRAPPERS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE']);

/** The inline content of a one-line rendering: a lone paragraph, heading or list item is unwrapped. */
const inlineOf = (fragment: DocumentFragment): Node[] => {
  const unwrap = (node: ParentNode): Node[] => {
    const elements = [...node.children];
    const loose = [...node.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').trim() !== '');

    return elements.length === 1 && !loose && BLOCK_WRAPPERS.has(elements[0].tagName)
      ? unwrap(elements[0])
      : [...node.childNodes];
  };

  return unwrap(fragment);
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

/**
 * The "Ask AI" prompt bar, in the page under its anchor block.
 *
 * It lives in the top layer, outside the editor's DOM, and sits over a gap it
 * holds open under the anchor holder (gap.ts). Keys typed in it belong to it
 * (data-blok-keyboard-owner), so Blok's block handlers stand down.
 */
export class AssistantBar {
  public readonly element: HTMLElement;

  private readonly field: HTMLTextAreaElement;
  private readonly head: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly reply: HTMLElement;
  private readonly status: HTMLElement;
  private readonly alert: HTMLElement;
  private readonly send: HTMLButtonElement;
  private readonly stop: HTMLButtonElement;
  private readonly undo: HTMLButtonElement;
  private readonly keep: HTMLButtonElement;
  private readonly thinking: HTMLButtonElement;
  private readonly slots: HTMLElement;
  private view: AssistantBarView = { kind: 'prompt' };
  private anchor: HTMLElement | null = null;
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

    // The answer and its actions sit on top, the field at the bottom: reading order is
    // visual order, and the field never moves, so focus and IME composition survive.
    this.head = build('div', { [ATTR.head]: '' });
    const headIcon = build('span', { [ATTR.icon]: '', 'aria-hidden': 'true' });
    const answer = build('div', { [ATTR.answer]: '' });
    const row = build('div', { [ATTR.row]: '' });
    const icon = build('span', { [ATTR.icon]: '', 'aria-hidden': 'true' });
    const field = build('div', { [ATTR.field]: '' });

    headIcon.innerHTML = IconEmojiSparkles;
    icon.innerHTML = IconEmojiSparkles;
    this.field = build('textarea', {
      'data-blok-field': 'text',
      rows: '1',
      'aria-label': t('assistant.prompt'),
      placeholder: t('assistant.placeholder'),
    });
    // The step line lies over the read-only field while the model works.
    this.status = build('p', { [ATTR.status]: '', role: 'status' });
    this.summary = build('p', { [ATTR.summary]: '' });
    this.alert = build('p', { [ATTR.alert]: '', role: 'alert' });
    field.append(this.field, this.status);
    answer.append(this.summary, this.alert);

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
    this.undo = this.iconButton(ATTR.undo, IconUndo, t('assistant.discard'));
    this.keep = this.iconButton(ATTR.keep, IconCheck, t('assistant.keep'));
    this.head.append(headIcon, answer, this.undo, this.keep);
    row.append(icon, field, this.thinking, this.send, this.stop);

    this.reply = build('div', { [ATTR.reply]: '' });

    this.slots = build('div', { [ATTR.slots]: '', 'aria-hidden': 'true' });
    this.slots.append(...['', 'short'].map((size) => build('div', { [DATA_ATTR.aiSlot]: size, class: 'blok-ai-shimmer' })));
    this.slots.hidden = true;

    this.element.append(this.head, this.reply, row, this.slots);

    this.field.addEventListener('keydown', (event) => this.onKeydown(event));
    this.field.addEventListener('input', () => this.sync());
    this.send.addEventListener('click', () => this.submit());
    this.thinking.addEventListener('click', () => this.toggleThinkingMenu());
    this.stop.addEventListener('click', () => callbacks.onStop());
    this.keep.addEventListener('click', () => callbacks.onKeep());
    this.undo.addEventListener('click', () => callbacks.onDiscard());

    this.element.hidden = true;
    this.render({ kind: 'prompt' });
  }

  public get isOpen(): boolean {
    return !this.element.hidden;
  }

  /** The anchor holder the bar sits under, while open. */
  public get anchorHolder(): HTMLElement | null {
    return this.anchor;
  }

  /** Whether a node is in the bar or in a menu the bar opened. */
  public contains(node: Node): boolean {
    return this.element.contains(node) || this.thinkingMenu?.hasNode(node) === true;
  }

  /**
   * Show the bar under `anchor`, across `column`.
   * @param anchor - the block holder to sit under
   * @param column - the content column, in viewport px
   */
  public open(anchor: HTMLElement, column: AssistantBarColumn): void {
    if (!this.element.isConnected) {
      document.body.appendChild(this.element);
    }
    this.element.hidden = false;
    promoteToTopLayer(this.element);
    this.place(anchor, column);
    this.field.focus({ preventScroll: true });
  }

  public close(): void {
    this.element.hidden = true;
    this.thinkingMenu?.hide();
    this.field.value = '';
    removeFromTopLayer(this.element);
    this.render({ kind: 'prompt' });
    this.release();
  }

  /**
   * Hold a gap under `anchor` as tall as the bar (and its slots), and sit in it.
   * @param anchor - the block holder to sit under
   * @param column - the content column, in viewport px
   */
  public place(anchor: HTMLElement, column: AssistantBarColumn): void {
    if (this.anchor !== anchor) {
      this.release();
      this.anchor = anchor;
    }

    const height = this.element.getBoundingClientRect().height;
    const offset = reserveGap(anchor, BAR_GAP, SPACE_BEFORE + height + SPACE_AFTER);

    if (this.slots.hidden) {
      releaseGap(anchor, SLOTS_GAP);
    } else {
      // Slots use em, like the preview: size them as a block here would be.
      this.slots.style.fontSize = getComputedStyle(anchor).fontSize;
      reserveGap(anchor, SLOTS_GAP, this.slots.getBoundingClientRect().height);
    }
    this.element.style.top = `${anchor.getBoundingClientRect().bottom + offset + SPACE_BEFORE}px`;
    // Centred on the column; a narrow window trims the overhang first, then the column.
    // clientWidth leaves out a classic scrollbar; it is 0 only with no layout (jsdom).
    const page = document.documentElement.clientWidth || window.innerWidth;
    const width = Math.max(0, Math.min(column.width + 2 * OVERHANG, page - 2 * WINDOW_EDGE));
    const left = Math.min(Math.max(column.left + column.width / 2 - width / 2, WINDOW_EDGE), page - WINDOW_EDGE - width);

    this.element.style.left = `${left}px`;
    this.element.style.width = `${width}px`;
  }

  /**
   * Shimmer slots under the bar, for a model whose edits Blok cannot see coming.
   * The caller re-places the bar after this.
   * @param shown - draw the slots or remove them
   */
  public setSlots(shown: boolean): void {
    this.slots.hidden = !shown;
  }

  public get slotsShown(): boolean {
    return !this.slots.hidden;
  }

  public render(view: AssistantBarView): void {
    const working = view.kind === 'working';

    this.view = view;
    this.element.toggleAttribute(ATTR.working, working);
    this.showReply(view.kind === 'answered' ? view.reply : '', view.kind === 'answered' && view.edited);
    this.alert.textContent = view.kind === 'error' ? view.message : '';
    this.status.textContent = working ? view.status : '';
    if (working) {
      this.thinkingMenu?.hide();
    }
    this.field.readOnly = working;
    this.sync();
  }

  /**
   * Show the level picker, or hide it with null or a single level.
   * @param view - the allowed levels and the current pick
   */
  public setThinking(view: AssistantThinkingView | null): void {
    this.thinkingView = view !== null && view.levels.length >= 2 ? view : null;
    this.sync();
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
   * Show the reply's first line as the summary and the rest under it:
   * plain text at once, then the markdown rendering. The renderer is
   * imported lazily so the core bundle does not carry it.
   * @param reply - the model's final message, in markdown
   * @param brief - keep only the first line, up to NOTE_WORDS words: after an edit the page shows the work
   */
  private showReply(reply: string, brief: boolean): void {
    const token = this.replyToken + 1;
    const split = splitReply(reply);
    const summary = brief ? capWords(split.summary) : split.summary;
    const rest = brief ? '' : split.rest;

    this.replyToken = token;
    this.summary.textContent = summary;
    this.reply.textContent = rest;
    this.reply.hidden = rest === '';
    if (reply.trim() === '') {
      return;
    }
    void import('../../../markdown/markdownToHtml')
      .then(({ markdownToHtml }) => Promise.all([markdownToHtml(summary), rest === '' ? '' : markdownToHtml(rest)]))
      .then(([summaryHtml, restHtml]) => {
        // A later render (a new prompt, close) owns the reply now.
        if (this.replyToken !== token) {
          return;
        }
        this.summary.replaceChildren(...inlineOf(withoutImages(summaryHtml)));
        if (rest !== '') {
          this.reply.replaceChildren(withoutImages(restHtml));
        }
      })
      .catch(() => undefined);
  }

  /** Show what fits the view: after an answer, the answer and its actions on top, the follow-up field under them. */
  private sync(): void {
    const { kind } = this.view;
    const working = kind === 'working';
    const actions = this.view.kind === 'answered' || this.view.kind === 'error' ? this.view.changed : false;

    this.summary.hidden = kind !== 'answered' || this.summary.textContent === '';
    this.alert.hidden = kind !== 'error' || this.alert.textContent === '';
    this.head.hidden = this.summary.hidden && this.alert.hidden && !actions;
    this.element.toggleAttribute(ATTR.followUp, !this.head.hidden);
    this.field.placeholder = working ? '' : this.t(kind === 'prompt' ? 'assistant.placeholder' : 'assistant.followUp');
    this.stop.hidden = !working;
    this.undo.hidden = !actions;
    this.keep.hidden = !actions;
    this.send.hidden = working;
    this.send.disabled = this.field.value.trim() === '';
    this.thinking.hidden = working || this.thinkingView === null;
  }

  /** Drop the gap the bar holds. */
  private release(): void {
    if (this.anchor !== null) {
      releaseGap(this.anchor, BAR_GAP);
      releaseGap(this.anchor, SLOTS_GAP);
    }
    this.anchor = null;
  }

  /** An icon button: the label is its name and its hover hint. */
  private iconButton(attribute: string, icon: string, label: string): HTMLButtonElement {
    const button = build('button', { type: 'button', [attribute]: '', 'aria-label': label });

    button.innerHTML = icon;
    onHover(button, label);

    return button;
  }

  private submit(): void {
    const prompt = this.field.value.trim();

    if (prompt === '' || this.field.readOnly) {
      return;
    }
    this.field.value = '';
    this.sync();
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
