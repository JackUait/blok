import type { BlokConfig } from '../../../types';
import type { InternalToolSettings, ToolSettings } from '../../../types/tools';
import { createPassSource } from './access-pass';
import { createFetchUploader } from './fetch-uploader';

type ToolEntry = NonNullable<BlokConfig['tools']>[string];

/**
 * Narrows to the settings form that carries a nested `config`. Going through
 * `InternalToolSettings` rather than the whole union keeps the read off
 * `FlatToolSettings.config`, which is deprecated.
 * @param entry - a tool registered as a constructable or as settings
 */
const hasNestedConfig = (entry: ToolEntry | undefined): entry is InternalToolSettings =>
  typeof entry === 'object' && entry !== null && 'config' in entry;

/**
 * @param entry - a tool registered as a constructable or as settings
 */
const readToolConfig = (entry: ToolEntry | undefined): Record<string, unknown> | undefined =>
  hasNestedConfig(entry) ? entry.config : undefined;

/**
 * Rebuilds a tool entry carrying extra config, keeping whatever the consumer
 * registered — including a bare constructable, which has to move under `class`
 * to make room for the config.
 *
 * Writes the NESTED `config` form on purpose: Tools merges flat options over
 * nested ones, so anything the consumer set flat still wins over this.
 * @param entry - the tool as the consumer registered it, if at all
 * @param extra - config keys to fill in
 */
const withConfig = (entry: ToolEntry | undefined, extra: Record<string, unknown>): ToolSettings => {
  const config = { ...readToolConfig(entry), ...extra };

  if (typeof entry === 'function') {
    return { class: entry, config };
  }

  if (typeof entry === 'object' && entry !== null) {
    return { ...entry, config };
  }

  return { config };
};

/**
 * Expands the `server` shorthand into the options that already exist.
 *
 * Runs once at config-normalization time, so no module downstream ever learns
 * that `server` exists. Explicit options always win: a consumer may take the
 * service for link previews while keeping their own uploader.
 * @param config - the user-supplied configuration
 */
export function expandServerConfig(config: BlokConfig): BlokConfig {
  const server = config.server;

  if (server === undefined) {
    return config;
  }

  const trailingSlashes = Array.from(server)
    .reduce((count, character) => (character === '/' ? count + 1 : 0), 0);
  // Counting beats `/\/+$/`, which retries at every offset and goes quadratic
  // on a long run of slashes.
  const base = server.slice(0, server.length - trailingSlashes);

  // One source for the whole editor: uploads and link previews share a pass, so
  // a page full of images mints one rather than one per request.
  const headers = config.ticket === undefined
    ? undefined
    : createPassSource({ endpoint: config.ticket });

  const expanded: BlokConfig = { ...config };

  if (expanded.uploader === undefined) {
    expanded.uploader = createFetchUploader({ baseUrl: base, headers });
  }

  const bookmark = config.tools?.bookmark;
  const bookmarkConfig = readToolConfig(bookmark);
  const missingEndpoint = bookmarkConfig?.endpoint === undefined;
  const missingHeaders = headers !== undefined && bookmarkConfig?.headers === undefined;

  if (missingEndpoint || missingHeaders) {
    expanded.tools = {
      ...config.tools,
      bookmark: withConfig(bookmark, {
        ...(missingEndpoint ? { endpoint: `${base}/unfurl` } : {}),
        ...(missingHeaders ? { headers } : {}),
      }),
    };
  }

  return expanded;
}
