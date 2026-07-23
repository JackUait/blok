import { ToolClass, ExternalToolSettings } from './tool-settings';

/**
 * Recovers a tool's configuration type from its class.
 *
 * Built-in tools already type their constructor as
 * `BlockToolConstructorOptions<Data, Config>` (e.g. `HeaderConfig`,
 * `ParagraphConfig`), so the concrete config shape is reachable via the class's
 * constructor parameters — it is just discarded at the registration site, where
 * the `tools` map falls back to `Record<string, unknown>`. This type re-reads
 * it from `ConstructorParameters<TClass>[0]['config']`.
 *
 * Falls back to `Record<string, unknown>` for tool classes whose constructor is
 * not typed with a concrete config (nothing to check against).
 */
export type ExtractToolConfig<TClass extends ToolClass> =
  ConstructorParameters<TClass> extends [infer Options, ...unknown[]]
    ? Options extends { config?: infer Config }
      ? NonNullable<Config> extends object
        ? NonNullable<Config>
        : Record<string, unknown>
      : Record<string, unknown>
    : Record<string, unknown>;

/**
 * Binds a tool class to a type-checked settings object for the editor's `tools`
 * map.
 *
 * The public `tools` config registers every tool with a bare `ToolSettings`,
 * whose `Config` defaults to `Record<string, unknown>` — so a typo in a
 * built-in tool's config (`defaultLevle` for `defaultLevel`) is silently
 * accepted. `defineTool` recovers the tool's real config type from its
 * constructor ({@link ExtractToolConfig}) and applies it to `settings.config`,
 * turning those typos into compile errors.
 *
 * @example
 * import Blok from '@bloklabs/core';
 * import { Header, defineTool } from '@bloklabs/core/tools';
 *
 * new Blok({
 *   tools: {
 *     header: defineTool(Header, { config: { levels: [1, 2, 3] } }),
 *   },
 * });
 *
 * The type-checking lives entirely on the `settings` PARAMETER (checked against
 * the recovered config). The RETURN type is deliberately the erased
 * `ExternalToolSettings` (config `Record<string, unknown>`): the editor's
 * `tools` map slot requires config assignable to `Record<string, unknown>`, and
 * a concrete config interface (no index signature) is not — so returning the
 * concrete `ExternalToolSettings<Config>` would make `tools: { header:
 * defineTool(Header, …) }` fail to compile. Erasing the return keeps the helper
 * droppable straight into the map while typos are still caught at the call.
 *
 * @param toolClass - the tool class to register.
 * @param settings - tool settings; `config` is type-checked against the tool's
 *   recovered config type. `class` is filled in from `toolClass`.
 * @returns an {@link ExternalToolSettings} carrying the class, ready to drop
 *   into the editor's `tools` map.
 */
export function defineTool<TClass extends ToolClass>(
  toolClass: TClass,
  settings?: Omit<ExternalToolSettings<ExtractToolConfig<TClass>>, 'class'>,
): ExternalToolSettings;
