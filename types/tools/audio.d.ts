import { BlockToolData } from './block-tool-data';
import { MaxSizeConfig } from './max-size';
import { MediaSource } from './media-source';

export type AudioAlignment = 'left' | 'center' | 'right';

export interface AudioData extends BlockToolData {
  url: string;
  caption?: string;
  captionVisible?: boolean;
  title?: string;
  artist?: string;
  coverUrl?: string;
  loop?: boolean;
  width?: number;
  alignment?: AudioAlignment;
  fileName?: string;
  mimeType?: string;
  duration?: number;
  peaks?: number[];
}

export interface AudioUploadContext {
  onProgress?(percent: number): void;
}

export interface AudioUploader {
  uploadByFile?(file: File, ctx?: AudioUploadContext): Promise<{ url: string; fileName?: string }>;
  uploadByUrl?(url: string, ctx?: AudioUploadContext): Promise<{ url: string }>;
}

export interface AudioConfig {
  uploader?: AudioUploader;
  /**
   * Accepted MIME types. Entries may be exact (`audio/mpeg`) or family wildcards
   * (`audio/*`). Default: `['audio/*']` — any audio type.
   */
  types?: string[];
  maxSize?: MaxSizeConfig;
  /**
   * Restrict how audio may be added. Default `'both'` (Upload + Link).
   * Use `'upload'` for file-only or `'url'` for link-only. See {@link MediaSource}.
   */
  sources?: MediaSource;
  captionPlaceholder?: string;
}
