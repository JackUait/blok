import { isObject } from '../../utils';
import type { SanitizerConfig } from '../../../../types/configs/sanitizer-config';
import type { BlokConfig } from '../../../../types/configs/blok-config';
import type { BlockToolAdapter } from '../../tools/block';
import type { ToolsCollection } from '../../tools/collection';
import { composeSanitizerConfig } from '../../utils/sanitizer';
import type { TagSubstitute } from './types';
import { SAFE_STRUCTURAL_TAGS, collectTagNames } from './constants';

/**
 * Sanitizer Config Builder builds sanitizer configs from tool configurations.
 * Handles structural tags detection and config merging.
 */
export class SanitizerConfigBuilder {
  constructor(
    private readonly tools: ToolsCollection<BlockToolAdapter>,
    private readonly config: BlokConfig
  ) {}

  /**
   * Build sanitizer config for all tool tags.
   */
  public buildToolsTagsConfig(toolsTags: { [tag: string]: TagSubstitute }): SanitizerConfig {
    return Object.fromEntries(
      Object.keys(toolsTags).map((tag) => [
        tag.toLowerCase(),
        toolsTags[tag].sanitizationConfig ?? {},
      ])
    ) as SanitizerConfig;
  }

  /**
   * Detect structural tags in HTML node.
   */
  public getStructuralTagsConfig(node: HTMLElement): SanitizerConfig {
    const config: SanitizerConfig = {} as SanitizerConfig;
    const nodesToProcess: Element[] = [ node ];

    while (nodesToProcess.length > 0) {
      const current = nodesToProcess.pop();

      if (!current) {
        continue;
      }

      const tagName = current.tagName.toLowerCase();

      if (SAFE_STRUCTURAL_TAGS.has(tagName)) {
        config[tagName] = config[tagName] ?? {};
      }

      nodesToProcess.push(...Array.from(current.children));
    }

    return config;
  }

  /**
   * Build sanitizer config for a specific tool.
   */
  public buildToolConfig(tool: BlockToolAdapter): SanitizerConfig {
    if (tool.pasteConfig === false) {
      return {};
    }

    const tagsOrSanitizeConfigs = tool.pasteConfig?.tags || [];
    const toolTags: SanitizerConfig = {};

    tagsOrSanitizeConfigs.forEach((tagOrSanitizeConfig) => {
      const tags = collectTagNames(tagOrSanitizeConfig);

      tags.forEach((tag) => {
        const sanitizationConfig = isObject(tagOrSanitizeConfig)
          ? (tagOrSanitizeConfig as SanitizerConfig)[tag]
          : null;

        toolTags[tag.toLowerCase()] = sanitizationConfig ?? {};
      });
    });

    return toolTags;
  }

  /**
   * Compose multiple sanitizer configs.
   */
  public composeConfigs(...configs: SanitizerConfig[]): SanitizerConfig {
    return composeSanitizerConfig({}, ...configs);
  }

  /**
   * Special handling for table sanitization.
   */
  public sanitizeTable(table: HTMLElement, config: SanitizerConfig): HTMLElement | null {
    const { clean } = require('../../utils/sanitizer');
    const cleanTableHTML = clean(table.outerHTML, config);
    const tmpWrapper = document.createElement('div');

    tmpWrapper.innerHTML = cleanTableHTML;
    const firstChild = tmpWrapper.firstChild;

    if (!firstChild || !(firstChild instanceof HTMLElement)) {
      return null;
    }

    return firstChild;
  }

  /**
   * Check if a tag is a structural tag.
   */
  public isStructuralTag(tagName: string): boolean {
    return SAFE_STRUCTURAL_TAGS.has(tagName.toLowerCase());
  }
}
