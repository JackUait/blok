/**
 * Type definitions for @bloklabs/core/tools entry point
 * Re-exports all built-in tools for easy importing
 */

import { BlockToolConstructable } from './tools/block-tool';
import { InlineToolConstructable } from './tools/inline-tool';

// Block tools published as declare-classes: each name is both the runtime
// value and the instance type, with a single construct signature so
// `class Custom extends Tool {}` compiles (no TS2510).
export { Paragraph, ParagraphConstructorOptions, ParagraphConstructable } from './tools/paragraph';
export { Header, HeaderConstructorOptions, HeaderConstructable } from './tools/header';
export { List, ListConstructorOptions, ListConstructable } from './tools/list';
export { Table, TableConstructorOptions, TableConstructable } from './tools/table';
export { Toggle, ToggleConstructorOptions, ToggleConstructable } from './tools/toggle';
export { Divider, DividerConstructorOptions, DividerConstructable } from './tools/divider';
export { Spacer, SpacerConstructorOptions, SpacerConstructable } from './tools/spacer';
export { Callout, CalloutConstructorOptions, CalloutConstructable } from './tools/callout';
export { Quote, QuoteConstructorOptions, QuoteConstructable } from './tools/quote';
export { ColumnList, ColumnListConstructorOptions, ColumnListConstructable } from './tools/column-list';
export { Column, ColumnConstructorOptions, ColumnConstructable } from './tools/column';
export { Database, DatabaseConstructorOptions } from './tools/database';
// DatabaseRow is the block tool class, distinct from the DatabaseRow row-shape interface in types/tools/database.d.ts
export { DatabaseRow, DatabaseRowConstructorOptions } from './tools/database-row';
export { Image, ImageConstructorOptions } from './tools/image';
export { File, FileConstructorOptions } from './tools/file';
export { Audio, AudioConstructorOptions } from './tools/audio';
export { Video, VideoConstructorOptions } from './tools/video';
export { Code, CodeConstructorOptions } from './tools/code';
export { Embed, EmbedConstructorOptions } from './tools/embed';
export { Bookmark, BookmarkConstructorOptions } from './tools/bookmark';
/**
 * Columns group manifest: a single registration handle that expands to the
 * `column_list` and `column` block tools. Register as `tools: { columns: Columns }`.
 */
export const Columns: BlockToolConstructable & {
  readonly provides: { readonly [blockType: string]: BlockToolConstructable };
};

// Re-export data and config types for convenience
export { HeaderData, HeaderConfig } from './tools/header';
export { ParagraphData, ParagraphConfig } from './tools/paragraph';
export { ListData, ListConfig, ListStyle } from './tools/list';
export { TableData, TableConfig, CellContent } from './tools/table';
export { ToggleData, ToggleConfig } from './tools/toggle';
export { DividerData } from './tools/divider';
export { SpacerData } from './tools/spacer';
export { CalloutData, CalloutConfig } from './tools/callout';
export { QuoteData } from './tools/quote';
export { DatabaseData, DatabaseConfig, DatabaseAdapter, DatabaseViewConfig, DatabaseRowData } from './tools/database';
export { ImageData, ImageConfig, ImageUploader, ImageAlignment, ImageSize, ImageFrame, ImageCrop, ImageCropShape } from './tools/image';
export { FileData, FileConfig, FileUploader, FileUploadContext, FileUploadResult } from './tools/file';
export { AudioData, AudioConfig, AudioUploader, AudioUploadContext, AudioAlignment } from './tools/audio';
export { VideoData, VideoConfig, VideoUploader, VideoUploadContext, VideoAlignment, VideoGlow } from './tools/video';
export { CodeData } from './tools/code';
export { EmbedData, EmbedKind, EmbedAlignment } from './tools/embed';
export { BookmarkData, BookmarkConfig, BookmarkMeta } from './tools/bookmark';
export { MediaSource } from './tools/media-source';
export { ColumnListData } from './tools/column-list';
export { ColumnData } from './tools/column';

// Inline tools
export const Bold: InlineToolConstructable;
export const Italic: InlineToolConstructable;
export const Link: InlineToolConstructable;
export const Convert: InlineToolConstructable;
export const Marker: InlineToolConstructable;
export const Strikethrough: InlineToolConstructable;
export const Underline: InlineToolConstructable;
export const InlineCode: InlineToolConstructable;
export const Equation: InlineToolConstructable;

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
  readonly spacer: {};
  readonly quote: {};
  readonly code: { readonly inlineToolbar: false };
  readonly image: {};
  readonly file: {};
  readonly audio: {};
  readonly video: {};
  readonly column_list: {};
  readonly column: {};
  readonly embed: {};
  readonly bookmark: {};
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
  readonly inlineCode: {};
  readonly equation: {};
};
