/**
 * @module Tools
 * Re-exports all built-in tools for easy importing.
 *
 * @example
 * // Import specific tools
 * import { Paragraph, Header, List, Toggle, Bold, Italic, Link, Marker } from '@bloklabs/core/tools';
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
export { CalloutTool as Callout } from './callout';
export { DatabaseTool as Database } from './database';
export { DatabaseRowTool as DatabaseRow } from './database-row';
export { DividerTool as Divider } from './divider';
export { SpacerTool as Spacer } from './spacer';
export { Quote } from './quote';
export { CodeTool as Code } from './code';
export { ImageTool as Image } from './image';
export { FileTool as File } from './file';
export { AudioTool as Audio } from './audio';
export { VideoTool as Video } from './video';
export { ColumnList } from './column-list';
export { Column } from './column';
export { Columns } from './columns';
export { Embed } from './link/embed';
export { Bookmark } from './link/bookmark';

// Inline tools
export { BoldInlineTool as Bold } from '../components/inline-tools/inline-tool-bold';
export { ItalicInlineTool as Italic } from '../components/inline-tools/inline-tool-italic';
export { LinkInlineTool as Link } from '../components/inline-tools/inline-tool-link';
export { ConvertInlineTool as Convert } from '../components/inline-tools/inline-tool-convert';
export { MarkerInlineTool as Marker } from '../components/inline-tools/inline-tool-marker';
export { UnderlineInlineTool as Underline } from '../components/inline-tools/inline-tool-underline';
export { StrikethroughInlineTool as Strikethrough } from '../components/inline-tools/inline-tool-strikethrough';
export { CodeInlineTool as InlineCode } from '../components/inline-tools/inline-tool-code';
export { EquationInlineTool as Equation } from '../components/inline-tools/inline-tool-equation';

// Default tools configuration for convenience
// Note: inlineToolbar defaults to true, so it doesn't need to be specified
export const defaultBlockTools = {
  paragraph: { preserveBlank: true },
  header: {},
  list: {},
  table: {},
  toggle: {},
  callout: {},
  database: {},
  'database-row': {},
  divider: {},
  spacer: {},
  quote: {},
  code: { inlineToolbar: false },
  image: {},
  file: {},
  audio: {},
  video: {},
  column_list: {},
  column: {},
  embed: {},
  bookmark: {},
} as const;

export const defaultInlineTools = {
  // Contiguous toggle group (Notion parity), then Link, then Color (marker) last.
  bold: {},
  italic: {},
  underline: {},
  strikethrough: {},
  inlineCode: {},
  equation: {},
  link: {},
  marker: {},
} as const;
