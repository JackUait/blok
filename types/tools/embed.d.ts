import { PasteConfig, SanitizerConfig } from '../configs';
import { BlockTool, BlockToolConstructorOptions } from './block-tool';
import { BlockToolData } from './block-tool-data';
import { MenuConfig } from './menu-config';
import { PasteEvent } from './paste-events';
import { ToolboxConfig } from './tool-settings';

/**
 * How a matched service renders: a provider iframe or a provider widget script.
 */
export type EmbedKind = 'iframe' | 'script';

/**
 * Horizontal placement of the embed within the content column.
 */
export type EmbedAlignment = 'left' | 'center' | 'right';

/**
 * Link-type category of a provider's content.
 */
export type EmbedServiceType =
  | 'video'
  | 'audio'
  | 'image'
  | 'social'
  | 'document'
  | 'table'
  | 'form'
  | 'code'
  | 'design'
  | 'chart'
  | 'map'
  | 'calendar';

/**
 * What the embed registry knows about a URL it claims.
 */
export interface EmbedMatch {
  /** Registry key of the matched provider (e.g. 'youtube'). Becomes `EmbedData.service`. */
  service: string;
  /** The provider-specific id captured from the URL. */
  remoteId: string;
  /** Provider-sanctioned embed URL. Becomes `EmbedData.embed`. */
  embedUrl: string;
  /** How the provider renders. Becomes `EmbedData.kind`. */
  kind: EmbedKind;
  /** Display name of the matched provider (e.g. "YouTube"). */
  title: string;
  /** Link-type category of the matched provider. */
  type: EmbedServiceType;
}

/**
 * Resolves a URL against the embed registry, returning exactly what pasting
 * that URL into the editor would have stored.
 *
 * This is the supported way to migrate stored legacy links: map the result to
 * `EmbedData` as `{ service, source: url, embed: embedUrl, kind }`. Hosts that
 * hand-maintain provider URL patterns instead drift silently whenever a
 * provider changes, because the registry is versioned with the editor and the
 * copy is not.
 *
 * The registry data itself is not published: its keys, regexes and embed
 * templates track provider changes, so freezing it would make every provider
 * fix a breaking change.
 *
 * @example
 * const match = matchEmbedService(storedUrl);
 * if (match !== null) {
 *   block.data = { service: match.service, source: storedUrl, embed: match.embedUrl, kind: match.kind };
 * }
 *
 * @param url - the raw URL to resolve.
 * @returns the match, or `null` when no provider claims the URL.
 */
export function matchEmbedService(url: string): EmbedMatch | null;

/**
 * Builds a provider's embed URL from a registry key and a remote id — the
 * inverse of {@link matchEmbedService} for data that already stores the id.
 *
 * @param service - a registry key, e.g. the `service` of an {@link EmbedMatch}.
 * @param remoteId - the provider-specific id.
 * @returns the provider-sanctioned embed URL.
 * @throws if `service` is not a registered provider.
 */
export function buildEmbedUrl(service: string, remoteId: string): string;

/**
 * Embed Tool's input and output data format
 */
export interface EmbedData extends BlockToolData {
  /** Matched service key from the embed registry (e.g. 'youtube') */
  service: string;
  /** Original pasted URL */
  source: string;
  /** Provider-sanctioned embed URL rendered in the iframe */
  embed: string;
  /** How the service renders. Defaults to 'iframe'. */
  kind?: EmbedKind;
  width?: number;
  height?: number;
  /** Rendered width as a percent of the editor container. Defaults to full (100). */
  widthPercent?: number;
  /** Horizontal placement within the content column. Defaults to center. */
  alignment?: EmbedAlignment;
  caption?: string;
  /** Whether the caption field is shown. */
  captionVisible?: boolean;
}

/**
 * Embed Tool constructor options
 */
export type EmbedConstructorOptions = BlockToolConstructorOptions<EmbedData>;

/**
 * Embed Tool for the Blok Editor
 * Live interactive iframe for a pasted provider URL. Only registry-matched
 * URLs are ever embedded.
 */
export declare class Embed implements BlockTool {
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
   * Plain-text and URL fields, declared PLAINTEXT so load and save never parse them as HTML
   */
  static sanitize?: SanitizerConfig;

  constructor(options: EmbedConstructorOptions);

  /**
   * Return Tool's view
   */
  render(): HTMLElement;

  /**
   * Extract Tool's data from the view
   */
  save(): EmbedData;

  /**
   * Validate Embed block data
   */
  validate(data: EmbedData): boolean;

  /**
   * Handle pasted provider URLs
   */
  onPaste(event: PasteEvent): void;

  /**
   * Toggle read-only mode
   */
  setReadOnly(state: boolean): void;

  /**
   * Returns embed block tunes config
   */
  renderSettings(): MenuConfig;
}
