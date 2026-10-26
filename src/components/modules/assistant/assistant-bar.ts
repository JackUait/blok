import type { AgentThinkingLevel } from '../../../../types/api';
import { PopoverEvent } from '../../../../types/utils/popover/popover-event';
import { DATA_ATTR } from '../../constants/data-attributes';
import { IconArrowUp, IconCheck, IconPlayerSpeed, IconRose, IconUndo } from '../../icons';
import { generateBlockId } from '../../utils/id-generator';
import { PopoverDesktop } from '../../utils/popover';
import { onHover } from '../../utils/tooltip';
import { promoteToTopLayer, removeFromTopLayer } from '../../utils/top-layer';

import type { AssistantAction } from './actions';
import { gapSize, releaseGap, reserveGap } from './gap';
import type { GapSide } from './gap';

export interface AssistantBarCallbacks {
  onSubmit(prompt: string): void;
  onStop(): void;
  onKeep(): void;
  onDiscard(): void;
  onContinue(): void;
  /** Put the shown answer into the page. */
  onInsert(): void;
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
  /** `resumable`: the run ran out of steps, so Continue picks it up again. */
  | { kind: 'error'; message: string; changed: boolean; resumable?: boolean };

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
  light: 'data-blok-assistant-light',
  send: 'data-blok-assistant-send',
  thinking: 'data-blok-assistant-thinking',
  thinkingMenu: 'data-blok-assistant-thinking-menu',
  button: 'data-blok-assistant-button',
  stop: 'data-blok-assistant-stop',
  stopGlyph: 'data-blok-assistant-stop-glyph',
  action: 'data-blok-assistant-action',
  actionIcon: 'data-blok-assistant-action-icon',
  undo: 'data-blok-assistant-undo',
  keep: 'data-blok-assistant-keep',
  continue: 'data-blok-assistant-continue',
  insert: 'data-blok-assistant-insert',
  actions: 'data-blok-assistant-actions',
  actionsMotion: 'data-blok-assistant-actions-motion',
  slots: 'data-blok-assistant-slots',
  working: 'data-blok-assistant-working',
  approval: 'data-blok-assistant-approval',
  question: 'data-blok-assistant-question',
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

/** The actions row unfolds, and folds after a beat, so the chips fade first. */
const UNFOLD = { duration: 260, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' };
const FOLD = { duration: 340, delay: 60, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' };
/** One short beat: the bar fades while the page closes its gap, so nobody waits on it. */
const EXIT = { duration: 140, easing: 'ease-out' };

const canMove = (element: HTMLElement): boolean => typeof element.animate === 'function'
  && !(typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

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

/** A line that leads into a list, or is a list item or heading: it does not make sense alone. */
const LEAD_IN = /[:：]$|^(?:[-*+]|\d+[.)]|#+)\s/;

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

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Lays the light that runs round the rose while the model works. Its gradient id is unique per mark. */
const addLight = (mark: HTMLElement): void => {
  const svg = mark.querySelector('svg');
  const rose = svg?.querySelector('path');

  if (!svg || !rose) {
    return;
  }

  const id = `blok-assistant-light-${generateBlockId()}`;
  const gradient = document.createElementNS(SVG_NS, 'linearGradient');
  const light = document.createElementNS(SVG_NS, 'path');

  gradient.id = id;
  ['x1', 'y1', 'x2', 'y2'].forEach((key, index) => gradient.setAttribute(key, index < 2 ? '0' : '1'));
  ['0', '0.5', '1'].forEach((offset) => {
    const stop = document.createElementNS(SVG_NS, 'stop');

    stop.setAttribute('offset', offset);
    gradient.append(stop);
  });
  light.setAttribute('d', rose.getAttribute('d') ?? '');
  light.setAttribute('pathLength', '100');
  light.setAttribute('fill', 'none');
  light.setAttribute('stroke', `url(#${id})`);
  light.setAttribute(ATTR.light, '');
  svg.append(gradient, light);
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
  private readonly resume: HTMLButtonElement;
  private readonly insert: HTMLButtonElement;
  private readonly actions: HTMLElement;
  private readonly approval: HTMLElement;
  private readonly question: HTMLElement;
  private readonly approve: HTMLButtonElement;
  private readonly deny: HTMLButtonElement;
  /** Answers the open question; null when none is open. */
  private answerApproval: ((approved: boolean) => void) | null = null;
  /** The actions row's height while it unfolds or folds; the bar's gap follows it. */
  private actionsMotion: Animation | null = null;
  /** The bar's fade while it leaves. */
  private leaving: Animation | null = null;
  /** The gap the bar held, shrinking; it may outlast the fade. */
  private gapMotion: Animation | null = null;
  private readonly thinking: HTMLButtonElement;
  private readonly slots: HTMLElement;
  /** The block the slots sit under; null: under the bar. */
  private slotsUnder: HTMLElement | null = null;
  /** The holder whose gap the slots hold now, and on which side. */
  private slotsHolder: HTMLElement | null = null;
  private slotsSide: GapSide = 'end';
  /** The bar's height when it began floating over its anchor; null when it sits under it. */
  private inPlaceHeight: number | null = null;
  private view: AssistantBarView = { kind: 'prompt' };
  /** A prompt typed but not sent: the next open shows it again. */
  private draft = '';
  private anchor: HTMLElement | null = null;
  /** Under the anchor (end), or over it (start). */
  private side: GapSide = 'end';
  /** The bar's top at its spot in the page, before pinning it inside the window. */
  private homeTop = 0;
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

    headIcon.innerHTML = IconRose;
    icon.innerHTML = IconRose;
    addLight(headIcon);
    addLight(icon);
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
    // Named by its question; the question is an alert so a screen reader hears it at once.
    const questionId = `blok-assistant-question-${generateBlockId()}`;

    this.approval = build('div', { [ATTR.approval]: '', role: 'group', 'aria-labelledby': questionId, 'data-blok-testid': 'assistant-approval' });
    this.question = build('p', { [ATTR.question]: '', id: questionId, role: 'alert' });
    this.deny = build('button', { type: 'button', [ATTR.button]: '' });
    this.approve = build('button', { type: 'button', [ATTR.button]: '' });
    this.approval.append(this.question, this.deny, this.approve);
    this.approval.hidden = true;
    answer.append(this.summary, this.alert, this.approval);

    this.send = build('button', { type: 'button', [ATTR.send]: '', 'aria-label': t('assistant.send') });
    this.send.innerHTML = IconArrowUp;
    this.stop = this.iconButton(ATTR.stop, `<span ${ATTR.stopGlyph} aria-hidden="true"></span>`, t('assistant.stop'));
    this.thinking = build('button', {
      type: 'button',
      [ATTR.thinking]: '',
      'data-blok-testid': 'assistant-thinking',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
    });
    this.thinking.innerHTML = IconPlayerSpeed;
    this.thinking.hidden = true;
    this.undo = this.labelledButton(ATTR.undo, IconUndo, t('assistant.discard'));
    this.keep = this.labelledButton(ATTR.keep, IconCheck, t('assistant.keep'));
    this.resume = build('button', { type: 'button', [ATTR.button]: '', [ATTR.continue]: '' });
    this.resume.textContent = t('assistant.continue');
    this.insert = build('button', { type: 'button', [ATTR.button]: '', [ATTR.insert]: '' });
    this.insert.textContent = t('assistant.insert');
    this.head.append(headIcon, answer, this.insert, this.resume, this.undo, this.keep);
    row.append(icon, field, this.thinking, this.send, this.stop);
    // Under the row: hiding them on the first keystroke never moves the field.
    this.actions = build('div', { [ATTR.actions]: '', role: 'group', 'aria-label': t('assistant.actions') });

    this.reply = build('div', { [ATTR.reply]: '' });

    this.slots = build('div', { [ATTR.slots]: '', 'aria-hidden': 'true' });
    this.slots.append(...['', 'short'].map((size) => build('div', { [DATA_ATTR.aiSlot]: size, class: 'blok-ai-shimmer' })));
    this.slots.hidden = true;

    this.element.append(this.head, this.reply, row, this.actions, this.slots);

    this.field.addEventListener('keydown', (event) => this.onKeydown(event));
    this.field.addEventListener('input', () => this.sync());
    this.send.addEventListener('click', () => this.submit());
    this.thinking.addEventListener('click', () => this.toggleThinkingMenu());
    this.stop.addEventListener('click', () => callbacks.onStop());
    this.keep.addEventListener('click', () => callbacks.onKeep());
    this.undo.addEventListener('click', () => callbacks.onDiscard());
    this.resume.addEventListener('click', () => callbacks.onContinue());
    this.insert.addEventListener('click', () => callbacks.onInsert());
    this.approve.addEventListener('click', () => this.settleApproval(true));
    this.deny.addEventListener('click', () => this.settleApproval(false));
    // Focus sits on the question's buttons, not the field, so Escape is heard here too.
    this.approval.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        callbacks.onEscape();
      }
    });

    this.element.hidden = true;
    this.render({ kind: 'prompt' });
  }

  public get isOpen(): boolean {
    return !this.element.hidden && this.leaving === null;
  }

  /** The anchor holder the bar sits under, while open. */
  public get anchorHolder(): HTMLElement | null {
    return this.anchor;
  }

  /** The bar's box at its spot in the page, in viewport px, even while pinned inside the window. */
  public get home(): { top: number; bottom: number } {
    return { top: this.homeTop, bottom: this.homeTop + this.element.getBoundingClientRect().height };
  }

  /** Whether a node is in the bar or in a menu the bar opened. */
  public contains(node: Node): boolean {
    return this.element.contains(node) || this.thinkingMenu?.hasNode(node) === true;
  }

  /**
   * Show the bar under `anchor`, across `column`.
   * @param anchor - the block holder to sit under
   * @param column - the content column, in viewport px
   * @param inPlace - cover the anchor instead of sitting under it
   */
  public open(anchor: HTMLElement, column: AssistantBarColumn, inPlace = false): void {
    if (!this.element.isConnected) {
      document.body.appendChild(this.element);
    }
    this.endLeaving();
    this.gapMotion?.cancel();
    this.gapMotion = null;
    // The draft first: a bar that opens with text must not unfold the actions and fold them at once.
    if (this.view.kind === 'prompt' && this.field.value === '') {
      this.field.value = this.draft;
      this.sync();
    }

    const opening = !this.isOpen;

    this.element.hidden = false;
    promoteToTopLayer(this.element);
    // Before place(): it keeps the height it first measures as the field row's.
    if (opening && !this.actions.hidden && canMove(this.actions)) {
      this.unfoldActions(0);
    }
    this.place(anchor, column, inPlace);
    this.field.focus({ preventScroll: true });
  }

  /**
   * Ask the person a yes or no question while the model works, such as unlocking a database.
   * Only the approve button answers yes. A new question, a render that ends the work, or close answers no.
   * @param question - what the agent wants, naming the thing it changes
   * @param labels - the approve and deny button texts
   */
  public askApproval(question: string, labels: { approve: string; deny: string }): Promise<boolean> {
    this.settleApproval(false);
    this.question.textContent = question;
    this.approve.textContent = labels.approve;
    this.deny.textContent = labels.deny;
    this.approval.hidden = false;
    this.sync();

    const answered = new Promise<boolean>((resolve) => {
      this.answerApproval = resolve;
    });

    // The safe answer has focus, so a stray Enter keeps it locked.
    this.deny.focus({ preventScroll: true });

    return answered;
  }

  /** Close the open question with this answer. Does nothing when none is open. */
  public settleApproval(approved: boolean): void {
    const answer = this.answerApproval;

    if (answer === null) {
      return;
    }
    this.answerApproval = null;
    const hadFocus = this.approval.contains(document.activeElement);

    this.approval.hidden = true;
    this.sync();
    if (hadFocus && this.isOpen) {
      this.focusField();
    }
    answer(approved);
  }

  public close(): void {
    this.settleApproval(false);
    if (this.leaving !== null) {
      return;
    }

    const holder = this.anchor;
    const held = holder === null ? 0 : gapSize(holder);
    const moving = holder !== null && this.isOpen && canMove(this.element);
    const covered = holder?.hasAttribute(DATA_ATTR.aiReplaced) === true;

    this.thinkingMenu?.hide();
    // A follow-up typed after an answer belongs to that run, which ends here.
    this.draft = this.view.kind === 'prompt' ? this.field.value : '';
    this.release();
    if (moving) {
      this.leave(holder, held, covered);
    } else {
      this.hide();
    }
  }

  /**
   * Fade the bar out while the page closes the gap it held.
   * @param holder - the anchor holder, its gap already released
   * @param held - the gap it held, in px
   * @param covered - the bar sat over this block, which shows again from now
   */
  private leave(holder: HTMLElement, held: number, covered: boolean): void {
    const rest = parseFloat(getComputedStyle(holder).marginBlockEnd) || 0;

    if (held > 0 && held !== rest) {
      const gap = holder.animate([{ marginBlockEnd: `${held}px` }, { marginBlockEnd: `${rest}px` }], EXIT);

      this.gapMotion = gap;
      gap.onfinish = () => {
        if (this.gapMotion === gap) {
          this.gapMotion = null;
        }
      };
    }
    // Shown now, not after the fade: the caret goes back into it, and a hidden block takes no focus.
    if (covered) {
      holder.querySelector(`[${DATA_ATTR.elementContent}]`)?.animate([{ opacity: 0 }, { opacity: 1 }], EXIT);
    }

    const fade = this.element.animate([{ opacity: 1 }, { opacity: 0 }], { ...EXIT, fill: 'forwards' });

    this.element.inert = true;
    this.leaving = fade;
    fade.onfinish = () => {
      if (this.leaving === fade) {
        this.endLeaving();
      }
    };
  }

  private endLeaving(): void {
    if (this.leaving === null) {
      return;
    }
    this.leaving.cancel();
    this.leaving = null;
    this.element.inert = false;
    this.hide();
  }

  private hide(): void {
    this.element.hidden = true;
    this.field.value = '';
    removeFromTopLayer(this.element);
    this.render({ kind: 'prompt' });
  }

  /**
   * Hold a gap under `anchor` as tall as the bar (and its slots), and sit in it.
   * @param anchor - the block holder to sit under
   * @param column - the content column, in viewport px
   * @param inPlace - float over the anchor (hidden meanwhile): the page moves only for what the bar grows by
   * @param range.side - 'start' holds the gap over the anchor instead of under it
   * @param range.end - the last block of the part the bar heads: pinned at the window's top, it stops just under it
   */
  public place(anchor: HTMLElement, column: AssistantBarColumn, inPlace = false, range: { side?: GapSide; end?: HTMLElement | null } = {}): void {
    const side = range.side ?? 'end';

    if (this.anchor !== anchor || this.side !== side) {
      this.release();
      this.anchor = anchor;
      this.side = side;
    }
    // Hidden before measuring, so the open animation never shows it through the bar.
    anchor.toggleAttribute(DATA_ATTR.aiReplaced, inPlace);

    const rect = anchor.getBoundingClientRect();
    const height = this.element.getBoundingClientRect().height;

    // The height it opened at stays its centre line, so a bar that grows grows down.
    // The actions under the field are growth too: the field row covers the block.
    const actions = this.actions.hidden ? 0 : this.actions.getBoundingClientRect().height;

    this.inPlaceHeight = inPlace ? this.inPlaceHeight ?? height - actions : null;

    const base = this.inPlaceHeight;
    const top = base === null ? null : rect.top + (rect.height - base) / 2;
    // Floating: only the slots and any growth push the page, from the bar's bottom on.
    const below = base === null || top === null ? 0 : Math.max(0, top + base - rect.bottom);
    const under = this.slots.hidden || this.slotsUnder?.isConnected !== true ? null : this.slotsUnder;
    const slotsUnderBar = !this.slots.hidden && under === null;
    const offset = base === null
      ? reserveGap(anchor, BAR_GAP, SPACE_BEFORE + height + SPACE_AFTER, side)
      : reserveGap(anchor, BAR_GAP, Math.max(0, height - base) + (slotsUnderBar ? below + SPACE_AFTER : 0));
    const slotsHolder = this.slots.hidden ? null : under ?? anchor;
    // Slots under the bar share its gap; slots under a block sit below it.
    const slotsSide = under === null ? side : 'end';

    if (this.slotsHolder !== null && (this.slotsHolder !== slotsHolder || this.slotsSide !== slotsSide)) {
      releaseGap(this.slotsHolder, SLOTS_GAP, this.slotsSide);
    }
    this.slotsHolder = slotsHolder;
    this.slotsSide = slotsSide;

    if (slotsHolder !== null) {
      // Slots use em, like the preview: size them as a block here would be.
      this.slots.style.fontSize = getComputedStyle(slotsHolder).fontSize;
    }

    const slotsOffset = slotsHolder === null ? 0 : reserveGap(slotsHolder, SLOTS_GAP, this.slots.getBoundingClientRect().height, slotsSide);

    // A start gap is a margin over the holder: its keys stack down from the gap's top.
    this.homeTop = top ?? (side === 'start' ? rect.top - gapSize(anchor, 'start') : rect.bottom) + offset + SPACE_BEFORE;
    // Pinned inside the window, over the text, when its spot leaves it. Only this write:
    // the gaps above follow the spot, or every scroll would resize them.
    // client sizes leave out classic scrollbars; they are 0 only with no layout (jsdom).
    const view = document.documentElement.clientHeight || window.innerHeight;

    const pinned = Math.max(WINDOW_EDGE, Math.min(this.homeTop, view - WINDOW_EDGE - height));
    const end = range.end?.isConnected === true ? range.end.getBoundingClientRect().bottom + SPACE_BEFORE : Infinity;
    // Past the part's end the bar leaves the window's top with it, but never rises over its spot.
    const barTop = Math.min(pinned, Math.max(this.homeTop, end));

    this.element.style.top = `${barTop}px`;
    // Under a block, the slots sit in its gap; the stylesheet puts them under the bar otherwise.
    if (under === null) {
      this.slots.style.removeProperty('top');
    } else {
      this.slots.style.top = `${under.getBoundingClientRect().bottom + slotsOffset - barTop}px`;
    }
    // Centred on the column; a narrow window trims the overhang first, then the column.
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
   * @param under - a block holder to draw them under instead, as the next content lands after it
   */
  public setSlots(shown: boolean, under: HTMLElement | null = null): void {
    this.slots.hidden = !shown;
    this.slotsUnder = shown ? under : null;
  }

  public get slotsUnderHolder(): HTMLElement | null {
    return this.slotsUnder;
  }

  public get slotsShown(): boolean {
    return !this.slots.hidden;
  }

  public render(view: AssistantBarView): void {
    const working = view.kind === 'working';

    if (!working) {
      this.settleApproval(false);
    }

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

  /**
   * The buttons under an empty field. Set them before open(), which measures the bar.
   * @param actions - each button's label and the prompt it sends
   */
  public setActions(actions: readonly AssistantAction[]): void {
    this.actions.replaceChildren(...actions.map(({ label, prompt, icon }, index) => {
      const button = build('button', { type: 'button', [ATTR.action]: '' });

      // Each one rises in a beat after the one before it.
      button.style.setProperty('--blok-assistant-action-index', String(index));
      if (icon !== undefined) {
        const glyph = build('span', { [ATTR.actionIcon]: '', 'aria-hidden': 'true' });

        glyph.innerHTML = icon;
        button.append(glyph);
      }
      button.append(label);
      button.addEventListener('click', () => {
        if (!this.field.readOnly) {
          this.callbacks.onSubmit(prompt);
        }
      });

      return button;
    }));
    this.sync();
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
   * @param brief - keep only the first line: after an edit the page shows the work
   */
  private showReply(reply: string, brief: boolean): void {
    const token = this.replyToken + 1;
    const split = splitReply(reply);
    const summary = split.summary;
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
    this.resume.hidden = this.view.kind !== 'error' || this.view.resumable !== true;
    this.insert.hidden = this.view.kind !== 'answered' || this.view.edited || this.view.reply.trim() === '';
    this.showActions(kind === 'prompt' && this.field.value === '' && this.actions.childElementCount > 0);
    this.head.hidden = this.summary.hidden && this.alert.hidden && this.approval.hidden && !actions;
    this.element.toggleAttribute(ATTR.followUp, !this.head.hidden);
    this.field.placeholder = working ? '' : this.t(kind === 'prompt' ? 'assistant.placeholder' : 'assistant.followUp');
    this.stop.hidden = !working;
    this.undo.hidden = !actions;
    this.keep.hidden = !actions;
    this.send.hidden = working;
    this.send.disabled = this.field.value.trim() === '';
    this.thinking.hidden = working || this.thinkingView === null;
  }

  private showActions(shown: boolean): void {
    const folding = this.actions.getAttribute(ATTR.actionsMotion) === 'out';

    if (shown ? !this.actions.hidden && !folding : this.actions.hidden || folding) {
      return;
    }
    if (!this.isOpen || !canMove(this.actions)) {
      this.settleActions();
      this.actions.hidden = !shown;

      return;
    }
    if (shown) {
      this.unfoldActions();
    } else {
      this.moveActions(this.actions.getBoundingClientRect().height, 0, 'out', () => {
        this.actions.hidden = true;
      });
    }
  }

  /** @param from - the height to start at: by default where the row is now */
  private unfoldActions(from = this.actions.hidden ? 0 : this.actions.getBoundingClientRect().height): void {
    this.settleActions();
    this.actions.hidden = false;
    this.moveActions(from, this.actions.getBoundingClientRect().height, 'in', () => undefined);
  }

  /** Move the row's height; the stylesheet clips it and plays the chips by `direction`. */
  private moveActions(from: number, to: number, direction: 'in' | 'out', done: () => void): void {
    this.settleActions();

    const pad = parseFloat(getComputedStyle(this.actions).paddingBlockEnd) || 0;
    // border-box: the padding shrinks with the height, or a closed row keeps it.
    const frame = (height: number): Keyframe => ({ height: `${height}px`, paddingBlockEnd: `${Math.min(pad, height)}px` });
    const motion = this.actions.animate([frame(from), frame(to)], { ...(direction === 'in' ? UNFOLD : FOLD), fill: 'both' });

    this.actions.setAttribute(ATTR.actionsMotion, direction);
    this.actions.inert = direction === 'out';
    this.actionsMotion = motion;
    motion.onfinish = () => {
      // A newer motion owns the row now.
      if (this.actionsMotion !== motion) {
        return;
      }
      done();
      this.settleActions();
    };
  }

  private settleActions(): void {
    this.actionsMotion?.cancel();
    this.actionsMotion = null;
    this.actions.removeAttribute(ATTR.actionsMotion);
    this.actions.inert = false;
  }

  /** Drop the gap the bar holds. */
  private release(): void {
    if (this.anchor !== null) {
      this.anchor.removeAttribute(DATA_ATTR.aiReplaced);
      this.inPlaceHeight = null;
      releaseGap(this.anchor, BAR_GAP, this.side);
    }
    if (this.slotsHolder !== null) {
      releaseGap(this.slotsHolder, SLOTS_GAP, this.slotsSide);
    }
    this.slotsHolder = null;
    this.anchor = null;
  }

  /** An icon and its visible label; the label names the button, so it needs no hint. */
  private labelledButton(attribute: string, icon: string, label: string): HTMLButtonElement {
    const button = build('button', { type: 'button', [attribute]: '' });

    button.innerHTML = icon;
    button.append(label);

    return button;
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
