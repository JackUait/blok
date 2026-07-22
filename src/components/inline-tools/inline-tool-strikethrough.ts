import { IconStrikethrough } from '../icons';

import { createSimpleMarkTool } from './simple-mark-tool';

/**
 * Strikethrough Tool
 *
 * Inline Toolbar Tool
 *
 * Style selected text with strikethrough. All range/wrap/unwrap mechanics
 * live in the shared mark engine; this file only declares the mark.
 */
export class StrikethroughInlineTool extends createSimpleMarkTool({
  name: 'strikethrough',
  icon: IconStrikethrough,
  title: 'Strikethrough',
  titleKey: 'strikethrough',
  shortcut: 'CMD+SHIFT+S',
  spec: {
    tag: 's',
  },
}) {}
