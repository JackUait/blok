/**
 * Type definitions for @jackuait/blok/tools entry point
 * Re-exports all built-in tools for easy importing
 */

import { HeaderConstructable, HeaderData, HeaderConfig } from './tools/header';
import { ParagraphConstructable, ParagraphData, ParagraphConfig } from './tools/paragraph';
import { ListConstructable, ListData, ListConfig, ListStyle } from './tools/list';
import { TableConstructable, TableData, TableConfig, CellContent } from './tools/table';
import { ToggleConstructable, ToggleData, ToggleConfig } from './tools/toggle';
import { InlineToolConstructable } from './tools/inline-tool';
import { BlockTuneConstructable } from './block-tunes';
import { ToolSettings } from './tools';

// Block tools
export const Paragraph: ParagraphConstructable;
export const Header: HeaderConstructable;
export const List: ListConstructable;
export const Table: TableConstructable;
export const Toggle: ToggleConstructable;

// Re-export data and config types for convenience
export { HeaderData, HeaderConfig } from './tools/header';
export { ParagraphData, ParagraphConfig } from './tools/paragraph';
export { ListData, ListConfig, ListStyle } from './tools/list';
export { TableData, TableConfig, CellContent } from './tools/table';
export { ToggleData, ToggleConfig } from './tools/toggle';

// Inline tools
export const Bold: InlineToolConstructable;
export const Italic: InlineToolConstructable;
export const Link: InlineToolConstructable;
export const Convert: InlineToolConstructable;
export const Marker: InlineToolConstructable;
export const Strikethrough: InlineToolConstructable;
export const Underline: InlineToolConstructable;

// Block tunes
export const Delete: BlockTuneConstructable;

/**
 * Default block tools configuration
 */
export const defaultBlockTools: {
  readonly paragraph: { readonly inlineToolbar: true; readonly config: { readonly preserveBlank: true } };
  readonly header: { readonly inlineToolbar: true };
  readonly list: { readonly inlineToolbar: true };
  readonly table: {};
};

/**
 * Default inline tools configuration
 */
export const defaultInlineTools: {
  readonly bold: {};
  readonly italic: {};
  readonly link: {};
  readonly marker: {};
  readonly strikethrough: {};
  readonly underline: {};
};
