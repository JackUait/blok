/**
 * Type definitions for @jackuait/blok/tools entry point
 * Re-exports all built-in tools for easy importing
 */

import { HeaderConstructable, HeaderData, HeaderConfig } from './tools/header';
import { ParagraphConstructable, ParagraphData, ParagraphConfig } from './tools/paragraph';
import { ListConstructable, ListData, ListConfig, ListStyle } from './tools/list';
import { TableConstructable, TableData, TableConfig, CellContent } from './tools/table';
import { ToggleConstructable, ToggleData, ToggleConfig } from './tools/toggle';
import { DividerConstructable, DividerData } from './tools/divider';
import { CalloutConstructable, CalloutData, CalloutConfig } from './tools/callout';
import { QuoteConstructable, QuoteData } from './tools/quote';
import { BlockToolConstructable } from './tools/block-tool';
import { DatabaseData, DatabaseConfig, DatabaseAdapter, DatabaseViewConfig, DatabaseRowData } from './tools/database';
import { InlineToolConstructable } from './tools/inline-tool';
import { ToolSettings } from './tools';

// Block tools
export const Paragraph: ParagraphConstructable;
export const Header: HeaderConstructable;
export const List: ListConstructable;
export const Table: TableConstructable;
export const Toggle: ToggleConstructable;
export const Divider: DividerConstructable;
export const Callout: CalloutConstructable;
export const Quote: QuoteConstructable;
export const Database: BlockToolConstructable;
export const DatabaseRow: BlockToolConstructable;  // DatabaseRowTool (block tool), distinct from DatabaseRow interface in types/tools/database.d.ts

// Re-export data and config types for convenience
export { HeaderData, HeaderConfig } from './tools/header';
export { ParagraphData, ParagraphConfig } from './tools/paragraph';
export { ListData, ListConfig, ListStyle } from './tools/list';
export { TableData, TableConfig, CellContent } from './tools/table';
export { ToggleData, ToggleConfig } from './tools/toggle';
export { DividerData } from './tools/divider';
export { CalloutData, CalloutConfig } from './tools/callout';
export { QuoteData } from './tools/quote';
export { DatabaseData, DatabaseConfig, DatabaseAdapter, DatabaseViewConfig, DatabaseRowData } from './tools/database';

// Inline tools
export const Bold: InlineToolConstructable;
export const Italic: InlineToolConstructable;
export const Link: InlineToolConstructable;
export const Convert: InlineToolConstructable;
export const Marker: InlineToolConstructable;
export const Strikethrough: InlineToolConstructable;
export const Underline: InlineToolConstructable;

/**
 * Default block tools configuration
 */
export const defaultBlockTools: {
  readonly paragraph: { readonly preserveBlank: true };
  readonly header: {};
  readonly list: {};
  readonly table: {};
  readonly toggle: {};
  readonly callout: {};
  readonly database: {};
  readonly 'database-row': {};
  readonly divider: {};
  readonly quote: {};
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
