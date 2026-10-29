import type { ModuleConfig } from '../../../types-internal/module-config';
import { Module } from '../../__module';
import type * as BodyModule from './body';

/**
 * The Ask AI prompt bar. The bar itself lives in ./body, which loads only when
 * `agent.assistant` is configured, so an editor without it never downloads it.
 * `prepare()` waits for the body, so once the editor is ready every member works at once.
 */
export class Assistant extends Module {
  private body: BodyModule.AssistantBody | null = null;

  /** Started at construction so the download overlaps the other modules' prepare(). */
  private readonly loading: Promise<typeof BodyModule> | null;

  constructor(options: ModuleConfig) {
    super(options);
    // Same check as AgentAPI.hasAssistant, which prepare() reads.
    this.loading = typeof options.config.agent?.assistant?.model === 'function' ? import('./body') : null;
    // An editor destroyed before prepare() never awaits the download.
    this.loading?.catch(() => undefined);
  }

  public get isOpen(): boolean {
    return this.body?.isOpen === true;
  }

  /** Whether an event target is inside the prompt bar, or a menu it opened. */
  public contains(target: EventTarget | null): boolean {
    return this.body?.contains(target) === true;
  }

  public async prepare(): Promise<void> {
    if (!this.Blok.AgentAPI.hasAssistant) {
      return;
    }

    const { AssistantBody: Body } = await (this.loading ?? import('./body'));

    if (this.isDestroyed) {
      return;
    }

    const body = new Body({ config: this.config, eventsDispatcher: this.eventsDispatcher });

    body.state = this.Blok;
    body.prepare();
    this.body = body;
  }

  /**
   * Open the prompt bar. Does nothing without an assistant or in read-only mode.
   * @param options.inPlace - cover the caret's block while it stays empty, instead of sitting under it
   * @param options.prompt - send this prompt once the bar is open
   */
  public open(options: { inPlace?: boolean; prompt?: string } = {}): void {
    this.body?.open(options);
  }

  /**
   * Close the bar. An open run keeps its edits.
   * @param options.restoreFocus - put the caret back where the user left it
   */
  public close(options: { restoreFocus?: boolean } = {}): void {
    this.body?.close(options);
  }

  public toggleReadOnly(readOnly: boolean): void {
    this.body?.toggleReadOnly(readOnly);
  }

  public markDestroyed(): void {
    super.markDestroyed();
    this.body?.markDestroyed();
  }

  public destroy(): void {
    // A body still downloading must not start after this.
    this.markDestroyed();
    this.body?.destroy();
    this.body = null;
  }
}
