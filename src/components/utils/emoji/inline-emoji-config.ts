/**
 * Whether the inline ":" emoji menu is active for this editor.
 * Absent means on; only an explicit false turns it off.
 * @param config - the editor configuration
 */
export function isInlineEmojiEnabled(config: { inlineEmoji?: boolean }): boolean {
  return config.inlineEmoji !== false;
}
