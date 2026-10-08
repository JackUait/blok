import {
  Audio, Bold, Bookmark, Callout, ClearFormat, Code, Column, ColumnList, Database, DatabaseRow, Divider, Embed, Equation,
  File as FileTool, Header, Image as ImageTool, InlineCode, Italic, Link, List, Marker, Page, PageLink, Paragraph, Quote,
  Spacer, Strikethrough, SupSub, Table, TableOfContents, TabTool, TabsTool, Toggle, Underline, Video, defaultBlockTools,
} from '../../../../src/tools';

import type { BlokConfig } from '../../../../types';

export const BLOCK_CLASSES = {
  paragraph: Paragraph,
  header: Header,
  list: List,
  table: Table,
  toggle: Toggle,
  callout: Callout,
  database: Database,
  'database-row': DatabaseRow,
  divider: Divider,
  spacer: Spacer,
  table_of_contents: TableOfContents,
  quote: Quote,
  code: Code,
  image: ImageTool,
  file: FileTool,
  audio: Audio,
  video: Video,
  column_list: ColumnList,
  column: Column,
  tabs: TabsTool,
  tab: TabTool,
  embed: Embed,
  bookmark: Bookmark,
  page: Page,
  'page-link': PageLink,
};

export const INLINE_CLASSES = {
  marker: Marker,
  bold: Bold,
  italic: Italic,
  underline: Underline,
  clearFormat: ClearFormat,
  link: Link,
  strikethrough: Strikethrough,
  inlineCode: InlineCode,
  equation: Equation,
  supSub: SupSub,
};

const defaultSettings: Readonly<Record<string, (typeof defaultBlockTools)[keyof typeof defaultBlockTools]>> = defaultBlockTools;

export const builtInEditorTools = (): NonNullable<BlokConfig['tools']> => ({
  ...Object.fromEntries(Object.entries(BLOCK_CLASSES).map(([name, toolClass]) => [
    name,
    { class: toolClass, ...defaultSettings[name] },
  ])),
  ...Object.fromEntries(Object.entries(INLINE_CLASSES).map(([name, toolClass]) => [
    name,
    { class: toolClass },
  ])),
});
