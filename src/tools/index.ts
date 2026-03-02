/**
 * @module Tools
 * Re-exports all built-in tools for easy importing.
 *
 * @example
 * // Import specific tools
 * import { Paragraph, Header, List, Toggle, Bold, Italic, Link, Marker } from '@jackuait/blok/tools';
 *
 * // Use in Blok configuration (flat config style)
 * new Blok({
 *   tools: {
 *     paragraph: Paragraph,
 *     header: { class: Header, levels: [1, 2, 3] },
 *     list: List,
 *     bold: Bold,
 *     italic: Italic,
 *     link: Link,
 *   }
 * });
 */

// Block tools
export { Paragraph } from './paragraph';
export { Header } from './header';
export { ListItem as List } from './list';
export { Table } from './table';
export { ToggleItem as Toggle } from './toggle';

// Inline tools
export { BoldInlineTool as Bold } from '../components/inline-tools/inline-tool-bold';
export { ItalicInlineTool as Italic } from '../components/inline-tools/inline-tool-italic';
export { LinkInlineTool as Link } from '../components/inline-tools/inline-tool-link';
export { ConvertInlineTool as Convert } from '../components/inline-tools/inline-tool-convert';
export { MarkerInlineTool as Marker } from '../components/inline-tools/inline-tool-marker';

// Default tools configuration for convenience
// Note: inlineToolbar defaults to true, so it doesn't need to be specified
export const defaultBlockTools = {
  paragraph: { preserveBlank: true },
  header: {},
  list: {},
  table: {},
  toggle: {},
} as const;

export const defaultInlineTools = {
  bold: {},
  italic: {},
  link: {},
  marker: {},
} as const;
