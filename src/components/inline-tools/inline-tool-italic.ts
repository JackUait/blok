import { BUILT_IN_INLINE_DESCRIPTIONS } from '../../shared/tool-descriptions/inline';
import { IconItalic } from '../icons';

import { createSimpleMarkTool } from './simple-mark-tool';

/**
 * Italic Tool
 *
 * Inline Toolbar Tool
 *
 * Style selected text with italic. All range/wrap/unwrap mechanics live in
 * the shared mark engine; this file only declares the mark.
 */
export class ItalicInlineTool extends createSimpleMarkTool({
  name: 'italic',
  icon: IconItalic,
  title: 'Italic',
  titleKey: 'italic',
  shortcut: 'CMD+I',
  spec: {
    tag: 'i',
    aliasTags: ['em'],
  },
}) {
  public static describe = BUILT_IN_INLINE_DESCRIPTIONS.italic;

  /**
   * At a collapsed caret, defer Cmd/Ctrl+I to the browser's native
   * pending-italic handler instead of intercepting it (see
   * InlineShortcutManager). This is the only race-free, cross-engine way to
   * get "toggle italic then type".
   */
  public static nativeCaretShortcut = true;
}
