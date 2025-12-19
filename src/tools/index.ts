/**
 * @module Tools
 * Re-exports all built-in tools for easy importing.
 *
 * @example
 * // Import specific tools
 * import { Paragraph, Header, List, Bold, Italic, Link } from '@jackuait/blok/tools';
 *
 * // Use in Blok configuration
 * new Blok({
 *   tools: { paragraph: Paragraph, header: Header, list: List },
 *   inlineTools: { bold: Bold, italic: Italic, link: Link }
 * });
 */

// Block tools
export { Paragraph } from './paragraph';
export { Header } from './header';
export { ListItem as List } from './list';

// Inline tools
export { BoldInlineTool as Bold } from '../components/inline-tools/inline-tool-bold';
export { ItalicInlineTool as Italic } from '../components/inline-tools/inline-tool-italic';
export { LinkInlineTool as Link } from '../components/inline-tools/inline-tool-link';

// Default tools configuration for convenience
export const defaultBlockTools = {
  paragraph: { inlineToolbar: true, config: { preserveBlank: true } },
  header: { inlineToolbar: true },
  list: { inlineToolbar: true },
} as const;

export const defaultInlineTools = {
  bold: {},
  italic: {},
  link: {},
} as const;
