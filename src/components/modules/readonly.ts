import { Module } from '../__module';
import { CriticalError } from '../errors/critical';

/**
 * @module ReadOnly
 *
 * Has one important method:
 *    - {Function} toggleReadonly - Set read-only mode or toggle current state
 * @version 1.0.0
 * @typedef {ReadOnly} ReadOnly
 * @property {boolean} readOnlyEnabled - read-only state
 */
export class ReadOnly extends Module {
  /**
   * Array of tools name which don't support read-only mode
   */
  private toolsDontSupportReadOnly: string[] = [];

  /**
   * Value to track read-only state
   * @type {boolean}
   */
  private readOnlyEnabled = false;

  /**
   * Returns state of read only mode
   */
  public get isEnabled(): boolean {
    return this.readOnlyEnabled;
  }

  /**
   * Set initial state
   */
  public async prepare(): Promise<void> {
    const { Tools } = this.Blok;
    const { blockTools } = Tools;
    const toolsDontSupportReadOnly: string[] = [];

    Array
      .from(blockTools.entries())
      .forEach(([name, tool]) => {
        if (!tool.isReadOnlySupported) {
          toolsDontSupportReadOnly.push(name);
        }
      });

    this.toolsDontSupportReadOnly = toolsDontSupportReadOnly;

    if (this.config.readOnly === true && toolsDontSupportReadOnly.length > 0) {
      this.throwCriticalError();
    }

    await this.toggle(this.config.readOnly, true);
  }

  /**
   * Set read-only mode or toggle current state
   * Call all Modules `toggleReadOnly` method and re-render Blok
   * @param state - (optional) read-only state or toggle
   * @param isInitial - (optional) true when blok is initializing
   */
  public async toggle(state = !this.readOnlyEnabled, isInitial = false): Promise<boolean> {
    if (state && this.toolsDontSupportReadOnly.length > 0) {
      this.throwCriticalError();
    }

    const oldState = this.readOnlyEnabled;

    this.readOnlyEnabled = state;

    for (const module of Object.values(this.Blok)) {
      /**
       * Verify module has method `toggleReadOnly` method
       */
      if (module === null || module === undefined) {
        continue;
      }

      if (typeof (module as { toggleReadOnly?: unknown }).toggleReadOnly !== 'function') {
        continue;
      }

      /**
       * set or toggle read-only state
       */
      (module as { toggleReadOnly: (state: boolean) => void }).toggleReadOnly(state);
    }

    /**
     * If new state equals old one, do not re-render blocks
     */
    if (oldState === state) {
      return this.readOnlyEnabled;
    }

    /**
     * Do not re-render blocks if it's initial call
     */
    if (isInitial) {
      return this.readOnlyEnabled;
    }

    /**
     * Mutex for modifications observer to prevent onChange call when read-only mode is enabled
     */
    this.Blok.ModificationsObserver.disable();

    /**
     * Save current Blok Blocks and render again
     */
    const savedBlocks = await this.Blok.Saver.save();

    if (savedBlocks === undefined) {
      this.Blok.ModificationsObserver.enable();

      return this.readOnlyEnabled;
    }

    await this.Blok.BlockManager.clear();
    await this.Blok.Renderer.render(savedBlocks.blocks);

    this.Blok.ModificationsObserver.enable();

    return this.readOnlyEnabled;
  }

  /**
   * Set read-only mode to the specified boolean state
   * Unlike toggle(), this method requires a parameter and does not have default toggle behavior
   * Call all Modules `toggleReadOnly` method and re-render Blok
   * @param state - read-only state to set (required)
   * @returns the new read-only state
   */
  public async set(state: boolean): Promise<boolean> {
    return this.toggle(state);
  }

  /**
   * Throws an error about tools which don't support read-only mode
   */
  private throwCriticalError(): never {
    throw new CriticalError(
      `To enable read-only mode all connected tools should support it. Tools ${this.toolsDontSupportReadOnly.join(', ')} don't support read-only mode.`
    );
  }
}
