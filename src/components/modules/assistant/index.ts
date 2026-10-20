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

import { AssistantBar, type AssistantBarColumn } from './assistant-bar';
import { onGapChange } from './gap';
import { createLivePreview, type LivePreview } from './live-preview';
import { stepStatusKey, streamStatusKey } from './step-status';

/** The user's place in the document when the bar opened. */
interface ReturnPoint {
  element: HTMLElement;
  range: Range | null;
}

/** How long a line naming a write stays up before "Thinking…" may replace it. */
const WRITE_HOLD_MS = 1500;

/** The reveal class and its length. Keep REVEAL_MS at least the `blok-ai-reveal` animation in assistant.css. */
const REVEAL_CLASS = 'blok-ai-reveal';
const REVEAL_MS = 900;

const EXECUTE_TOOL = 'blok_execute';

/** Room kept between a bar scrolled into view and the window's edge. */
const REVEAL_ROOM = 16;

/** The holder's own content column. A tune may wrap it, and nested blocks have their own. */
const contentOf = (holder: HTMLElement): HTMLElement | undefined =>
  [...holder.querySelectorAll<HTMLElement>(`[${DATA_ATTR.elementContent}]`)]
    .find((content) => content.closest(`[${DATA_ATTR.element}]`) === holder);

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
  /** The bar's pick. Undefined when the host offers no choice. */
  private level: AgentThinkingLevel | undefined;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  /** The line waiting for the hold to end. */
  private heldStatus: string | null = null;
  private preview: LivePreview | null = null;
  /** False once the answer is stopped or over, so late stream events draw nothing. */
  private listening = false;
  /** Stream index → id of the `blok_execute` call it carries, in the current model response. */
  private readonly streamCalls = new Map<number, string>();
  /** Calls that streamed input, so the preview drew them. */
  private readonly streamed = new Set<string>();
  /** Streamed calls that ended before a frame showed any of their words (Gemini sends a call whole). */
  private readonly unseen = new Set<string>();
  /** The streaming call the status line names, and that line, until its tool_end. */
  private announced: { id: string; status: string } | null = null;
  /** The batch the running call applied, until that call reports done. Calls run one at a time. */
  private applied: ChangedSet | null = null;
  private readonly reveals = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  /** The block the bar sits under, and its neighbours when last placed: where it goes if the block is removed. */
  private anchor: { id: string; next?: string; prev?: string } | null = null;
  private placing = false;
  /** Watches the bar and its anchor for size changes, and the page for removed blocks, while open. */
  private watchers: { resize: ResizeObserver | null; mutations: MutationObserver; gaps: () => void } | null = null;
  /** Set by the first stream event ever seen: from then on the model streams, so the bar shows no slots. */
  private streams = false;
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
      if (event instanceof KeyboardEvent && isOpenShortcut(event)) {
        event.preventDefault();
        this.open();
      }
    });
    this.listeners.on(window, 'resize', () => this.scheduleRelayout());
    // Capture: a scrolling ancestor's scroll does not bubble to window.
    this.listeners.on(window, 'scroll', () => this.scheduleRelayout(), { capture: true, passive: true });
  }

  /**
   * Open the prompt bar. Does nothing without an assistant or in read-only mode.
   */
  public open(): void {
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
    }
    syncPortalDirection(bar.element, { source: this.Blok.UI.nodes.wrapper });
    this.syncThinking();

    const block = this.anchorBlock();

    if (block === undefined) {
      return;
    }
    bar.open(block.holder, this.columnOf(block.holder));
    this.remember(block);
    this.watch();
    if (opening) {
      this.revealBar(bar.element);
    }
  }

  /** Once, on open: bring a bar placed past the window's edge into view. Later scrolls are the user's. */
  private revealBar(element: HTMLElement): void {
    const rect = element.getBoundingClientRect();
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
    this.clearHold();
    this.endStream();
    this.run?.stop();
    this.run?.end();
    this.run = null;
    this.changed = false;
    this.unwatch();
    this.bar?.close();
    this.anchor = null;

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
      onEscape: () => this.escape(),
      onThinking: (level) => {
        this.level = level;
        this.syncThinking();
      },
    });

    return this.bar;
  }

  private submit(prompt: string): void {
    if (this.run === null) {
      // Each run learns again whether its model streams.
      this.streams = false;
    }

    const pending = this.run === null
      ? this.startRun(prompt)
      : this.run.followUp(prompt);

    if (pending === null) {
      return;
    }

    const id = ++this.answerId;

    this.listening = true;
    this.bar?.render({ kind: 'working', status: this.activityStatus('thinking') });
    this.setSlots(!this.streams);
    void pending.then((result) => {
      if (id === this.answerId) {
        this.show(result);
      }
    });
  }

  /**
   * Show the line for the step the run is on. Hosts reword it with i18n messages.
   * A line naming a write stays up for WRITE_HOLD_MS: the write itself takes a few
   * milliseconds, so the next "Thinking…" would hide it at once.
   * @param activity - 'thinking', or the tool the model calls
   * @param input - that tool's input
   */
  private activity(activity: string, input?: unknown): void {
    if (!this.isWorking()) {
      return;
    }

    // Its stream already named it, and the hold runs from its first words.
    if (activity === EXECUTE_TOOL && this.announced !== null) {
      return;
    }

    const status = this.activityStatus(activity, input);

    if (activity === 'thinking' && this.holdTimer !== null) {
      this.heldStatus = status;

      return;
    }
    if (activity === EXECUTE_TOOL) {
      this.showWrite(status);

      return;
    }
    this.clearHold();
    this.bar?.render({ kind: 'working', status });
  }

  /** Shows a line naming a write, and holds it for WRITE_HOLD_MS. */
  private showWrite(status: string): void {
    this.clearHold();
    this.bar?.render({ kind: 'working', status });
    this.holdTimer = setTimeout(() => {
      const held = this.heldStatus;

      this.holdTimer = null;
      this.heldStatus = null;
      if (held !== null && this.isWorking()) {
        this.bar?.render({ kind: 'working', status: held });
      }
    }, WRITE_HOLD_MS);
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
    this.showWrite(status);
  }

  private activityStatus(activity: string, input?: unknown): string {
    const key = stepStatusKey(activity, input, (id) => this.Blok.BlockManager.getBlockById(id)?.name);

    return this.Blok.I18n.t(key);
  }

  private clearHold(): void {
    if (this.holdTimer !== null) {
      clearTimeout(this.holdTimer);
    }
    this.holdTimer = null;
    this.heldStatus = null;
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
    this.clearHold();
    this.endStream();
    this.changed = this.changed || result.changed.length > 0;

    const messages: Record<Exclude<AgentRunResult['status'], 'done' | 'failed'>, string> = {
      stopped: 'assistant.stopped',
      refused: 'assistant.refused',
      truncated: 'assistant.truncated',
      'step-limit': 'assistant.stepLimit',
    };

    if (result.status === 'done') {
      this.bar?.render({ kind: 'answered', reply: result.reply, changed: this.changed });
    } else {
      const message = result.status === 'failed'
        ? this.Blok.I18n.t('assistant.failed', { error: result.error ?? '' })
        : this.Blok.I18n.t(messages[result.status]);

      this.bar?.render({ kind: 'error', message, changed: this.changed });
    }
    this.bar?.focusField();
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
    this.listening = false;
    this.streamCalls.clear();
    this.streamed.clear();
    this.unseen.clear();
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
    // The model streams: the preview shows where edits land, so the slots go.
    this.streams = true;
    this.setSlots(false);
    if (event.type === 'tool_start') {
      if (event.name === EXECUTE_TOOL) {
        this.streamCalls.set(event.index, event.id);
      } else {
        this.streamCalls.delete(event.index);
      }

      return;
    }

    const id = this.streamCalls.get(event.index);

    // tool_end draws nothing: the call's result settles or cancels it.
    if (event.type === 'tool_input' && id !== undefined) {
      this.streamed.add(id);
      this.ensurePreview().update(id, event.json);
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
    if (!this.listening) {
      return;
    }
    this.applied = changed;
    this.setSlots(false);
    // Block heights changed, so boxes of other calls move.
    this.preview?.relayout();
  }

  private toolDone(id: string, result: AgentToolResult): void {
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
    // A call with no stream, or a rewrite the preview had to skip, replays its words now.
    this.reveal(streamed
      ? this.preview?.skipped(id).filter((blockId) => changed.updated.includes(blockId)) ?? []
      : [...changed.created, ...changed.updated]);
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
      onWord: (word) => this.Blok.AgentAPI.followLive(word),
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

  /** The bar's anchor while open; else the block the bar opened at, else the current one, else the last. */
  private anchorHolder(): HTMLElement | null {
    const open = this.bar?.anchorHolder;

    if (open !== null && open !== undefined) {
      return open;
    }

    const manager = this.Blok.BlockManager;
    const captured = this.context.blockIds[0];
    const block = (captured === undefined ? undefined : manager.getBlockById(captured)) ?? manager.currentBlock ?? manager.lastBlock;

    return block?.holder ?? null;
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

  /** Re-place the bar at its anchor, re-anchoring if the block is gone. */
  private placeBar(): void {
    const bar = this.bar;

    if (bar === null || !bar.isOpen || this.placing) {
      return;
    }

    const block = this.anchorBlock();

    if (block === undefined) {
      return;
    }

    const moved = bar.anchorHolder !== block.holder;

    this.placing = true;
    try {
      bar.place(block.holder, this.columnOf(block.holder));
    } finally {
      this.placing = false;
    }
    this.remember(block);
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

  private setSlots(shown: boolean): void {
    if (this.bar === null || this.bar.slotsShown === shown) {
      return;
    }
    this.bar.setSlots(shown);
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
    const gaps = onGapChange((holder) => {
      if (redactor.contains(holder)) {
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
