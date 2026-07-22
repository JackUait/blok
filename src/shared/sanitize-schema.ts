/**
 * Single source of truth for the sanitize-allowlist composition shared by the
 * editor (`BlockToolAdapter.baseSanitizeConfig`) and the synchronous view
 * renderer.
 *
 * PURITY CONTRACT: this module is consumed by a no-DOM subpath. It must stay
 * synchronous, module-scope-safe, and free of imports that drag in DOM-bound
 * editor modules (no `document`/`window` access, no UI/module imports).
 */
import { deepMerge } from '../components/utils/object';
import { isFunction, isObject } from '../components/utils/type-guards';

import type { SanitizerConfig } from '../../types';
import type { BlokConfig } from '../../types/configs';
import type { ToolConstructable, ToolSettings } from '../../types/tools';

/**
 * Composes a base sanitizer config from a list of per-tool configs using the
 * exact merge semantics of `BlockToolAdapter.baseSanitizeConfig`: a plain
 * later-wins `Object.assign` fold (inline tools first, then tunes). Function
 * rules are carried by reference; rules for the same tag are replaced, never
 * deep-merged.
 * @param configs - sanitize configs in composition order
 * @returns composed base sanitizer config
 */
export function composeBaseSanitizeConfig(configs: SanitizerConfig[]): SanitizerConfig {
  const baseConfig = {} as SanitizerConfig;

  configs.forEach((config) => Object.assign(baseConfig, config));

  return baseConfig;
}

/**
 * Config accepted by `defineBlokSchema`. Only `tools`, `inlineToolbar` and
 * `tunes` participate in schema resolution; everything else (`link`, `i18n`,
 * `data`, …) is passed through untouched via `editorConfig`.
 */
export type BlokSchemaConfig = BlokConfig;

/**
 * A tool resolved from the user config: its constructable plus the
 * Blok-level settings that accompanied it (everything except `class`).
 */
export interface ResolvedSchemaTool {
  toolClass: ToolConstructable;
  settings: Omit<ToolSettings, 'class'>;
}

/**
 * The view side of a defined schema: the composed base sanitize allowlist and
 * the resolved tool map, for consumption by the view renderer.
 */
export interface BlokViewSchema {
  baseSanitize: SanitizerConfig;
  tools: { [toolName: string]: ResolvedSchemaTool };
}

/**
 * Result of `defineBlokSchema`.
 */
export interface DefinedBlokSchema<Config extends BlokSchemaConfig = BlokSchemaConfig> {
  editorConfig: Config;
  viewSchema: BlokViewSchema;
}

/**
 * Internal-tool stand-ins.
 *
 * The editor always registers four internal tools (stub, delete, copyLink,
 * convertTo) before user tools. Their real classes live in DOM-bound modules
 * (popovers, selection utils), so they must not be imported here. None of
 * them declares a `sanitize` static — they contribute nothing to the composed
 * allowlist — but they DO occupy registration slots, so lightweight stand-ins
 * with the same static type flags keep the resolution order and the
 * user-override (deepMerge) semantics identical to `Tools.prepare()`.
 * The drift-guard law test (sanitize-schema.test.ts) fails if this ever
 * diverges from the live editor's composition.
 */
class VirtualStubTool {}

class VirtualDeleteTune {
  public static isTune = true;
}

class VirtualCopyLinkTune {
  public static isTune = true;
}

class VirtualConvertInlineTool {
  public static isInline = true;

  /**
   * Inline tools without a prototype `render` are rejected by the editor's
   * availability check; the stand-in must pass it.
   */
  public render(): void {}
}

const INTERNAL_TOOLS: { [toolName: string]: ToolSettings & { isInternal?: boolean } } = {
  stub: {
    class: VirtualStubTool as unknown as ToolConstructable,
    isInternal: true,
  },
  delete: {
    class: VirtualDeleteTune as unknown as ToolConstructable,
    isInternal: true,
  },
  copyLink: {
    class: VirtualCopyLinkTune as unknown as ToolConstructable,
    isInternal: true,
  },
  convertTo: {
    class: VirtualConvertInlineTool as unknown as ToolConstructable,
    isInternal: true,
  },
};

type NormalizedToolSettings = ToolSettings & { isInternal?: boolean };

/**
 * Reads a class-level static (mirrors `BaseToolAdapter.sanitizeConfig` and
 * the factory's `getConstructor` flag checks).
 * @param toolClass - tool constructable
 * @param key - static property name
 * @returns the static value or undefined
 */
const readStatic = (toolClass: ToolConstructable, key: string): unknown => {
  return (toolClass as unknown as Record<string, unknown>)[key];
};

/**
 * Mirrors `Tools.expandToolGroups`: a class exposing a static `provides` map
 * registers the provided block tools instead of the group handle.
 * @param tools - merged tools map
 * @returns tools map with groups expanded
 */
const expandToolGroups = (
  tools: Record<string, ToolConstructable | ToolSettings>
): Record<string, ToolConstructable | ToolSettings> => {
  const out: Record<string, ToolConstructable | ToolSettings> = {};

  for (const name in tools) {
    if (!Object.prototype.hasOwnProperty.call(tools, name)) {
      continue;
    }

    const entry = tools[name];
    const toolClass = isObject(entry) ? entry.class : entry;
    const provides = (toolClass as { provides?: Record<string, ToolConstructable> } | undefined)?.provides;

    if (!provides) {
      out[name] = entry;
      continue;
    }

    const groupSettings: Record<string, unknown> = isObject(entry)
      ? Object.fromEntries(
          Object.entries(entry).filter(([key]) => key !== 'class' && key !== 'isInternal')
        )
      : {};

    const hasGroupSettings = Object.keys(groupSettings).length > 0;

    Object.entries(provides).forEach(([blockType, providedClass]) => {
      if (blockType in out) {
        return;
      }

      out[blockType] = hasGroupSettings ? { class: providedClass, ...groupSettings } : providedClass;
    });
  }

  return out;
};

/**
 * Mirrors `Tools.prepareConfig`: normalizes a class-or-settings entry into a
 * settings object with a `class` property.
 * @param entry - raw tool entry from the config
 * @returns normalized settings
 */
const normalizeToolEntry = (entry: ToolConstructable | ToolSettings): NormalizedToolSettings => {
  if (isObject(entry)) {
    return entry;
  }

  /** Not an object → it is the constructable itself (mirrors `Tools.prepareConfig`) */
  return { class: entry as ToolConstructable };
};

/**
 * Resolves the composed base sanitize config and the tool map for a Blok
 * configuration WITHOUT instantiating an editor.
 *
 * Mirrors the editor pipeline (`Tools.prepare` → `assignInlineToolsToBlockTool`
 * / `assignBlockTunesToBlockTool` → `BlockToolAdapter.baseSanitizeConfig`) for
 * a block tool with default settings:
 *
 * - internal tools merge first, user tools deep-merge over them;
 * - tool groups (static `provides`) expand;
 * - inline tools / tunes are classified by their `isInline` / `isTune`
 *   statics; inline tools missing a prototype `render` are dropped, like the
 *   editor's availability check;
 * - enabled inline tools follow the global `inlineToolbar` setting
 *   (`false` → none, array → that order, otherwise convertTo + all inline
 *   tools in registration order);
 * - tunes are the global `tunes` array (if any) followed by internal tunes;
 * - sanitize configs are read from each class's `sanitize` static — every
 *   built-in inline tool exposes one, and legacy tools wrapped via
 *   `wrapLegacyInlineTool` copy it onto the wrapper class.
 *
 * Known limitation: tools whose async `prepare()` would fail in the editor
 * (and therefore be excluded there) cannot be detected purely/synchronously
 * and are assumed available.
 * @param config - subset of BlokConfig ({ tools, inlineToolbar, tunes, link, i18n, ... })
 * @returns `{ editorConfig, viewSchema }` — spread `editorConfig` into `new Blok({...})`, hand `viewSchema` to the view renderer
 */
export function defineBlokSchema<Config extends BlokSchemaConfig>(config: Config): DefinedBlokSchema<Config> {
  const userTools = config.tools ?? {};

  const mergedTools = expandToolGroups(
    deepMerge({}, INTERNAL_TOOLS, userTools)
  );

  const inlineToolConfigs = new Map<string, SanitizerConfig>();
  const tuneConfigs = new Map<string, SanitizerConfig>();
  const internalTuneNames: string[] = [];
  const resolvedTools: { [toolName: string]: ResolvedSchemaTool } = {};

  for (const toolName in mergedTools) {
    if (!Object.prototype.hasOwnProperty.call(mergedTools, toolName)) {
      continue;
    }

    const { class: toolClass, isInternal = false, ...settings } = normalizeToolEntry(mergedTools[toolName]);

    if (!isFunction(toolClass)) {
      continue;
    }

    const sanitize = (readStatic(toolClass, 'sanitize') ?? {}) as SanitizerConfig;
    const isInline = Boolean(readStatic(toolClass, 'isInline'));
    const isTune = Boolean(readStatic(toolClass, 'isTune'));

    const prototype = (toolClass as unknown as { prototype?: { render?: unknown } }).prototype;

    /** Editor availability check: inline tools must implement render() */
    if (isInline && typeof prototype?.render !== 'function') {
      continue;
    }

    if (isInline) {
      inlineToolConfigs.set(toolName, sanitize);
    }

    if (!isInline && isTune) {
      tuneConfigs.set(toolName, sanitize);
    }

    if (!isInline && isTune && isInternal) {
      internalTuneNames.push(toolName);
    }

    if (!isInternal) {
      resolvedTools[toolName] = {
        toolClass,
        settings,
      };
    }
  }

  /**
   * Enabled inline tools, mirroring `assignInlineToolsToBlockTool` for a
   * block tool whose own `inlineToolbar` setting is true/unset.
   */
  const enabledInlineNames = ((): string[] => {
    if (config.inlineToolbar === false) {
      return [];
    }

    if (Array.isArray(config.inlineToolbar)) {
      return config.inlineToolbar.filter((name) => inlineToolConfigs.has(name));
    }

    /** Dedupe while keeping first-occurrence order (Map semantics in the editor) */
    return Array.from(new Set(['convertTo', ...inlineToolConfigs.keys()]))
      .filter((name) => inlineToolConfigs.has(name));
  })();

  /**
   * Enabled tunes, mirroring `assignBlockTunesToBlockTool` for a block tool
   * without its own `tunes` setting: user common tunes (if any) then internal.
   */
  const enabledTuneNames = ((): string[] => {
    const userTuneNames = Array.isArray(config.tunes)
      ? config.tunes.filter((name) => tuneConfigs.has(name))
      : [];

    return Array.from(new Set([...userTuneNames, ...internalTuneNames]));
  })();

  const baseSanitize = composeBaseSanitizeConfig([
    ...enabledInlineNames.map((name) => inlineToolConfigs.get(name) ?? {}),
    ...enabledTuneNames.map((name) => tuneConfigs.get(name) ?? {}),
  ]);

  return {
    editorConfig: config,
    viewSchema: {
      baseSanitize,
      tools: resolvedTools,
    },
  };
}
