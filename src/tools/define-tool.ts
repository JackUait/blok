import type { ToolClass, ExternalToolSettings } from '../../types/tools/tool-settings';
import type { ExtractToolConfig } from '../../types/tools/define-tool';

/**
 * Binds a tool class to a type-checked settings object for the editor's `tools`
 * map. See {@link ExtractToolConfig} and the `defineTool` declaration in
 * `types/tools/define-tool.d.ts` for the type-level contract.
 *
 * At runtime this is a thin merge — the value it adds is entirely at the type
 * layer, where `settings.config` is checked against the tool's recovered config
 * type instead of the unchecked `Record<string, unknown>` the raw `tools` map
 * falls back to.
 */
export function defineTool<TClass extends ToolClass>(
  toolClass: TClass,
  settings: Omit<ExternalToolSettings<ExtractToolConfig<TClass>>, 'class'> = {},
): ExternalToolSettings {
  // The return type is the ERASED `ExternalToolSettings` (config
  // `Record<string, unknown>`) so the result drops into the editor's `tools`
  // map — a concrete config interface (no index signature) is not assignable to
  // the map slot's `Record<string, unknown>`. Typo-catching already happened on
  // the `settings` parameter; the return just erases the config at the boundary.
  return { ...settings, class: toolClass };
}
