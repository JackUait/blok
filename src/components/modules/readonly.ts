import { Module } from '../__module';
import { CriticalError } from '../errors/critical';
import { log } from '../utils';
import { normalizeReadOnlyConfig } from '../utils/readonly-config';

import type { CaretSnapshot } from './yjs/types';

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
   * Array of tools name which don't support in-place read-only toggle via setReadOnly()
   */
  private toolsDontSupportInPlaceToggle: string[] = [];

  /**
   * Value to track read-only state
   * @type {boolean}
   */
  private readOnlyEnabled = false;

  /**
   * The HOST's own wish, remembered separately from the applied state.
   *
   * Collaboration can force read-only on (unsynced, write-denied, terminally
   * disconnected) without erasing what the host asked for — so when its veto
   * lifts, the editor returns to the host's answer rather than to "editable".
   */
  private hostRequestedReadOnly = false;

  /**
   * Where the caret stood when read-only turned on; restored on the way out.
   */
  private caretBeforeReadOnly: CaretSnapshot | null = null;

  /**
   * Collaboration's half of the arbitration: true while editing is impossible
   * whatever the host wants. False (and free) in a single-player editor.
   */
  private get isEditingBlockedByCollaboration(): boolean {
    return this.Blok.Collaboration?.isEditingBlocked ?? false;
  }

  /**
   * Returns state of read only mode
   */
  public get isEnabled(): boolean {
    return this.readOnlyEnabled;
  }

  /**
   * True while read-only is active AND the config requested hiding all
   * editor controls (readOnly: { hideControls: true }). UI modules gate the
   * hover toolbar, block settings popover and inline toolbar on this.
   */
  public get isControlsHidden(): boolean {
    return this.readOnlyEnabled && normalizeReadOnlyConfig(this.config.readOnly).hideControls;
  }

  /**
   * Whether tool support for in-place toggle has been checked during prepare()
   */
  private inPlaceToggleChecked = false;

  /**
   * Whether all registered block tools support in-place read-only toggle.
   * Returns false until prepare() has run the check.
   */
  private get supportsInPlaceToggle(): boolean {
    return this.inPlaceToggleChecked && this.toolsDontSupportInPlaceToggle.length === 0;
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
        if (!tool.supportsInPlaceReadOnly) {
          this.toolsDontSupportInPlaceToggle.push(name);
        }
      });

    this.toolsDontSupportReadOnly = toolsDontSupportReadOnly;
    this.inPlaceToggleChecked = true;

    const { enabled: readOnlyRequested } = normalizeReadOnlyConfig(this.config.readOnly);

    // Against the state that will be APPLIED, not the one that was asked for:
    // a collaboration session boots read-only whatever the host wrote, and a
    // tool that cannot render read-only must still fail the contract loudly.
    if ((readOnlyRequested || this.isEditingBlockedByCollaboration) && toolsDontSupportReadOnly.length > 0) {
      this.throwCriticalError();
    }

    await this.toggle(readOnlyRequested, true);
  }

  /**
   * Set read-only mode or toggle current state
   * Call all Modules `toggleReadOnly` method and re-render Blok
   *
   * Effective read-only is the host's wish OR collaboration's veto. Turning it
   * OFF while collaboration blocks editing is refused outright rather than
   * silently ignored: an editor that reports itself editable while nothing it
   * accepts can be saved is the worse lie.
   * @param state - (optional) read-only state or toggle
   * @param isInitial - (optional) true when blok is initializing
   */
  public async toggle(state = !this.readOnlyEnabled, isInitial = false): Promise<boolean> {
    // `isInitial` is the boot call, which is the module APPLYING the arbitrated
    // state, not a host asking for one — refusing it would leave boot unapplied.
    if (!state && !isInitial && this.isEditingBlockedByCollaboration) {
      log('Read-only cannot be turned off yet: the collaboration session is not synced, or grants no write access.', 'warn');

      return this.readOnlyEnabled;
    }

    this.hostRequestedReadOnly = state;

    return this.applyReadOnly(state || this.isEditingBlockedByCollaboration, isInitial);
  }

  /**
   * Re-derives the effective state after collaboration's veto changed — the
   * first sync landing, or a ticket refresh flipping the write grant. The
   * host's own wish is untouched, so `set(true)` before a sync still wins after
   * it. Called by the Collaboration module; nothing else should.
   */
  public async reapplyCollaborationArbitration(): Promise<boolean> {
    const derived = this.hostRequestedReadOnly || this.isEditingBlockedByCollaboration;

    // A status blip with no state change (an offline flicker while editable)
    // must not run the cascade — BlockSelection would kill a live caret.
    if (derived === this.readOnlyEnabled) {
      return this.readOnlyEnabled;
    }

    return this.applyReadOnly(derived, false);
  }

  /**
   * Applies an already-arbitrated read-only state.
   * @param state - the state to apply
   * @param isInitial - true when blok is initializing
   */
  private async applyReadOnly(state: boolean, isInitial: boolean): Promise<boolean> {
    if (state && this.toolsDontSupportReadOnly.length > 0) {
      this.throwCriticalError();
    }

    const oldState = this.readOnlyEnabled;

    // Before the cascade: BlockSelection.toggleReadOnly removes all ranges,
    // destroying the selection this reads.
    if (state && !oldState) {
      this.captureCaretBeforeReadOnly();
    }

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
     * If all tools support in-place toggle, call setReadOnly on each block
     * instead of the full save/clear/render cycle
     */
    if (this.supportsInPlaceToggle) {
      this.Blok.ModificationsObserver.disable();

      const blocks = (this.Blok.BlockManager as { blocks?: Array<{ setReadOnly: (s: boolean) => void }> }).blocks ?? [];

      for (const block of blocks) {
        block.setReadOnly(state);
      }

      this.Blok.ModificationsObserver.enable();

      if (!state) {
        this.restoreCaretAfterReadOnly();
      }

      return this.readOnlyEnabled;
    }

    /**
     * Mutex for modifications observer to prevent onChange call when read-only mode is enabled
     */
    this.Blok.ModificationsObserver.disable();

    /**
     * Save current Blok Blocks and render again.
     *
     * In the editor's own dialect: the reload is a round-trip on itself, and
     * the host-facing legacy collapse can only express nesting as nested
     * `items[]`, so it would drop every list item nested by the flat
     * `data.depth` carrier — a read-only toggle would flatten the document.
     */
    const savedBlocks = await this.Blok.Saver.save({ dialect: 'internal' });

    if (savedBlocks === undefined) {
      this.Blok.ModificationsObserver.enable();

      return this.readOnlyEnabled;
    }

    const savedScrollY = window.scrollY;

    this.Blok.Renderer.markRenderStart();

    try {
      /*
       * View-only: the blocks keep their ids and their data is unchanged, so
       * the Yjs document already describes exactly what is being rendered.
       * Writing to it would clear the undo history — looking at a document in
       * read-only mode must not cost the user their undo steps.
       */
      await this.Blok.BlockManager.withViewRebuild(async () => {
        await this.Blok.BlockManager.clear(false, { skipYjsSync: true });
        await this.Blok.Renderer.render(savedBlocks.blocks, { skipYjsSync: true });
      });
    } finally {
      this.Blok.Renderer.markRenderEnd();
    }

    /*
     * After the render, which can move the viewport on its own: a browser
     * follows focus as the old DOM goes away. Nothing here restores a caret,
     * so this is the last thing that can move the reader.
     */
    if (window.scrollY !== savedScrollY) {
      window.scrollTo(0, savedScrollY);
    }

    if (!state) {
      this.restoreCaretAfterReadOnly();
    }

    this.Blok.ModificationsObserver.enable();

    return this.readOnlyEnabled;
  }

  /**
   * Remembers the caret so leaving read-only can put it back. Only a caret
   * that lives inside this editor's wrapper is worth keeping — a selection
   * elsewhere on the page is not ours to restore.
   */
  private captureCaretBeforeReadOnly(): void {
    this.caretBeforeReadOnly = null;

    // Optional chains: boot applies read-only before UI builds its nodes.
    const wrapper = this.Blok.UI?.nodes.wrapper;
    const anchorNode = window.getSelection()?.anchorNode ?? null;

    if (wrapper === undefined || anchorNode === null || !wrapper.contains(anchorNode)) {
      return;
    }

    this.caretBeforeReadOnly = this.Blok.YjsManager?.captureCaretSnapshot() ?? null;
  }

  /**
   * Puts the caret back where capture left it. Block ids survive both toggle
   * paths (the renderer reuses incoming ids), so the snapshot resolves even
   * after the save/clear/render cycle.
   */
  private restoreCaretAfterReadOnly(): void {
    const snapshot = this.caretBeforeReadOnly;

    this.caretBeforeReadOnly = null;

    if (snapshot === null) {
      return;
    }

    // The user focused something else while read-only — don't steal it back.
    const wrapper = this.Blok.UI?.nodes.wrapper;
    const activeElement = document.activeElement;
    const focusMovedOutside = activeElement !== null
      && activeElement !== document.body
      && wrapper !== undefined
      && !wrapper.contains(activeElement);

    if (focusMovedOutside) {
      return;
    }

    const input: HTMLElement | undefined =
      this.Blok.BlockManager.getBlockById(snapshot.blockId)?.inputs[snapshot.inputIndex];

    if (input === undefined || !input.isConnected) {
      return;
    }

    // DEFAULT + offset clamps an overlong offset instead of throwing.
    this.Blok.Caret.setToInput(input, this.Blok.Caret.positions.DEFAULT, snapshot.offset);
  }

  /**
   * Set read-only mode to the specified boolean state
   * Unlike toggle(), this method requires a parameter and does not have default toggle behavior
   * Call all Modules `toggleReadOnly` method and re-render Blok
   *
   * When `options.hideControls` is provided, the normalized object form is
   * written into `config.readOnly` so the live `isControlsHidden` getter
   * (recomputed from config on every access) picks it up at runtime.
   * @param state - read-only state to set (required)
   * @param options - optional read-only mode options
   * @param options.hideControls - hide all editor controls while read-only is active
   * @returns the new read-only state
   */
  public async set(state: boolean, options?: { hideControls?: boolean }): Promise<boolean> {
    if (options !== undefined && typeof options.hideControls === 'boolean') {
      this.config.readOnly = { hideControls: options.hideControls };
    }

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
