/**
 * Type-level tests for tools-entry.d.ts declarations.
 * Run with: tsc --noEmit --strict test/unit/tools/tools-entry-typecheck.ts
 *
 * This file is NOT executed — it only needs to compile.
 * Each assertion is a type that would cause a compile error if the
 * declaration is wrong.
 */

import type { defaultBlockTools, Columns, Tabs, TabsTool, TabTool, Embed, Bookmark, Page, Image, File, Audio, Video, ClearFormat, mountChildBlocks, TableOfContents, BlokBlockDataMap } from '../../../types/tools-entry';
import type {
  ImageData, ImageConfig, ImageUploader,
  FileData, FileConfig, FileUploader,
  AudioData, AudioConfig, AudioUploader,
  VideoData, VideoConfig, VideoUploader,
  PageData, PageConfig, PageInfo, PageIcon, PageSearchResult,
  TableOfContentsData,
  TabsData, TabData,
} from '../../../types/tools-entry';

// defaultBlockTools must include 'database' and 'database-row' entries
const _db: typeof defaultBlockTools.database = {} as const;
const _dbRow: typeof defaultBlockTools['database-row'] = {} as const;

// Columns must be exported from the public tools entry and usable as a tool value
const _columns: typeof Columns = {} as typeof Columns;

// Tabs, TabsTool and TabTool are exported from the runtime tools entry.
const _tabs: typeof Tabs = {} as typeof Tabs;
const _tabsTool: typeof TabsTool = {} as typeof TabsTool;
const _tabTool: typeof TabTool = {} as typeof TabTool;
const _tabData: TabData = { title: 'Tab 1', icon: '🚀' };
const _tabsData: TabsData = {};
const _tabsDefault: typeof defaultBlockTools.tabs = {} as const;
const _tabDefault: typeof defaultBlockTools.tab = {} as const;

// Embed and Bookmark are exported from the runtime tools entry, so their
// declarations must exist in the published types or `import { Embed, Bookmark }`
// won't typecheck for consumers.
const _embed: typeof Embed = {} as typeof Embed;
const _bookmark: typeof Bookmark = {} as typeof Bookmark;

// Page is exported from the runtime tools entry.
const _page: typeof Page = {} as typeof Page;
const _pageTypes: [PageData, PageConfig, PageInfo, PageIcon, PageSearchResult] = [] as never;

// defaultBlockTools must include the 'embed' and 'bookmark' entries the runtime emits
const _embedDefault: typeof defaultBlockTools.embed = {} as const;
const _bookmarkDefault: typeof defaultBlockTools.bookmark = {} as const;

// Image, File, Audio, and Video are exported from the runtime tools entry, so
// their declarations (const + data/config/uploader types) must exist in the
// published types or `import { Image, File, Audio, Video }` and their type
// imports won't typecheck for consumers.
const _image: typeof Image = {} as typeof Image;
const _file: typeof File = {} as typeof File;
const _audio: typeof Audio = {} as typeof Audio;
const _video: typeof Video = {} as typeof Video;
const _imageTypes: [ImageData, ImageConfig, ImageUploader] = [] as never;
const _fileTypes: [FileData, FileConfig, FileUploader] = [] as never;
const _audioTypes: [AudioData, AudioConfig, AudioUploader] = [] as never;
const _videoTypes: [VideoData, VideoConfig, VideoUploader] = [] as never;

// ClearFormat is exported from the runtime tools entry, so its declaration must
// exist in the published types or `import { ClearFormat }` won't typecheck.
const _clearFormat: typeof ClearFormat = {} as typeof ClearFormat;

// mountChildBlocks is exported from the runtime tools entry so third-party
// container tools can reconcile their children the way the built-in ones do —
// its declaration must exist in the published types or `import
// { mountChildBlocks }` won't typecheck for consumers.
const _mountChildBlocks: typeof mountChildBlocks = () => undefined;

// defaultBlockTools must include the 'file', 'audio', and 'video' entries the runtime emits
const _fileDefault: typeof defaultBlockTools.file = {} as const;
const _audioDefault: typeof defaultBlockTools.audio = {} as const;
const _videoDefault: typeof defaultBlockTools.video = {} as const;

// TableOfContents is exported from the runtime tools entry and is a default block tool.
const _toc: typeof TableOfContents = {} as typeof TableOfContents;
const _tocDefault: typeof defaultBlockTools.table_of_contents = {} as const;
const _tocData: BlokBlockDataMap['table_of_contents'] = { textColor: 'red' } satisfies TableOfContentsData;
