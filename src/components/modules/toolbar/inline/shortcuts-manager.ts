import type { BlokModules } from '../../../../types-internal/blok-modules';
import type { InlineTool as IInlineTool } from '../../../../../types';
import { Shortcuts } from '../../../utils/shortcuts';
import { CommonInternalSettings } from '../../../tools/base';

/**
 * InlineShortcutManager manages keyboard shortcuts for inline tools.
 *
 * Responsibilities:
 * - Register shortcuts for inline tools
 * - Track registered shortcuts to prevent conflicts
 * - Retry registration when tools are not yet loaded
 * - Clean up shortcuts on destroy
 */
export class InlineShortcutManager {
  /**
   * Getter function to access Blok modules dynamically
   */
  private getBlok: () => BlokModules;

  /**
   * Callback invoked when a shortcut is pressed
   */
  private onShortcutPressed: (toolName: string) => Promise<void>;

  /**
   * Map of tool name to shortcut string for registered shortcuts
   */
  private registeredShortcuts: Map<string, string> = new Map();

  /**
   * Tracks whether shortcuts have been successfully registered
   */
  private shortcutsRegistered = false;

  /**
   * Prevents duplicate shortcut registration retries
   */
  private shortcutRegistrationScheduled = false;

  constructor(
    getBlok: () => BlokModules,
    onShortcutPressed: (toolName: string) => Promise<void>
  ) {
    this.getBlok = getBlok;
    this.onShortcutPressed = onShortcutPressed;
  }

  /**
   * Try to register shortcuts (with retry scheduling)
   */
  public tryRegisterShortcuts(): void {
    if (this.shortcutsRegistered) {
      return;
    }

    const { Tools } = this.getBlok();

    if (Tools === undefined) {
      this.scheduleShortcutRegistration();

      return;
    }

    const shortcutsWereRegistered = this.registerInitialShortcuts();

    if (shortcutsWereRegistered) {
      this.shortcutsRegistered = true;
    }
  }

  /**
   * Get shortcut for a specific tool
   */
  public getShortcut(toolName: string): string | undefined {
    const { Tools } = this.getBlok();

    const tool = Tools.inlineTools.get(toolName);
    const internalTools = Tools.internal.inlineTools;

    if (Array.from(internalTools.keys()).includes(toolName)) {
      return this.inlineTools[toolName]?.[CommonInternalSettings.Shortcut];
    }

    return tool?.shortcut;
  }

  /**
   * Check if a specific shortcut is registered for a tool
   */
  public hasShortcut(toolName: string): boolean {
    return this.registeredShortcuts.has(toolName);
  }

  /**
   * Clean up shortcuts
   */
  public destroy(): void {
    for (const [, shortcut] of this.registeredShortcuts.entries()) {
      Shortcuts.remove(document, shortcut);
    }

    this.registeredShortcuts.clear();
    this.shortcutsRegistered = false;
  }

  /**
   * Register shortcuts for inline tools ahead of time
   */
  private registerInitialShortcuts(): boolean {
    const { Tools } = this.getBlok();
    const inlineTools = Tools?.inlineTools;

    if (!inlineTools) {
      this.scheduleShortcutRegistration();

      return false;
    }

    const toolNames = Array.from(inlineTools.keys());

    if (toolNames.length === 0) {
      this.scheduleShortcutRegistration();

      return false;
    }

    toolNames.forEach((toolName) => {
      const shortcut = this.getShortcut(toolName);

      this.tryEnableShortcut(toolName, shortcut);
    });

    return true;
  }

  /**
   * Try to enable shortcut for a tool, catching any errors silently
   */
  private tryEnableShortcut(toolName: string, shortcut: string | undefined): void {
    if (shortcut === undefined) {
      return;
    }

    try {
      this.enableShortcuts(toolName, shortcut);
    } catch (_e) {
      // Ignore errors when enabling shortcuts
    }
  }

  /**
   * Enable Tool shortcut with Blok Shortcuts Module
   */
  private enableShortcuts(toolName: string, shortcut: string): void {
    const registeredShortcut = this.registeredShortcuts.get(toolName);

    if (registeredShortcut === shortcut) {
      return;
    }

    if (this.isShortcutTakenByAnotherTool(toolName, shortcut)) {
      return;
    }

    if (registeredShortcut !== undefined) {
      Shortcuts.remove(document, registeredShortcut);
      this.registeredShortcuts.delete(toolName);
    }

    Shortcuts.add({
      name: shortcut,
      handler: (event) => {
        const { BlockManager } = this.getBlok();
        const { currentBlock } = BlockManager;

        if (!currentBlock) {
          return;
        }

        if (currentBlock.tool.enabledInlineTools === false) {
          return;
        }

        event.preventDefault();

        void this.onShortcutPressed(toolName);
      },
      on: document,
    });

    this.registeredShortcuts.set(toolName, shortcut);
  }

  /**
   * Check if shortcut is already registered by another inline tool
   */
  private isShortcutTakenByAnotherTool(toolName: string, shortcut: string): boolean {
    return Array.from(this.registeredShortcuts.entries()).some(([name, registeredShortcut]) => {
      return name !== toolName && registeredShortcut === shortcut;
    });
  }

  /**
   * Schedules a retry for shortcut registration
   */
  private scheduleShortcutRegistration(): void {
    if (this.shortcutsRegistered || this.shortcutRegistrationScheduled) {
      return;
    }

    this.shortcutRegistrationScheduled = true;

    const callback = (): void => {
      this.shortcutRegistrationScheduled = false;
      this.tryRegisterShortcuts();
    };

    if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
      window.setTimeout(callback, 0);
    } else {
      callback();
    }
  }

  /**
   * Get inline tools
   */
  private get inlineTools(): Record<string, IInlineTool> {
    const { Tools } = this.getBlok();
    const result = {} as Record<string, IInlineTool>;

    Array.from(Tools.inlineTools.entries())
      .forEach(([name, tool]) => {
        result[name] = tool.create();
      });

    return result;
  }
}
