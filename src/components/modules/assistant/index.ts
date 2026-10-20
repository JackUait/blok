/**
 * The in-editor AI assistant: Mod+J (or "Ask AI") opens a prompt bar, and
 * `editor.agent.ask()` writes the answer into the document live.
 *
 * Present only when `agent.assistant.model` is configured.
 */
import type { ChangedSet } from '../../../../types/agent';
import type { AgentModelStreamEvent, AgentRun, AgentRunResult, AgentThinkingLevel, AgentToolResult } from '../../../../types/api';
import type { ThinkingChoice } from '../../../agent/thinking';
import type { UserPlace } from '../api/agent';
import { Module } from '../../__module';
import { DATA_ATTR } from '../../constants/data-attributes';
import { getUserOS } from '../../utils/browser';
import { syncPortalDirection } from '../../utils/portal-direction';
import { prefersReducedMotion } from '../../utils/reduced-motion';

import { AssistantBar } from './assistant-bar';
import { createLivePreview, type LivePreview } from './live-preview';
import { stepStatusKey } from './step-status';

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
  /** The batch the running call applied, until that call reports done. Calls run one at a time. */
  private applied: ChangedSet | null = null;
  private readonly reveals = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

  public get isOpen(): boolean {
    return this.bar?.isOpen === true;
  }

  /** Whether an event target is inside the prompt bar. */
  public contains(target: EventTarget | null): boolean {
    return target instanceof Node && this.bar?.element.contains(target) === true;
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
    this.listeners.on(window, 'resize', () => {
      if (this.isOpen) {
        this.bar?.place(this.Blok.UI.nodes.wrapper);
      }
      this.preview?.relayout();
    });
    // Capture: a scrolling ancestor's scroll does not bubble to window.
    this.listeners.on(window, 'scroll', () => this.preview?.relayout(), { capture: true, passive: true });
  }

  /**
   * Open the prompt bar. Does nothing without an assistant or in read-only mode.
   */
  public open(): void {
    if (!this.Blok.AgentAPI.hasAssistant || this.Blok.ReadOnly.isEnabled) {
      return;
    }

    const bar = this.ensureBar();

    if (!bar.isOpen) {
      this.context = this.Blok.AgentAPI.describeUserPlace();
      this.returnPoint = this.captureReturnPoint();
    }
    syncPortalDirection(bar.element, { source: this.Blok.UI.nodes.wrapper });
    this.syncThinking();
    bar.open(this.Blok.UI.nodes.wrapper);
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
    this.bar?.close();

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
    const pending = this.run === null
      ? this.startRun(prompt)
      : this.run.followUp(prompt);

    if (pending === null) {
      return;
    }

    const id = ++this.answerId;

    this.listening = true;
    this.bar?.render({ kind: 'working', status: this.activityStatus('thinking') });
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

    const status = this.activityStatus(activity, input);

    if (activity === 'thinking' && this.holdTimer !== null) {
      this.heldStatus = status;

      return;
    }
    this.clearHold();
    this.bar?.render({ kind: 'working', status });
    if (activity === 'blok_execute') {
      this.holdTimer = setTimeout(() => {
        const held = this.heldStatus;

        this.holdTimer = null;
        this.heldStatus = null;
        if (held !== null && this.isWorking()) {
          this.bar?.render({ kind: 'working', status: held });
        }
      }, WRITE_HOLD_MS);
    }
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
    this.listening = false;
    this.streamCalls.clear();
    this.streamed.clear();
    this.applied = null;
    this.preview?.clear();
  }

  private stream(event: AgentModelStreamEvent): void {
    if (!this.listening) {
      return;
    }
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
    }
  }

  private executed(changed: ChangedSet): void {
    if (!this.listening) {
      return;
    }
    this.applied = changed;
    // Block heights changed, so boxes of other calls move.
    this.preview?.relayout();
  }

  private toolDone(id: string, result: AgentToolResult): void {
    if (!this.listening) {
      return;
    }

    const changed = this.applied;
    const streamed = this.streamed.delete(id);

    this.applied = null;
    if (result.isError) {
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

  /** The block the bar opened at, else the current one, else the last. */
  private anchorHolder(): HTMLElement | null {
    const manager = this.Blok.BlockManager;
    const captured = this.context.blockIds[0];
    const block = (captured === undefined ? undefined : manager.getBlockById(captured)) ?? manager.currentBlock ?? manager.lastBlock;

    return block?.holder ?? null;
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
