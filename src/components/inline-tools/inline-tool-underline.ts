import { IconUnderline } from '../icons';

import { createSimpleMarkTool } from './simple-mark-tool';

/**
 * Underline Tool
 *
 * Inline Toolbar Tool
 *
 * Style selected text with underline. All range/wrap/unwrap mechanics live in
 * the shared mark engine; this file only declares the mark.
 */
export class UnderlineInlineTool extends createSimpleMarkTool({
  name: 'underline',
  icon: IconUnderline,
  title: 'Underline',
  titleKey: 'underline',
  shortcut: 'CMD+U',
  spec: {
    tag: 'u',
  },
}) {}
