/**
 * Type definitions for @bloklabs/core/tools entry point
 * Re-exports all built-in tools for easy importing
 */

import { BlockToolConstructable } from './tools/block-tool';
import { InlineToolConstructable } from './tools/inline-tool';

// Tool-authoring helpers: bind a tool class to a type-checked settings object.
export { defineTool, ExtractToolConfig } from './tools/define-tool';

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

// ---------------------------------------------------------------------------
// Block type → data registry (#10)
// ---------------------------------------------------------------------------

import { OutputBlockData } from './data-formats/output-data';
import { ParagraphData as _ParagraphData } from './tools/paragraph';
import { HeaderData as _HeaderData } from './tools/header';
import { ListData as _ListData } from './tools/list';
import { TableData as _TableData } from './tools/table';
import { ToggleData as _ToggleData } from './tools/toggle';
import { CalloutData as _CalloutData } from './tools/callout';
import { QuoteData as _QuoteData } from './tools/quote';
import { DividerData as _DividerData } from './tools/divider';
import { SpacerData as _SpacerData } from './tools/spacer';
import { CodeData as _CodeData } from './tools/code';
import { DatabaseData as _DatabaseData, DatabaseRowData as _DatabaseRowData } from './tools/database';
import { ImageData as _ImageData } from './tools/image';
import { FileData as _FileData } from './tools/file';
import { AudioData as _AudioData } from './tools/audio';
import { VideoData as _VideoData } from './tools/video';
import { ColumnListData as _ColumnListData } from './tools/column-list';
import { ColumnData as _ColumnData } from './tools/column';
import { EmbedData as _EmbedData } from './tools/embed';
import { BookmarkData as _BookmarkData } from './tools/bookmark';

/**
 * Registry mapping a block's saved `type` string to the shape of its `data`.
 *
 * This is the type→data link the saved-data surface otherwise lacks: without
 * it, `OutputBlockData['data']` is `Record<string, unknown>` and every read
 * site re-implements a `block.type === 'x'` check plus a `data as XData` cast.
 * {@link isBlockType} narrows off this map so those casts disappear.
 *
 * The interface is **augmentable** — register a custom tool's data shape via
 * declaration merging and {@link isBlockType} will narrow to it:
 *
 * @example
 * declare module '@bloklabs/core/tools' {
 *   interface BlokBlockDataMap {
 *     'my-widget': { widgetId: string };
 *   }
 * }
 */
export interface BlokBlockDataMap {
  paragraph: _ParagraphData;
  header: _HeaderData;
  list: _ListData;
  table: _TableData;
  toggle: _ToggleData;
  callout: _CalloutData;
  quote: _QuoteData;
  divider: _DividerData;
  spacer: _SpacerData;
  code: _CodeData;
  database: _DatabaseData;
  'database-row': _DatabaseRowData;
  image: _ImageData;
  file: _FileData;
  audio: _AudioData;
  video: _VideoData;
  column_list: _ColumnListData;
  column: _ColumnData;
  embed: _EmbedData;
  bookmark: _BookmarkData;
}

/**
 * Type guard narrowing a saved block to a known block type, so its `data` is
 * typed via {@link BlokBlockDataMap} instead of `Record<string, unknown>`.
 *
 * @example
 * for (const block of editor.save().then(d => d.blocks)) {
 *   if (isBlockType(block, 'header')) {
 *     block.data.level; // number — no cast
 *   }
 * }
 *
 * @param block - a saved block (e.g. from `editor.save()`).
 * @param type - a registered block type (a {@link BlokBlockDataMap} key).
 * @returns `true` when `block.type === type`, narrowing `block.data`.
 */
export function isBlockType<K extends keyof BlokBlockDataMap>(
  block: OutputBlockData,
  type: K,
): block is OutputBlockData<K, BlokBlockDataMap[K]>;

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
