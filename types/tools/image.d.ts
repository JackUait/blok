import { DeleteContext, PasteConfig, SanitizerConfig } from '../configs';
import { BlockTool, BlockToolConstructorOptions } from './block-tool';
import { BlockToolData } from './block-tool-data';
import { MaxSizeConfig } from './max-size';
import { UploadErrorHandler } from './upload-error';
import { MediaSource } from './media-source';
import { MenuConfig } from './menu-config';
import { PasteEvent } from './paste-events';
import { ToolboxConfig } from './tool-settings';
import { MediaVariant } from '../configs/media';

/** Horizontal alignment of the image within its container. */
export type ImageAlignment = 'left' | 'center' | 'right';
/** Size preset. `full` matches a full-bleed layout. Custom `width` still wins when set. */
export type ImageSize = 'sm' | 'md' | 'lg' | 'full';
/** Frame treatment around the image. */
export type ImageFrame = 'none' | 'border' | 'shadow';

/** Crop mask shape. Defaults to 'rect'. */
export type ImageCropShape = 'rect' | 'circle' | 'ellipse';

/** Non-destructive crop rectangle, in percent (0–100) of the image box: the source file, or the turned image when rotation, flipX or straighten is set. */
export interface ImageCrop {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Optional mask shape. Omit for rectangular crop. */
  shape?: ImageCropShape;
}

/** Clockwise quarter turn, applied after the mirror. */
export type ImageRotation = 0 | 90 | 180 | 270;

/** Built-in colour look, applied with CSS `filter` at render time. */
export type ImageFilterPreset =
  | 'none'
  | 'vivid' | 'vivid-warm' | 'vivid-cool'
  | 'dramatic' | 'dramatic-warm' | 'dramatic-cool'
  | 'chrome' | 'lomo'
  | 'warm' | 'golden' | 'cool' | 'dusk'
  | 'fade' | 'matte' | 'pastel'
  | 'film' | 'vintage' | 'retro' | 'sepia'
  | 'mono' | 'silvertone' | 'noir' | 'high-key';

/** A host-defined colour look for the image editor's filter strip. */
export interface ImageFilterDefinition {
  /** Saved in `ImageData.filter`. Reusing a built-in name retunes that built-in. */
  name: string;
  /** Label under the thumbnail. Shown as is, not translated. */
  title: string;
  /**
   * CSS filter functions, e.g. `'sepia(0.3) hue-rotate(-10deg) saturate(1.2)'`.
   * Only `brightness`, `contrast`, `saturate`, `grayscale`, `sepia`, `invert` and
   * `hue-rotate` are kept, so SVG copies of the photo can draw the same look.
   */
  css: string;
}

/** Colour adjustments. Each value is -100..100; 0 or absent leaves the image unchanged. */
export interface ImageAdjust {
  brightness?: number;
  contrast?: number;
  saturation?: number;
}

/**
 * Markup colour: `#rrggbb`, lower case. Anything else is dropped on load.
 */
export type ImageMarkupColor = string;

/**
 * Markup coordinates are fractions (0..1) of the turned image's box — the same box
 * `crop` uses, before the crop and before `straighten`. Sizes are fractions of that
 * box's shorter side, so a mark keeps its weight on any rendered size.
 */
interface ImageMarkupBase {
  /** Stable id, unique within the image. */
  id: string;
  color: ImageMarkupColor;
}

/** A freehand stroke. */
export interface ImageMarkupStroke extends ImageMarkupBase {
  /** `pen` is solid with pressure taper; `highlighter` is flat, wide and translucent. */
  type: 'pen' | 'highlighter';
  /** Flat list of `x, y, pressure` triples. Pressure is 0..1. */
  points: number[];
  /** Nominal stroke width. */
  size: number;
  /** Ends the eraser cut. A cut pen end is blunt, not tapered. Omitted when none. */
  cut?: 'start' | 'end' | 'both';
}

/**
 * A shape between two corner points. Line and arrow join the points; every other
 * shape fills the box they span. A spotlight dims the image outside its box, and a
 * magnifier shows the image under its round lens enlarged; both ignore colour and size.
 */
export interface ImageMarkupShape extends ImageMarkupBase {
  type: 'rect' | 'rounded-rect' | 'ellipse' | 'line' | 'arrow' | 'bubble' | 'star' | 'polygon' | 'spotlight' | 'magnifier';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Stroke width. */
  size: number;
  /** Closed shapes but the spotlight and magnifier: a translucent fill of `color`. Omitted for false. */
  fill?: boolean;
  /** Star and polygon only: clockwise degrees, so they turn with the image. Omitted for 0. */
  rotation?: number;
  /** Bubble only: where the tail points, in the same fractions as the corners. */
  tx?: number;
  ty?: number;
}

/** How a text mark is painted. */
export type ImageMarkupTextStyle = 'plain' | 'outline' | 'background';

/** A text label. */
export interface ImageMarkupText extends ImageMarkupBase {
  type: 'text';
  /** Centre of the text block. */
  x: number;
  y: number;
  /** Plain text; `\n` breaks lines. Never parsed as HTML. */
  text: string;
  /** Font size. */
  size: number;
  /** Omitted for 'plain'. */
  style?: ImageMarkupTextStyle;
  /** Clockwise degrees about the centre. Omitted for 0. */
  rotation?: number;
}

/** One drawn object on an image. */
export type ImageMarkup = ImageMarkupStroke | ImageMarkupShape | ImageMarkupText;

/**
 * Persisted data shape for the Image block tool.
 */
export interface ImageData extends BlockToolData {
  /** Image source URL — http(s) or blob: */
  url: string;
  /** Plain-text caption. Empty string when absent. */
  caption?: string;
  /** Width as percent of container, 10–100. Default 100. */
  width?: number;
  /** Horizontal alignment */
  alignment?: ImageAlignment;
  /** Discrete size preset; when present, overrides `width`. */
  size?: ImageSize;
  /** Decorative frame treatment. Default 'none'. */
  frame?: ImageFrame;
  /** Rounded corners. Default true. */
  rounded?: boolean;
  /** Caption visible in the rendered state. Default true. */
  captionVisible?: boolean;
  /**
   * Non-destructive crop rectangle. With `rotation`, `flipX` or `straighten` set it is
   * in the turned image's box, not the source file's.
   */
  crop?: ImageCrop;
  /** Quarter turn, clockwise. Omitted for 0. */
  rotation?: ImageRotation;
  /** Mirrored left to right, before `rotation`. Omitted for false. */
  flipX?: boolean;
  /** Fine turn in degrees, -45..45, clockwise, after `rotation`. Omitted for 0. */
  straighten?: number;
  /**
   * Colour look: a built-in preset or a host filter's name. Omitted for 'none'.
   * A name the host does not know renders unfiltered and is kept on save.
   */
  filter?: ImageFilterPreset | (string & {});
  /** How strongly `filter` applies, 0–100. Omitted for 100 and when there is no filter. */
  filterStrength?: number;
  /** Colour adjustments. Omitted when every value is 0. */
  adjust?: ImageAdjust;
  /** Drawings, shapes and text on top of the image, back to front. Omitted when empty. */
  markup?: ImageMarkup[];
  /** Alt text for screen readers */
  alt?: string;
  /** Original filename, when known */
  fileName?: string;
  /** Intrinsic pixel width of the source image. Cached after first successful load. */
  naturalWidth?: number;
  /** Intrinsic pixel height of the source image. Cached after first successful load. */
  naturalHeight?: number;
  /**
   * Every rendition, best format first. The last one is also `url`, the most
   * compatible. A list that does not contain `url` is ignored.
   */
  variants?: MediaVariant[];
}

/**
 * Context passed to consumer-supplied upload methods. Currently exposes
 * an `onProgress(percent)` hook so the upload bar in the editor can
 * reflect real upload progress (0–100). Optional — consumers that don't
 * report progress simply ignore it.
 */
export interface ImageUploadContext {
  onProgress?(percent: number): void;
}

/**
 * Consumer-supplied uploader. Every method optional — when absent,
 * the tool falls back to blob URLs (uploadByFile) or direct embed (uploadByUrl).
 */
export interface ImageUploader {
  uploadByFile?(file: File, ctx?: ImageUploadContext): Promise<{ url: string; fileName?: string }>;
  uploadByUrl?(url: string, ctx?: ImageUploadContext): Promise<{ url: string }>;
  /**
   * Delete an asset this uploader stored, by the URL it returned for it. Blok
   * calls it once a saved document no longer references the asset. Without it
   * nothing this uploader stored is ever cleaned up: Blok never deletes through
   * a different uploader than the one that stored the asset.
   */
  delete?(url: string, ctx: DeleteContext): Promise<void>;
}

/**
 * Output format for compressed images.
 * - `original` — re-encode in the source format (default; safest).
 * - `auto` — best format the browser can actually encode: AVIF → WebP → original.
 *
 * AVIF is encoded through the canvas where the browser supports it, and through
 * WebCodecs' AV1 encoder otherwise (Chromium). Browsers with neither fall back
 * to the next target. The WebCodecs path skips images with transparency — they
 * fall through to a format with an alpha channel instead of losing it.
 */
export type ImageCompressionFormat = 'original' | 'jpeg' | 'webp' | 'avif' | 'auto';

/**
 * Opt-in tuning for automatic image compression. Every field has a conservative
 * default; passing `compress: true` (or omitting it) uses them all.
 *
 * Compression never breaks an upload: whenever it cannot help — an unsupported
 * format, a result that isn't meaningfully smaller, a decode error — the original
 * file is uploaded untouched.
 */
export interface ImageCompressionConfig {
  /**
   * Output format. Default `'original'`.
   *
   * Note that `'jpeg'` has no alpha channel, so a transparent PNG re-encoded as
   * JPEG loses its transparency. `'webp'`, `'avif'` and `'auto'` preserve it.
   */
  format?: ImageCompressionFormat;
  /**
   * Format to try when the browser cannot encode `format`, before giving up
   * and re-encoding in the source format. Default: none — a browser without
   * the preferred encoder goes straight to the source format.
   *
   * `{ format: 'avif', fallbackFormat: 'webp' }` uploads AVIF where the
   * browser can produce it and WebP everywhere else.
   */
  fallbackFormat?: ImageCompressionFormat;
  /** Encoder quality, 0–1. Default 0.92 (visually lossless). Ignored for PNG. */
  quality?: number;
  /** Downscale images wider than this (px). Default: no cap. */
  maxWidth?: number;
  /** Downscale images taller than this (px). Default: no cap. */
  maxHeight?: number;
  /** Skip files smaller than this (bytes). Default 100 KiB. */
  minSize?: number;
  /**
   * Discard the result unless it saves at least this fraction of the original
   * size. Default 0.1 (10%).
   */
  minSavings?: number;
  /**
   * Replace the built-in pipeline entirely — e.g. a WASM encoder. Return `null`
   * to keep the original file.
   */
  transform?(file: File): Promise<File | Blob | null>;
}

/**
 * Tool configuration shape. Pass via Blok config:
 *   tools: { image: { class: Image, config: ImageConfig } }
 */
export interface ImageConfig {
  uploader?: ImageUploader;
  /**
   * Accepted MIME types. Entries may be exact (`image/png`) or family wildcards
   * (`image/*`). Default: `['image/*']` — any image type.
   */
  types?: string[];
  /**
   * Max upload size. A number caps every type (bytes); an object caps per MIME
   * type with `'*'` as the fallback. Default 30 MiB. See {@link MaxSizeConfig}.
   */
  maxSize?: MaxSizeConfig;
  /**
   * Called when an upload fails. Return a string to replace the block's
   * message, or `false` to take the error over and put the block back to its
   * empty state. See {@link UploadErrorHandler}.
   */
  onUploadError?: UploadErrorHandler;
  /**
   * Restrict how an image may be added. Default `'both'` (Upload + Link).
   * Use `'upload'` for file-only or `'url'` for link-only. See {@link MediaSource}.
   */
  sources?: MediaSource;
  /**
   * Auto-convert animated GIFs to a looping WebM video block on insert.
   * Default true. Set false to keep GIFs as image blocks.
   */
  convertGifToVideo?: boolean;
  /**
   * Re-encode uploaded images before they reach the uploader. Default true —
   * same format, quality 0.92, original dimensions, kept only when it saves at
   * least 10%. Pass an object to opt into a smaller format, a lower quality or a
   * dimension cap; pass false to upload the exact original bytes.
   * See {@link ImageCompressionConfig}.
   */
  compress?: boolean | ImageCompressionConfig;
  /** Caption placeholder. Default "Write a caption…" */
  captionPlaceholder?: string;
  /**
   * How many times a rendered image silently re-fetches its `src` after a load
   * error before showing the broken-image state. Default 5. Set 0 to disable
   * auto-retry (fail on the first error).
   */
  reloadAttempts?: number;
  /**
   * Looks offered in the image editor's filter strip, in order. Entries are
   * built-in names or {@link ImageFilterDefinition}s. Default: every built-in.
   * Original always comes first; `[]` hides the Filters tab. Built-ins left out
   * still render on images that already use them.
   */
  filters?: Array<ImageFilterPreset | ImageFilterDefinition>;
}

/**
 * Image Tool constructor options
 */
export type ImageConstructorOptions = BlockToolConstructorOptions<ImageData, ImageConfig>;

/**
 * Image Tool for the Blok Editor
 * Provides Image Blocks with upload, resize, crop, and frame controls
 */
export declare class Image implements BlockTool {
  /**
   * Tool's Toolbox settings
   */
  static toolbox?: ToolboxConfig;

  /**
   * Paste substitutions configuration
   */
  static pasteConfig?: PasteConfig | false;

  /**
   * Is Tool supports read-only mode
   */
  static isReadOnlySupported?: boolean;

  /**
   * Radius of the rounded frame at the block's edge; the selection fill follows it
   */
  static frameRadius?: string;

  /**
   * Plain-text and URL fields, declared PLAINTEXT so load and save never parse them as HTML
   */
  static sanitize?: SanitizerConfig;

  constructor(options: ImageConstructorOptions);

  /**
   * Return Tool's view
   */
  render(): HTMLElement;

  /**
   * Extract Tool's data from the view
   */
  save(block?: HTMLElement): ImageData;

  /**
   * Validate Image block data
   */
  validate(data: ImageData): boolean;

  /**
   * Handle pasted image files, URLs, and <img> tags
   */
  onPaste(event: PasteEvent): void;

  /**
   * Toggle read-only mode
   */
  setReadOnly(state: boolean): void;

  /**
   * Returns image block tunes config
   */
  renderSettings(): MenuConfig;

  /**
   * Set the frame treatment (none, border, shadow)
   */
  setFrame(next: ImageFrame): void;

  /**
   * Toggle rounded corners
   */
  setRounded(next: boolean): void;
}
