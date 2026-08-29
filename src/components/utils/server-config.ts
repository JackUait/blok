import type { BlokConfig } from '../../../types';
import type { InternalToolSettings, ToolSettings } from '../../../types/tools';
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
 * Rebuilds a bookmark entry carrying the unfurl endpoint, keeping whatever the
 * consumer registered — including a bare constructable, which has to move under
 * `class` to make room for the config.
 *
 * Writes the NESTED `config` form on purpose: Tools merges flat options over
 * nested ones, so anything the consumer set flat still wins over this.
 * @param entry - the bookmark tool as the consumer registered it, if at all
 * @param endpoint - unfurl endpoint to fill in
 */
const withEndpoint = (entry: ToolEntry | undefined, endpoint: string): ToolSettings => {
  const config = { ...readToolConfig(entry), endpoint };

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

  const base = server.replace(/\/+$/, '');
  const expanded: BlokConfig = { ...config };

  if (expanded.uploader === undefined) {
    expanded.uploader = createFetchUploader({ baseUrl: base });
  }

  const bookmark = config.tools?.bookmark;

  if (readToolConfig(bookmark)?.endpoint === undefined) {
    expanded.tools = {
      ...config.tools,
      bookmark: withEndpoint(bookmark, `${base}/unfurl`),
    };
  }

  return expanded;
}
