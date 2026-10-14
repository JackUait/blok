/**
 * The in-editor AI assistant: Mod+J (or "Ask AI") opens a prompt bar, and
 * `editor.agent.ask()` writes the answer into the document live.
 *
 * Present only when `agent.assistant.model` is configured.
 */
import type { AgentRun, AgentRunResult } from '../../../../types/api';
import { Module } from '../../__module';
import { getUserOS } from '../../utils/browser';
import { syncPortalDirection } from '../../utils/portal-direction';

import { AssistantBar } from './assistant-bar';

/** The user's place in the document when the bar opened. */
interface ReturnPoint {
  element: HTMLElement;
  range: Range | null;
}

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
  private context = '';
  private returnPoint: ReturnPoint | null = null;
  /** Bumps on every answer, so a late result of a stopped one is ignored. */
  private answerId = 0;
  private changed = false;

  public get isOpen(): boolean {
    return this.bar?.isOpen === true;
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
    });
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
    bar.open(this.Blok.UI.nodes.wrapper);
  }

  /**
   * Close the bar. An open run keeps its edits.
   * @param options.restoreFocus - put the caret back where the user left it
   */
  public close(options: { restoreFocus?: boolean } = {}): void {
    this.answerId += 1;
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
    this.bar?.element.remove();
    this.bar = null;
    this.listeners.removeAll();
  }

  private ensureBar(): AssistantBar {
    this.bar ??= new AssistantBar((key, vars) => this.Blok.I18n.t(key, vars), {
      onSubmit: (prompt) => this.submit(prompt),
      onStop: () => this.run?.stop(),
      onKeep: () => this.close(),
      onDiscard: () => void this.discard(),
      onEscape: () => this.escape(),
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
    const name = this.config.agent?.assistant?.name?.trim() || 'AI';

    this.bar?.render({ kind: 'working', status: this.Blok.I18n.t('assistant.working', { agent: name }) });
    void pending.then((result) => {
      if (id === this.answerId) {
        this.show(result);
      }
    });
  }

  private startRun(prompt: string): Promise<AgentRunResult> | null {
    try {
      this.run = this.Blok.AgentAPI.startRun(prompt, this.context);

      return this.run.result;
    } catch (thrown) {
      // A host turn is open, so the assistant cannot start one.
      this.bar?.render({ kind: 'error', message: thrown instanceof Error ? thrown.message : String(thrown), changed: false });

      return null;
    }
  }

  private show(result: AgentRunResult): void {
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
      this.run.stop();

      return;
    }
    this.close();
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
