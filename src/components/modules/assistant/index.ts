/**
 * The in-editor AI assistant: Mod+J (or "Ask AI") opens a prompt bar, and
 * `editor.agent.ask()` writes the answer into the document live.
 *
 * Present only when `agent.assistant.model` is configured.
 */
import type { ChangedSet } from '../../../../types/agent';
import type { Block } from '../../block';
import type { AgentModelStreamEvent, AgentRun, AgentRunResult, AgentThinkingLevel, AgentToolResult } from '../../../../types/api';
import type { ThinkingChoice } from '../../../agent/thinking';
import type { UserPlace } from '../api/agent';
import { Module } from '../../__module';
import { DATA_ATTR } from '../../constants/data-attributes';
import { getUserOS } from '../../utils/browser';
import { syncPortalDirection } from '../../utils/portal-direction';
import { prefersReducedMotion } from '../../utils/reduced-motion';

import { assistantActions, type ActionContext } from './actions';
import { AssistantBar, type AssistantBarColumn } from './assistant-bar';
import { onGapChange } from './gap';
import { createLivePreview, type LivePreview } from './live-preview';
import { parsePartialJson } from '../../../agent/partial-json';
import { clearSelectionTint, paintSelectionTint } from './selection-tint';
import { stepStatusKey, streamStatusKey } from './step-status';

/** The user's place in the document when the bar opened. */
interface ReturnPoint {
  element: HTMLElement;
  range: Range | null;
}

/** The least time a status line stays up. A write takes a few ms, so a shorter line looks like a glitch. */
const LINE_MS = 600;

/** The reveal class and its length. Keep REVEAL_MS at least the `blok-ai-reveal` animation in assistant.css. */
const REVEAL_CLASS = 'blok-ai-reveal';
const REVEAL_MS = 900;

const EXECUTE_TOOL = 'blok_execute';

/** A `blok_execute` input, maybe cut off, that names a sub-page with `page`. */
const aimsAtSubPage = (json: string): boolean => {
  if (!json.includes('"page"')) {
    return false;
  }
  const input = parsePartialJson(json);

  return typeof input === 'object' && input !== null && 'page' in input && typeof input.page === 'string';
};

/** What the Continue button sends. The model reads it, so it stays English. */
const CONTINUE_PROMPT = 'Continue where you stopped.';

/** Room kept between a bar scrolled into view and the window's edge. */
const REVEAL_ROOM = 16;

/** The holder's own content column. A tune may wrap it, and nested blocks have their own. */
const contentOf = (holder: HTMLElement): HTMLElement | undefined =>
  [...holder.querySelectorAll<HTMLElement>(`[${DATA_ATTR.elementContent}]`)]
    .find((content) => content.closest(`[${DATA_ATTR.element}]`) === holder);

/** A collapsed caret in `input` on a line with no text. Lines split on "\n", as in a code block's plain text. */
const isCaretOnEmptyLine = (input: HTMLElement): boolean => {
  const selection = window.getSelection();

  if (selection === null || selection.rangeCount === 0 || !selection.isCollapsed) {
    return false;
  }

  const caret = selection.getRangeAt(0);

  if (!input.contains(caret.startContainer)) {
    return false;
  }

  const before = document.createRange();

  before.selectNodeContents(input);
  before.setEnd(caret.startContainer, caret.startOffset);

  const text = input.textContent ?? '';
  const offset = before.toString().length;

  return (offset === 0 || text[offset - 1] === '\n') && (offset === text.length || text[offset] === '\n');
};

const isOpenShortcut = (event: KeyboardEvent): boolean => {
  const mac = getUserOS().mac;

  // Mac: Cmd+J. Elsewhere: Ctrl+J. The database card drawer uses Ctrl(+Shift)+J
  // for row stepping, so the other modifier must be up.
  return event.code === 'KeyJ' && !event.altKey && !event.shiftKey
    && (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);
};

export class Assistant extends Module {
  private bar: AssistantBar | null = null;
  private run: AgentRun | null = null;
  /** Editor context captured when the bar opened; focus is in the bar after that. */
  private context: UserPlace = { text: '', blockIds: [] };
  private returnPoint: ReturnPoint | null = null;
  /** Bumps on every answer, so a late result of a stopped one is ignored. */
  private answerId = 0;
  private changed = false;
  /** This answer changed the document. `changed` covers the whole run. */
  private edited = false;
  /** The answer in the bar, while Insert can put it into the page. */
  private shownReply: string | null = null;
  /** The bar's pick. Undefined when the host offers no choice. */
  private level: AgentThinkingLevel | undefined;
  /** Runs while the shown line has not had its LINE_MS yet. */
  private lineTimer: ReturnType<typeof setTimeout> | null = null;
  private shownLine: string | null = null;
  /** Lines waiting their turn. */
  private readonly lines: string[] = [];
  /** A finished answer waits for the queued lines. */
  private pendingResult: AgentRunResult | null = null;
  private preview: LivePreview | null = null;
  /** False once the answer is stopped or over, so late stream events draw nothing. */
  private listening = false;
  /** Stream index → id of the `blok_execute` call it carries, in the current model response. */
  private readonly streamCalls = new Map<number, string>();
  /** The preview drew in this answer. */
  private drawn = false;
  /** Calls that streamed input, so the preview drew them. */
  private readonly streamed = new Set<string>();
  /** Calls aimed at a sub-page's own document: nothing of theirs draws on this page. */
  private readonly elsewhere = new Set<string>();
  /** Streamed calls that ended before a frame showed any of their words (Gemini sends a call whole). */
  private readonly unseen = new Set<string>();
  /** The streaming call the status line names, and that line, until its tool_end. */
  private announced: { id: string; status: string } | null = null;
  /** The batch the running call applied, until that call reports done. Calls run one at a time. */
  private applied: ChangedSet | null = null;
  /** Edits whose stream started and that have not landed yet. */
  private readonly openEdits = new Set<string>();
  /** The newest content this answer wrote: the next edit's slots go under it. */
  private lastWrittenId: string | null = null;
  private readonly reveals = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  /** The block the bar sits under, and its neighbours when last placed: where it goes if the block is removed. */
  private anchor: { id: string; next?: string; prev?: string } | null = null;
  /** The block the bar opened at, and the first block of the part written next to it once it is found. */
  private originId: string | null = null;
  private partFirstId: string | null = null;
  private placing = false;
  /** The empty block the bar covers, when Space opened it there. */
  private inPlaceId: string | null = null;
  /** The empty block the caret sat in at open. Content the run writes next to it takes its place. */
  private emptyId: string | null = null;
  /** Blocks this open run created. */
  private readonly created = new Set<string>();
  /** Watches the bar and its anchor for size changes, and the page for removed blocks, while open. */
  private watchers: { resize: ResizeObserver | null; mutations: MutationObserver; gaps: () => void } | null = null;
  /** The pending re-place frame, if any. */
  private frame: number | null = null;

  public get isOpen(): boolean {
    return this.bar?.isOpen === true;
  }

  /** Whether an event target is inside the prompt bar, or a menu it opened. */
  public contains(target: EventTarget | null): boolean {
    return target instanceof Node && this.bar?.contains(target) === true;
  }

  public prepare(): void {
    if (!this.Blok.AgentAPI.hasAssistant) {
      return;
    }

    this.listeners.on(this.Blok.UI.nodes.wrapper, 'keydown', (event: Event) => {
      if (event instanceof KeyboardEvent && (isOpenShortcut(event) || this.isSpaceInEmptyBlock(event))) {
        event.preventDefault();
        this.open({ inPlace: !isOpenShortcut(event) });
      }
    });
    // Capture: a block's own pointerdown handler may stop it.
    this.listeners.on(document, 'pointerdown', (event: Event) => this.pressOutside(event), { capture: true });
    this.listeners.on(window, 'resize', () => this.scheduleRelayout());
    // Capture: a scrolling ancestor's scroll does not bubble to window.
    this.listeners.on(window, 'scroll', () => this.scheduleRelayout(), { capture: true, passive: true });
  }

  /** Before a run starts, a press outside closes the bar; it keeps what was typed for the next open. */
  private pressOutside(event: Event): void {
    if (!this.isOpen || this.run !== null || this.isWorking() || this.contains(event.target)) {
      return;
    }
    // The press puts the caret where it lands.
    this.close({ restoreFocus: false });
  }

  /**
   * Space in any empty block opens the bar: a paragraph (as its placeholder
   * says), a heading, a list item, a table cell. In a code block, an empty line is enough.
   */
  private isSpaceInEmptyBlock(event: KeyboardEvent): boolean {
    if (event.key !== ' ' || event.isComposing || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
      return false;
    }
    if (!this.Blok.AgentAPI.hasAssistant || this.Blok.ReadOnly.isEnabled || !(event.target instanceof HTMLElement)) {
      return false;
    }
    // A field of the tool's own (a code filename, a database cell) types its space.
    if (event.target.matches('input, textarea, select') || event.target.closest(`[${DATA_ATTR.keyboardOwner}]`) !== null) {
      return false;
    }

    const block = this.Blok.BlockManager.getBlock(event.target);

    return block !== undefined && (block.isEmpty || isCaretOnEmptyLine(event.target));
  }

  /**
   * Open the prompt bar. Does nothing without an assistant or in read-only mode.
   * @param options.inPlace - cover the caret's block while it stays empty, instead of sitting under it
   * @param options.prompt - send this prompt once the bar is open
   */
  public open(options: { inPlace?: boolean; prompt?: string } = {}): void {
    if (!this.Blok.AgentAPI.hasAssistant || this.Blok.ReadOnly.isEnabled) {
      return;
    }

    const bar = this.ensureBar();
    const opening = !bar.isOpen;

    if (opening) {
      this.context = this.Blok.AgentAPI.describeUserPlace();
      this.returnPoint = this.captureReturnPoint();

      const id = this.selectionEndBlockId() ?? this.context.blockIds[0];
      const caret = (id === undefined ? undefined : this.Blok.BlockManager.getBlockById(id))
        ?? this.Blok.BlockManager.currentBlock
        ?? this.Blok.BlockManager.lastBlock;
      const block = caret === undefined ? undefined : this.anchorFor(caret);

      this.anchor = block === undefined ? null : { id: block.id };
      this.originId = block?.id ?? null;
      this.partFirstId = null;
      this.inPlaceId = options.inPlace === true ? block?.id ?? null : null;
      // Only the block the model is told the caret is in: content goes next to it.
      this.emptyId = caret !== undefined && caret.id === this.context.blockIds[0] && caret.isEmpty
        ? caret.id
        : null;
      this.created.clear();
      // Here, before the field takes focus and the selection collapses.
      bar.setActions(assistantActions(this.actionContext(), (key) => this.Blok.I18n.t(key), this.config.agent?.assistant?.actions));
      if (this.selectionEndBlockId() !== undefined) {
        paintSelectionTint(this, window.getSelection()?.getRangeAt(0) ?? document.createRange());
      }
    }
    syncPortalDirection(bar.element, { source: this.Blok.UI.nodes.wrapper });
    this.syncThinking();

    const block = this.anchorBlock();

    if (block === undefined) {
      return;
    }
    // The + and drag handle would sit beside the bar, for a block it covers or works on.
    this.Blok.Toolbar.setSuppressed(true);
    bar.open(block.holder, this.columnOf(block.holder), this.coversBlock(block));
    this.remember(block);
    this.watch();
    if (opening) {
      this.revealBar(bar.home);
    }
    if (options.prompt !== undefined) {
      this.submit(options.prompt);
    }
  }

  /** Once, on open: bring a bar placed past the window's edge into view. Later scrolls are the user's. */
  private revealBar(rect: { top: number; bottom: number }): void {
    const below = rect.bottom + REVEAL_ROOM - window.innerHeight;
    const above = rect.top - REVEAL_ROOM;
    const top = below > 0 ? below : Math.min(above, 0);

    if (top !== 0) {
      window.scrollBy({ top, behavior: prefersReducedMotion() ? 'instant' : 'smooth' });
    }
  }

  /**
   * Close the bar. An open run keeps its edits.
   * @param options.restoreFocus - put the caret back where the user left it
   */
  public close(options: { restoreFocus?: boolean } = {}): void {
    this.answerId += 1;
    this.clearLines();
    this.endStream();
    this.run?.stop();
    this.run?.end();
    this.run = null;
    this.changed = false;
    this.shownReply = null;
    this.unwatch();
    this.bar?.close();
    clearSelectionTint(this);
    this.Blok.Toolbar.setSuppressed(false);
    if (this.emptyId !== null) {
      this.Blok.BlockManager.getBlockById(this.emptyId)?.holder.removeAttribute(DATA_ATTR.aiConsumed);
    }
    this.anchor = null;
    this.originId = null;
    this.partFirstId = null;
    this.inPlaceId = null;
    this.emptyId = null;
    this.created.clear();

    const back = this.returnPoint;

    this.returnPoint = null;
    if (options.restoreFocus !== false && back !== null && back.element.isConnected) {
      back.element.focus({ preventScroll: true });
      if (back.range !== null) {
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(back.range);
      }
    }
  }

  public toggleReadOnly(readOnly: boolean): void {
    if (readOnly && this.isOpen) {
      this.close({ restoreFocus: false });
    }
  }

  public destroy(): void {
    this.close({ restoreFocus: false });
    this.unwatch();
    this.reveals.forEach((timer, content) => {
      clearTimeout(timer);
      content.classList.remove(REVEAL_CLASS);
    });
    this.reveals.clear();
    this.bar?.element.remove();
    this.bar = null;
    this.listeners.removeAll();
  }

  private ensureBar(): AssistantBar {
    this.bar ??= new AssistantBar((key, vars) => this.Blok.I18n.t(key, vars), {
      onSubmit: (prompt) => this.submit(prompt),
      onStop: () => this.stopAnswer(),
      onKeep: () => this.close(),
      onDiscard: () => void this.discard(),
      onContinue: () => this.submit(CONTINUE_PROMPT),
      onInsert: () => void this.insertAnswer(),
      onEscape: () => this.escape(),
      onThinking: (level) => {
        this.level = level;
        this.syncThinking();
      },
    });

    return this.bar;
  }

  private submit(prompt: string): void {
    const pending = this.run === null
      ? this.startRun(prompt)
      : this.run.followUp(prompt);

    if (pending === null) {
      return;
    }

    const id = ++this.answerId;

    this.listening = true;
    this.edited = false;
    this.openEdits.clear();
    this.lastWrittenId = null;
    this.clearLines();
    this.bar?.render({ kind: 'working', status: '' });
    this.drawn = false;
    this.say(this.activityStatus('thinking'));
    void pending.then(async (result) => {
      if (id === this.answerId) {
        await this.consumeEmpty();
      }
      if (id === this.answerId) {
        this.finish(result);
      }
    });
  }

  /**
   * Show the line for the step the run is on. Hosts reword it with i18n messages.
   * @param activity - 'thinking', or the tool the model calls
   * @param input - that tool's input
   */
  private activity(activity: string, input?: unknown): void {
    if (!this.isWorking()) {
      return;
    }

    // A model that does not stream says it edits only here.
    if (activity === EXECUTE_TOOL) {
      this.showEditSlots();
    }
    // Its stream already named it.
    if (activity === EXECUTE_TOOL && this.announced !== null) {
      return;
    }

    this.say(this.activityStatus(activity, input));
  }

  /**
   * Queues a line. Each line stays up for LINE_MS, so steps that come faster
   * all show, in order. A queued Thinking is dropped once a later step comes.
   */
  private say(status: string): void {
    const thinking = this.activityStatus('thinking');

    if (status !== thinking) {
      while (this.lines.at(-1) === thinking) {
        this.lines.pop();
      }
    }
    if (status === (this.lines.at(-1) ?? this.shownLine)) {
      return;
    }
    this.lines.push(status);
    if (this.lineTimer === null) {
      this.nextLine();
    }
  }

  private nextLine(): void {
    this.lineTimer = null;
    const status = this.lines.shift();

    if (status === undefined) {
      const result = this.pendingResult;

      this.pendingResult = null;
      if (result !== null) {
        this.show(result);
      }

      return;
    }
    if (!this.isWorking()) {
      return;
    }
    this.shownLine = status;
    this.bar?.render({ kind: 'working', status });
    this.lineTimer = setTimeout(() => this.nextLine(), LINE_MS);
  }

  /** A finished answer shows once the queued steps have shown. Any other end shows at once. */
  private finish(result: AgentRunResult): void {
    const thinking = this.activityStatus('thinking');

    while (this.lines.at(-1) === thinking) {
      this.lines.pop();
    }
    if (result.status !== 'done' || this.lineTimer === null) {
      this.show(result);

      return;
    }
    this.pendingResult = result;
  }

  /** Names a streaming call from its first words, once the part that picks the line is whole. */
  private announce(id: string, json: string): void {
    const key = this.isWorking() ? streamStatusKey(json, (blockId) => this.Blok.BlockManager.getBlockById(blockId)?.name) : null;

    if (key === null) {
      return;
    }

    const status = this.Blok.I18n.t(key);

    if (this.announced?.id === id && this.announced.status === status) {
      return;
    }
    this.announced = { id, status };
    this.say(status);
  }

  private activityStatus(activity: string, input?: unknown): string {
    const key = stepStatusKey(activity, input, (id) => this.Blok.BlockManager.getBlockById(id)?.name);

    return this.Blok.I18n.t(key);
  }

  private clearLines(): void {
    if (this.lineTimer !== null) {
      clearTimeout(this.lineTimer);
    }
    this.lineTimer = null;
    this.shownLine = null;
    this.lines.length = 0;
    this.pendingResult = null;
  }

  private startRun(prompt: string): Promise<AgentRunResult> | null {
    try {
      this.run = this.Blok.AgentAPI.startRun(prompt, this.context, () => this.level, {
        onActivity: (activity, input) => this.activity(activity, input),
        onStream: (event) => this.stream(event),
        onToolDone: (id, _name, result) => this.toolDone(id, result),
        onExecuted: (changed) => this.executed(changed),
      });

      return this.run.result;
    } catch (thrown) {
      // A host turn is open, so the assistant cannot start one.
      this.bar?.render({ kind: 'error', message: thrown instanceof Error ? thrown.message : String(thrown), changed: false });

      return null;
    }
  }

  private syncThinking(): void {
    const choice = ((): ThinkingChoice | null => {
      try {
        return this.Blok.AgentAPI.thinkingChoice();
      } catch {
        // A bad config is reported when the user sends.
        return null;
      }
    })();

    this.level ??= choice?.initial;
    this.bar?.setThinking(choice === null || this.level === undefined ? null : { levels: choice.levels, current: this.level });
  }

  private show(result: AgentRunResult): void {
    this.clearLines();
    this.endStream();
    this.changed = this.changed || result.changed.length > 0;

    const messages: Record<Exclude<AgentRunResult['status'], 'done' | 'failed'>, string> = {
      stopped: 'assistant.stopped',
      refused: 'assistant.refused',
      truncated: 'assistant.truncated',
      'step-limit': 'assistant.stepLimit',
    };

    this.shownReply = result.status === 'done' && !this.edited ? result.reply : null;
    if (result.status === 'done') {
      this.bar?.render({ kind: 'answered', reply: result.reply, changed: this.changed, edited: this.edited });
    } else {
      const message = result.status === 'failed'
        ? this.Blok.I18n.t('assistant.failed', { error: result.error ?? '' })
        : this.Blok.I18n.t(messages[result.status]);

      this.bar?.render({ kind: 'error', message, changed: this.changed, resumable: result.status === 'step-limit' });
    }
    this.bar?.focusField();
  }

  /** Put the shown answer under the bar's block, as Markdown, in the run's turn so Undo covers it. */
  private async insertAnswer(): Promise<void> {
    const reply = this.shownReply;
    // Under what this run wrote, else under the bar's block.
    const after = this.generatedPart()?.last ?? this.anchorBlock();

    if (this.run === null || reply === null || after === undefined) {
      return;
    }

    const id = ++this.answerId;

    // Taken before the await: a second press while the batch runs finds nothing to insert.
    this.shownReply = null;
    const result = await this.Blok.AgentAPI.executeInRun({
      commands: [{ name: 'markdown.insert', args: { markdown: reply, parentId: after.parentId, position: { after: after.id } } }],
    });

    if (id !== this.answerId) {
      return;
    }
    if (!result.ok) {
      this.bar?.render({ kind: 'error', message: this.Blok.I18n.t('assistant.failed', { error: result.error.message }), changed: this.changed });

      return;
    }
    result.changed.created.forEach((blockId) => this.created.add(blockId));
    await this.consumeEmpty();
    if (id !== this.answerId) {
      return;
    }
    this.changed = true;
    this.edited = true;
    this.bar?.render({ kind: 'answered', reply: this.Blok.I18n.t('assistant.inserted'), changed: true, edited: true });
    this.bar?.focusField();
  }

  /**
   * Content the run wrote right next to the empty block the user asked in
   * takes that block's place. Content put elsewhere leaves it. The delete
   * joins the run, so Discard brings the block back.
   */
  private async consumeEmpty(): Promise<void> {
    const manager = this.Blok.BlockManager;
    const block = this.emptyId === null ? undefined : manager.getBlockById(this.emptyId);

    if (this.run === null || block === undefined || !this.isReplaced(block)) {
      return;
    }
    this.emptyId = null;
    await this.Blok.AgentAPI.executeInRun({ commands: [{ name: 'block.delete', args: { id: block.id } }] });
  }

  private async discard(): Promise<void> {
    const run = this.run;

    this.answerId += 1;
    this.run = null;

    const undone = run === null ? true : await run.discard();

    if (undone) {
      this.close();

      return;
    }
    // The user edited after the assistant, so its steps are no longer on top.
    this.changed = false;
    this.bar?.render({ kind: 'error', message: this.Blok.I18n.t('assistant.discardBlocked'), changed: false });
    this.bar?.focusField();
  }

  private escape(): void {
    if (this.bar !== null && this.run !== null && this.isWorking()) {
      this.stopAnswer();

      return;
    }
    this.close();
  }

  private stopAnswer(): void {
    this.endStream();
    this.run?.stop();
  }

  /** Stop drawing: whatever is still previewed will not commit from here. */
  private endStream(): void {
    this.setSlots(false);
    this.openEdits.clear();
    this.lastWrittenId = null;
    this.listening = false;
    this.streamCalls.clear();
    this.streamed.clear();
    this.unseen.clear();
    this.elsewhere.clear();
    this.announced = null;
    this.applied = null;
    this.preview?.clear();
    // Models reuse call ids across runs (call-1-0), so each run starts a fresh preview.
    this.preview = null;
  }

  private stream(event: AgentModelStreamEvent): void {
    if (!this.listening) {
      return;
    }
    if (event.type === 'tool_start') {
      if (event.name === EXECUTE_TOOL) {
        this.streamCalls.set(event.index, event.id);
        this.openEdits.add(event.id);
        this.showEditSlots();
      } else {
        this.streamCalls.delete(event.index);
      }

      return;
    }

    const id = this.streamCalls.get(event.index);

    // tool_end draws nothing: the call's result settles or cancels it.
    // The model may write `page` after `commands`, so the call can turn out to be elsewhere mid-stream.
    if (event.type === 'tool_input' && id !== undefined && !this.elsewhere.has(id) && aimsAtSubPage(event.json)) {
      this.elsewhere.add(id);
      this.streamed.delete(id);
      this.preview?.cancel(id);
    }
    if (event.type === 'tool_input' && id !== undefined && !this.elsewhere.has(id)) {
      this.streamed.add(id);
      this.ensurePreview().update(id, event.json);
    }
    if (event.type === 'tool_input' && id !== undefined) {
      this.announce(id, event.json);
    }
    if (event.type === 'tool_end' && id !== undefined && this.preview?.shown(id) !== true) {
      this.unseen.add(id);
    }
    // The loop reports the call's execute before this event, so the line stays put through it.
    if (event.type === 'tool_end' && this.announced?.id === id) {
      this.announced = null;
    }
  }

  private executed(changed: ChangedSet): void {
    changed.created.forEach((blockId) => this.created.add(blockId));
    if (!this.listening) {
      return;
    }
    this.applied = changed;
    this.edited = this.edited || [changed.created, changed.updated, changed.moved, changed.removed].some((ids) => ids.length > 0);
    // Block heights changed, so boxes of other calls move.
    this.preview?.relayout();
  }

  private toolDone(id: string, result: AgentToolResult): void {
    this.openEdits.delete(id);
    if (!this.listening) {
      return;
    }

    const changed = this.applied;
    // A call the user never saw stream gets the fallback reveal, like one that did not stream.
    const unseen = this.unseen.delete(id);
    const streamed = this.streamed.delete(id) && !unseen;

    this.applied = null;
    // Unseen: the reveal plays over the real block, so the overlay goes at once.
    if (result.isError || unseen) {
      this.preview?.cancel(id);
    } else {
      this.preview?.settle(id);
    }
    if (changed === null) {
      return;
    }
    this.landed(changed);
    // A call with no stream, or a rewrite the preview did not draw, replays its words now.
    const framed = this.preview?.framed(id) ?? [];

    this.reveal(streamed
      ? changed.updated.filter((blockId) => !framed.includes(blockId))
      : [...changed.created, ...changed.updated]);
  }

  /**
   * Content showed up, so the slots leave its place. An edit already on its way
   * keeps them, under the newest content, where it will most likely land.
   */
  private landed(changed: ChangedSet): void {
    if ([changed.created, changed.updated, changed.moved, changed.removed].every((ids) => ids.length === 0)) {
      return;
    }

    const manager = this.Blok.BlockManager;
    const created = new Set(changed.created);
    // Only top blocks of what was written: a table's cell blocks sit inside it.
    const lowest = changed.created
      .map((blockId) => manager.getBlockById(blockId))
      .filter((block): block is Block => block !== undefined && (block.parentId === null || !created.has(block.parentId)))
      .sort((a, b) => manager.getBlockIndex(a) - manager.getBlockIndex(b))
      .at(-1);

    this.lastWrittenId = lowest?.id ?? this.lastWrittenId;
    this.setSlots(this.openEdits.size > 0 && !this.drawn);
  }

  /** Re-plays the word fade-in over committed blocks. A class on the content column is inert to the block. */
  private reveal(blockIds: string[]): void {
    if (prefersReducedMotion()) {
      return;
    }
    new Set(blockIds).forEach((blockId) => {
      const holder = this.Blok.BlockManager.getBlockById(blockId)?.holder;
      const content = holder === undefined ? undefined : contentOf(holder);

      if (content === undefined) {
        return;
      }
      clearTimeout(this.reveals.get(content));
      content.classList.add(REVEAL_CLASS);
      this.reveals.set(content, setTimeout(() => {
        content.classList.remove(REVEAL_CLASS);
        this.reveals.delete(content);
      }, REVEAL_MS));
    });
  }

  private ensurePreview(): LivePreview {
    this.preview ??= createLivePreview({
      layer: this.Blok.UI.nodes.wrapper,
      holderOf: (id) => this.Blok.BlockManager.getBlockById(id)?.holder ?? null,
      edgeHolder: (edge, parentId) => this.edgeHolder(edge, parentId),
      anchorHolder: () => this.anchorHolder(),
      inputOf: (id, field) => this.inputOf(id, field),
      // The preview shows where edits land, so the slots go. No re-place here: the
      // layout's gap writes re-place the bar once, which drops the slots' gap too.
      onDraw: () => {
        this.drawn = true;
        this.bar?.setSlots(false);
      },
      t: (key) => this.Blok.I18n.t(key),
    });

    return this.preview;
  }

  /** The block the executor puts a 'start' or 'end' insert next to: first or last child of the parent, or of the page. */
  private edgeHolder(edge: 'start' | 'end', parentId?: string): HTMLElement | null {
    const manager = this.Blok.BlockManager;
    const ids = parentId === undefined
      ? manager.blocks.filter((block) => block.parentId === null).map((block) => block.id)
      : manager.getBlockById(parentId)?.contentIds ?? [];
    const id = edge === 'start' ? ids[0] : ids[ids.length - 1];

    return id === undefined ? null : manager.getBlockById(id)?.holder ?? null;
  }

  /**
   * Where an insert with no position yet waits: under the part the answer wrote,
   * else under the bar's anchor while open, else the block the bar opened at, else the current one, else the last.
   */
  private anchorHolder(): HTMLElement | null {
    const open = this.generatedPart()?.last.holder ?? this.bar?.anchorHolder;

    if (open !== null && open !== undefined) {
      return open;
    }

    const manager = this.Blok.BlockManager;
    const captured = this.context.blockIds[0];
    const block = (captured === undefined ? undefined : manager.getBlockById(captured)) ?? manager.currentBlock ?? manager.lastBlock;

    return block?.holder ?? null;
  }

  /** Where the bar opens, for the actions it offers. */
  private actionContext(): ActionContext {
    if (this.selectionEndBlockId() !== undefined) {
      return 'selection';
    }

    return this.Blok.BlockManager.blocks.every((block) => block.isEmpty) ? 'empty' : 'caret';
  }

  /**
   * The last block a selection covers. A range that ends at offset 0 (a
   * triple-click) ends at the start of the next block, which it does not cover.
   */
  private selectionEndBlockId(): string | undefined {
    const selection = window.getSelection();

    if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) {
      return undefined;
    }

    const manager = this.Blok.BlockManager;
    const range = selection.getRangeAt(0);
    const start = manager.getBlockByChildNode(range.startContainer);
    const end = manager.getBlockByChildNode(range.endContainer);

    if (start === undefined || end === undefined) {
      return undefined;
    }

    return range.endOffset === 0 && end !== start
      ? (manager.blocks[manager.getBlockIndex(end) - 1] ?? end).id
      : end.id;
  }

  /**
   * The anchor block if its holder is still on the page. Else the block after
   * it when last placed, else the one before, else the last block.
   */
  private anchorBlock(): Block | undefined {
    const manager = this.Blok.BlockManager;
    const anchor = this.anchor;
    const ids = anchor === null ? [] : [anchor.id, anchor.next, anchor.prev];
    const live = ids
      .map((id) => (id === undefined ? undefined : manager.getBlockById(id)))
      .find((block) => block?.holder.isConnected === true);

    return live ?? manager.lastBlock;
  }

  private remember(block: Block): void {
    const manager = this.Blok.BlockManager;
    const index = manager.getBlockIndex(block);

    this.anchor = { id: block.id, next: manager.blocks[index + 1]?.id, prev: manager.blocks[index - 1]?.id };
  }

  /**
   * Where the bar goes for a caret block. A gap under a block that shares its
   * row (a column, a table cell) leaves the neighbours under the bar, so the bar
   * goes under the container of the outermost such block. A stacked container
   * (toggle, callout, list) opens space lawfully, so the caret's block keeps it.
   */
  private anchorFor(caret: Block): Block {
    const manager = this.Blok.BlockManager;
    const parentOf = (block: Block): Block | undefined =>
      block.parentId === null ? undefined : manager.getBlockById(block.parentId);
    const up = (block: Block | undefined): Block[] => (block === undefined ? [] : [block, ...up(parentOf(block))]);
    const chain = up(caret);
    const outermostInRow = chain.map((block) => this.sharesRow(block)).lastIndexOf(true);

    return outermostInRow === -1 ? caret : chain[outermostInRow + 1] ?? caret;
  }

  /** Side by side, from layout: a shown sibling overlaps it vertically and not horizontally. */
  private sharesRow(block: Block): boolean {
    if (block.parentId === null) {
      return false;
    }

    const rect = block.holder.getBoundingClientRect();

    return this.Blok.BlockManager.blocks.some((other) => {
      if (other === block || other.parentId !== block.parentId) {
        return false;
      }

      const near = other.holder.getBoundingClientRect();

      // A hidden sibling (a closed tab, display:none) is all zeros: it would "overlap" any block across y 0.
      if (near.width === 0 || near.height === 0) {
        return false;
      }

      return near.top < rect.bottom && rect.top < near.bottom && (near.right <= rect.left || rect.right <= near.left);
    });
  }

  /** The anchor's own content column: inside a stacked container the bar lines up with its indented text. */
  private columnOf(holder: HTMLElement): AssistantBarColumn {
    const rect = (contentOf(holder) ?? holder).getBoundingClientRect();

    return { left: rect.left, width: rect.width };
  }

  /** Once the covered block gets content, the bar goes under it so the content shows. */
  private coversBlock(block: Block): boolean {
    return block.id === this.inPlaceId && block.isEmpty;
  }

  /** Ids of the block and its siblings, in order. */
  private siblingIds(block: Block): string[] {
    const manager = this.Blok.BlockManager;

    return block.parentId === null
      ? manager.blocks.filter((other) => other.parentId === null).map((other) => other.id)
      : manager.getBlockById(block.parentId)?.contentIds ?? [];
  }

  /**
   * The part this answer wrote at the bar's spot: the new blocks in a row right
   * after the block it opened at. Right before it counts too when that block is
   * the empty one the part replaces; before a block with text, the part is not under the bar.
   * Once the empty block is gone, the part is found from its first block.
   */
  private generatedPart(): { first: Block; last: Block } | null {
    const manager = this.Blok.BlockManager;
    const seed = [this.originId, this.partFirstId]
      .map((id) => (id === null ? undefined : manager.getBlockById(id)))
      .find((block) => block?.holder.isConnected === true);

    if (seed === undefined) {
      return null;
    }

    const siblings = this.siblingIds(seed);
    const at = siblings.indexOf(seed.id);
    const isCreated = (index: number): boolean => this.created.has(siblings[index] ?? '');
    const from = [at, at + 1, ...(seed.id === this.emptyId ? [at - 1] : [])].find(isCreated);

    if (from === undefined) {
      return null;
    }

    const edge = (index: number, step: number): number => (isCreated(index + step) ? edge(index + step, step) : index);
    const first = manager.getBlockById(siblings[edge(from, -1)] ?? '');
    const last = manager.getBlockById(siblings[edge(from, 1)] ?? '');

    return first === undefined || last === undefined ? null : { first, last };
  }

  /** The empty block is still empty and this run wrote right next to it: the run deletes it when it ends. */
  private isReplaced(empty: Block): boolean {
    const siblings = this.siblingIds(empty);
    const index = siblings.indexOf(empty.id);

    return empty.isEmpty && [siblings[index - 1], siblings[index + 1]].some((id) => id !== undefined && this.created.has(id));
  }

  /** The empty block a run writes next to takes no room from then on, so nothing moves when the run deletes it. */
  private collapseEmpty(): void {
    const empty = this.emptyId === null ? undefined : this.Blok.BlockManager.getBlockById(this.emptyId);

    if (empty !== undefined) {
      empty.holder.toggleAttribute(DATA_ATTR.aiConsumed, this.isReplaced(empty));
    }
  }

  /** Re-place the bar at its anchor, re-anchoring if the block is gone. */
  private placeBar(): void {
    const bar = this.bar;

    if (bar === null || !bar.isOpen || this.placing) {
      return;
    }

    // Over the part it wrote, from its first block to its last.
    const part = this.generatedPart();
    const block = part?.first ?? this.anchorBlock();

    if (block === undefined) {
      return;
    }

    const moved = bar.anchorHolder !== block.holder;

    this.placing = true;
    try {
      if (part === null) {
        bar.place(block.holder, this.columnOf(block.holder), this.coversBlock(block));
      } else {
        bar.place(block.holder, this.columnOf(block.holder), false, { side: 'start', end: part.last.holder });
      }
    } finally {
      this.placing = false;
    }
    if (part === null) {
      this.remember(block);
    } else {
      this.partFirstId = part.first.id;
    }
    this.collapseEmpty();
    if (moved) {
      this.watchers?.resize?.disconnect();
      this.watchers?.resize?.observe(bar.element);
      this.watchers?.resize?.observe(this.Blok.UI.nodes.redactor);
      this.watchers?.resize?.observe(block.holder);
      // Inserts waiting under the bar follow it to its new block.
      this.preview?.relayout();
    }
  }

  /** Scroll, resize and mutations come many to a frame: re-place once, on the next one. */
  private scheduleRelayout(): void {
    if (this.frame !== null) {
      return;
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.relayout();
    });
  }

  /** The page moved or resized: the bar and the preview follow. */
  private relayout(): void {
    this.placeBar();
    this.preview?.relayout();
  }

  /** Slots show only once the model starts an edit, so a question gets none. Once the preview draws, it shows where edits land. */
  private showEditSlots(): void {
    if (!this.drawn) {
      this.setSlots(true);
    }
  }

  private setSlots(shown: boolean): void {
    const written = this.lastWrittenId === null ? undefined : this.Blok.BlockManager.getBlockById(this.lastWrittenId);
    const under = shown ? written?.holder ?? null : null;

    if (this.bar === null || (this.bar.slotsShown === shown && this.bar.slotsUnderHolder === under)) {
      return;
    }
    this.bar.setSlots(shown, under);
    this.relayout();
  }

  private watch(): void {
    const bar = this.bar;

    if (bar === null || this.watchers !== null) {
      return;
    }

    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.scheduleRelayout()) : null;
    // childList only: the bar's own gap writes are attributes, and would loop.
    const mutations = new MutationObserver(() => this.scheduleRelayout());
    const redactor = this.Blok.UI.nodes.redactor;
    // Any gap in this editor: one above the anchor moves it too.
    const gaps = onGapChange((holders) => {
      if (holders.some((holder) => redactor.contains(holder))) {
        this.placeBar();
      }
    });

    resize?.observe(bar.element);
    // The page: a block above that grows (an image loads, a toggle opens) moves the anchor.
    resize?.observe(redactor);
    if (bar.anchorHolder !== null) {
      resize?.observe(bar.anchorHolder);
    }
    mutations.observe(this.Blok.UI.nodes.redactor, { childList: true, subtree: true });
    this.watchers = { resize, mutations, gaps };
  }

  private unwatch(): void {
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    this.watchers?.resize?.disconnect();
    this.watchers?.mutations.disconnect();
    this.watchers?.gaps();
    this.watchers = null;
  }

  /** The input that edits `field`, from the same field map the agent caret uses. No field: the first input. */
  private inputOf(id: string, field?: string): HTMLElement | null {
    const block = this.Blok.BlockManager.getBlockById(id);

    if (block === undefined) {
      return null;
    }
    if (field === undefined) {
      return block.inputs[0] ?? null;
    }

    const index = this.Blok.AgentAPI.inputIndexFor(id, field);

    return index === null ? null : block.inputs[index] ?? null;
  }

  private isWorking(): boolean {
    return this.bar?.element.hasAttribute('data-blok-assistant-working') === true;
  }

  private captureReturnPoint(): ReturnPoint | null {
    const active = document.activeElement;

    if (!(active instanceof HTMLElement) || !this.Blok.UI.nodes.wrapper.contains(active)) {
      return null;
    }

    const selection = window.getSelection();
    const range = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;

    return { element: active, range };
  }
}
