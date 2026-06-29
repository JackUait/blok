/**
 * Type-level tests for tools-entry.d.ts declarations.
 * Run with: tsc --noEmit --strict test/unit/tools/tools-entry-typecheck.ts
 *
 * This file is NOT executed — it only needs to compile.
 * Each assertion is a type that would cause a compile error if the
 * declaration is wrong.
 */

import type { defaultBlockTools, Columns, Embed, Bookmark, Image, File, Audio, Video } from '../../../types/tools-entry';
import type {
  ImageData, ImageConfig, ImageUploader,
  FileData, FileConfig, FileUploader,
  AudioData, AudioConfig, AudioUploader,
  VideoData, VideoConfig, VideoUploader,
} from '../../../types/tools-entry';

// defaultBlockTools must include 'database' and 'database-row' entries
const _db: typeof defaultBlockTools.database = {} as const;
const _dbRow: typeof defaultBlockTools['database-row'] = {} as const;

// Columns must be exported from the public tools entry and usable as a tool value
const _columns: typeof Columns = {} as typeof Columns;

// Embed and Bookmark are exported from the runtime tools entry, so their
// declarations must exist in the published types or `import { Embed, Bookmark }`
// won't typecheck for consumers.
const _embed: typeof Embed = {} as typeof Embed;
const _bookmark: typeof Bookmark = {} as typeof Bookmark;

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

// defaultBlockTools must include the 'file', 'audio', and 'video' entries the runtime emits
const _fileDefault: typeof defaultBlockTools.file = {} as const;
const _audioDefault: typeof defaultBlockTools.audio = {} as const;
const _videoDefault: typeof defaultBlockTools.video = {} as const;

// Suppress unused variable warnings
void _db;
void _dbRow;
void _columns;
void _embed;
void _bookmark;
void _embedDefault;
void _bookmarkDefault;
void _image;
void _file;
void _audio;
void _video;
void _imageTypes;
void _fileTypes;
void _audioTypes;
void _videoTypes;
void _fileDefault;
void _audioDefault;
void _videoDefault;
